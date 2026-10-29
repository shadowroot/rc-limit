#pragma once
#include <stdint.h>
#include <stdlib.h>

namespace rc {
struct Config {
  int input_pin = 4, output_pin = 5;
  int input_min = 1000, input_neutral = 1500, input_max = 2000;
  int output_min = 1000, output_neutral = 1500, output_max = 2000;
  int forward_percent = 30, reverse_percent = 30;
  int bidirectional = 1, scale = 1, invert = 0;
  int deadband = 30, timeout_ms = 100;
};
inline bool valid(const Config& c) {
  return c.input_min >= 800 && c.input_max <= 2200 &&
    c.input_min < c.input_neutral && c.input_neutral < c.input_max &&
    c.output_min >= 800 && c.output_max <= 2200 &&
    c.output_min < c.output_neutral && c.output_neutral < c.output_max &&
    c.forward_percent >= 0 && c.forward_percent <= 100 &&
    c.reverse_percent >= 0 && c.reverse_percent <= 100 &&
    (c.bidirectional == 0 || c.bidirectional == 1) &&
    (c.scale == 0 || c.scale == 1) && (c.invert == 0 || c.invert == 1) &&
    c.deadband >= 0 && c.deadband <= 100 &&
    c.deadband < (c.input_neutral-c.input_min) &&
    c.deadband < (c.input_max-c.input_neutral) &&
    c.timeout_ms >= 40 && c.timeout_ms <= 250;
}
inline int clamp(int x, int lo, int hi) { return x < lo ? lo : (x > hi ? hi : x); }
inline int safe(const Config& c) { return c.bidirectional ? c.output_neutral : c.output_min; }
inline int normalized(const Config& c, int pulse) {
  pulse = clamp(pulse, c.input_min, c.input_max);
  int value;
  if (c.bidirectional) {
    const int delta=pulse-c.input_neutral;
    value=delta*10000/(delta<0 ? c.input_neutral-c.input_min : c.input_max-c.input_neutral);
    return c.invert ? -value : value;
  }
  value=(pulse-c.input_min)*10000/(c.input_max-c.input_min);
  return c.invert ? 10000-value : value;
}
inline bool neutral(const Config& c, int pulse) {
  pulse=clamp(pulse,c.input_min,c.input_max);
  return c.bidirectional ? abs(pulse-c.input_neutral) <= c.deadband
    : (c.invert ? pulse >= c.input_max-c.deadband : pulse <= c.input_min+c.deadband);
}
inline int map(const Config& c, int pulse) {
  if (neutral(c,pulse)) return safe(c);
  const int demand=normalized(c,pulse);
  const bool reverse = demand < 0;
  const int output_origin = safe(c);
  const int span = reverse ? output_origin-c.output_min : c.output_max-output_origin;
  const int percent = reverse ? c.reverse_percent : c.forward_percent;
  int delta = abs(demand)*span/10000;
  const int cap = span*percent/100;
  delta = c.scale ? delta*percent/100 : clamp(delta, 0, cap);
  return output_origin + (reverse ? -delta : delta);
}
// Only a fresh valid pulse can contribute to the one-second neutral dwell.
class Limiter {
 public:
  bool armed = false;
  void reset() { armed=false; dwelling=false; }
  int step(const Config& c, uint32_t now, uint32_t last, int pulse, bool seen, bool good) {
    healthy = seen && good && uint32_t(now-last) <= uint32_t(c.timeout_ms)*1000;
    if (!healthy) { reset(); return safe(c); }
    if (neutral(c, pulse)) {
      if (!dwelling) { since=now; dwelling=true; }
    } else dwelling=false;
    return armed ? map(c, pulse) : safe(c);
  }
  bool arm(uint32_t now) {
    if (!canArm(now)) return false;
    armed=true; return true;
  }
  bool canArm(uint32_t now) const { return healthy && dwelling && uint32_t(now-since) >= 1000000; }
  bool healthy = false;
 private:
  bool dwelling = false;
  uint32_t since = 0;
};
constexpr int MAX_MAPPINGS=4;
enum class Board { Pico, Esp32 };
struct MappingSet {
  int count=1;
  Config channels[MAX_MAPPINGS];
};
inline bool allowedPin(Board board,int pin,bool output) {
  if(board==Board::Pico) return (pin>=0 && pin<=22) || (pin>=26 && pin<=28);
  switch(pin) {
    case 18: case 19: case 21: case 22: case 23: case 25:
    case 26: case 27: case 32: case 33: return true;
    case 34: case 35: case 36: case 39: return !output;
    default: return false;
  }
}
inline bool validMappings(const MappingSet& set,Board board) {
  if(set.count<1 || set.count>MAX_MAPPINGS) return false;
  for(int i=0;i<set.count;i++) {
    const Config& c=set.channels[i];
    if(!valid(c) || !allowedPin(board,c.input_pin,false) || !allowedPin(board,c.output_pin,true)) return false;
    for(int j=0;j<set.count;j++) {
      if(c.output_pin==set.channels[j].input_pin) return false;
      if(i!=j && c.output_pin==set.channels[j].output_pin) return false;
      // Pico GPIOs 16 apart share the same physical PWM slice/channel.
      if(board==Board::Pico && i!=j && c.output_pin%16==set.channels[j].output_pin%16) return false;
    }
  }
  return true;
}
struct Sample {
  uint32_t last=0;
  int pulse=0;
  bool seen=false,good=false;
};
class Bank {
 public:
  Limiter channels[MAX_MAPPINGS];
  int outputs[MAX_MAPPINGS]={};
  bool armed=false,healthy=false;
  void disarm(const MappingSet& set) {
    armed=false;
    for(int i=0;i<set.count;i++) { channels[i].reset(); outputs[i]=safe(set.channels[i]); }
  }
  void step(const MappingSet& set,uint32_t now,const Sample* samples) {
    healthy=true;
    for(int i=0;i<set.count;i++) {
      const Sample& s=samples[i];
      outputs[i]=channels[i].step(set.channels[i],now,s.last,s.pulse,s.seen,s.good);
      healthy=healthy && channels[i].healthy;
    }
    if(!healthy) disarm(set);
  }
  bool arm(const MappingSet& set,uint32_t now) {
    for(int i=0;i<set.count;i++) if(!channels[i].canArm(now)) return false;
    for(int i=0;i<set.count;i++) channels[i].arm(now);
    armed=true; return true;
  }
};
}

#include "../firmware/rc_limiter/limiter.h"
#include <assert.h>
#include <iostream>

int main() {
  rc::Config c;
  assert(c.bidirectional==1);
  c.bidirectional=0;
  assert(rc::valid(c));
  assert(rc::map(c,1000)==1000);
  assert(rc::map(c,1500)==1150);
  assert(rc::map(c,2000)==1300);
  c.scale=0;
  assert(rc::map(c,1200)==1200);
  assert(rc::map(c,2000)==1300);
  c.bidirectional=1; c.scale=1;
  assert(rc::map(c,1000)==1350);
  assert(rc::map(c,1500)==1500);
  assert(rc::map(c,2000)==1650);
  c.invert=1; c.input_neutral=1400;
  assert(rc::neutral(c,1400));
  assert(rc::map(c,1000)==1650);
  assert(rc::map(c,1400)==1500);
  assert(rc::map(c,2000)==1350);
  // Exhaust all meaningful input values for both mappings, modes and directions.
  for (int mode=0;mode<2;mode++) for (int scale=0;scale<2;scale++)
    for(int invert=0;invert<2;invert++) for(int pct=0;pct<=100;pct++) {
      c.bidirectional=mode; c.scale=scale; c.invert=invert;
      c.forward_percent=pct; c.reverse_percent=100-pct;
      int lo=mode ? 1500-500*(100-pct)/100 : 1000;
      int hi=mode ? 1500+500*pct/100 : 1000+1000*pct/100;
      for(int input=500;input<=2500;input++) {
        int output=rc::map(c,input);
        assert(output>=lo && output<=hi);
      }
    }
  c=rc::Config{};
  c.bidirectional=0;
  rc::Limiter l;
  assert(!l.arm(0));
  assert(l.step(c,0,0,1000,false,false)==1000);
  l.step(c,100,100,1000,true,true);
  assert(!l.arm(999999));
  l.step(c,1000100,1000100,1000,true,true);
  assert(l.arm(1000100));
  assert(l.step(c,1020000,1020000,2000,true,true)==1300);
  assert(l.step(c,1120001,1020000,2000,true,true)==1000);
  assert(!l.armed);
  assert(!l.arm(1120002));
  l.step(c,1140000,1140000,1000,true,true);
  l.step(c,2140000,2140000,1000,true,true);
  assert(l.arm(2140000));
  assert(l.step(c,2140001,2140001,0,true,false)==1000);
  assert(!l.armed);
  // Unsigned timer rollover during neutral dwell and pulse timeout.
  l.step(c,0xfff80000u,0xfff80000u,1000,true,true);
  l.step(c,500000,500000,1000,true,true);
  assert(l.arm(500000));
  assert(l.step(c,32,0xfffffff0u,2000,true,true)==1300);
  // A high-throttle pulse interrupts the neutral dwell.
  l.reset();
  l.step(c,100,100,1000,true,true);
  l.step(c,900000,900000,2000,true,true);
  l.step(c,1000100,1000100,1000,true,true);
  assert(!l.arm(1000100));
  // Bidirectional loss must use configured neutral, never the forward-only minimum.
  c=rc::Config{};
  c.output_neutral=1470;
  l.reset();
  assert(l.step(c,0,0,2000,false,false)==1470);
  l.step(c,10,10,1500,true,true);
  l.step(c,1000010,1000010,1500,true,true);
  assert(l.arm(1000010));
  assert(l.step(c,1020000,1020000,2000,true,true)>1470);
  assert(l.step(c,1120001,1020000,2000,true,true)==1470);
  assert(!l.armed);
  c.forward_percent=c.reverse_percent=0;
  assert(rc::map(c,1000)==1470 && rc::map(c,2000)==1470);
  c.output_neutral=c.output_max;
  assert(!rc::valid(c));
  c=rc::Config{}; c.forward_percent=101; assert(!rc::valid(c));
  c=rc::Config{}; c.timeout_ms=0; assert(!rc::valid(c));
  rc::MappingSet set;
  assert(rc::validMappings(set,rc::Board::Pico));
  rc::MappingSet c3;
  c3.count=4;
  const int c3inputs[]={3,5,0,7},c3outputs[]={4,6,1,10};
  for(int i=0;i<4;i++) {c3.channels[i].input_pin=c3inputs[i];c3.channels[i].output_pin=c3outputs[i];}
  assert(rc::validMappings(c3,rc::Board::Esp32C3));
  for(int pin: {2,8,9,18,19,20,21,25,27,34}) {
    c3.channels[0].input_pin=pin;assert(!rc::validMappings(c3,rc::Board::Esp32C3));
  }
  set.count=2; set.channels[1].input_pin=6; set.channels[1].output_pin=7;
  assert(rc::validMappings(set,rc::Board::Pico));
  set.channels[1].input_pin=4; // One input can control multiple separately limited outputs.
  assert(rc::validMappings(set,rc::Board::Pico));
  set.channels[1].output_pin=5; assert(!rc::validMappings(set,rc::Board::Pico));
  set.channels[1].output_pin=4; assert(!rc::validMappings(set,rc::Board::Pico));
  set.channels[1].output_pin=21; assert(!rc::validMappings(set,rc::Board::Pico));
  set.channels[0].input_pin=6; set.channels[0].output_pin=4;
  set.channels[1].input_pin=7; set.channels[1].output_pin=5;
  assert(rc::validMappings(set,rc::Board::Pico)); // Both PWM channels of one slice are usable.
  set.count=1; set.channels[0].input_pin=34; set.channels[0].output_pin=25;
  assert(rc::validMappings(set,rc::Board::Esp32));
  set.channels[0].output_pin=35; assert(!rc::validMappings(set,rc::Board::Esp32));
  assert(!rc::validMappings(set,rc::Board::Pico));
  set.count=0; assert(!rc::validMappings(set,rc::Board::Pico));
  set.count=5; assert(!rc::validMappings(set,rc::Board::Esp32));
  set=rc::MappingSet{}; set.count=4;
  for(int i=0;i<4;i++) {set.channels[i].input_pin=4+2*i;set.channels[i].output_pin=5+2*i;}
  assert(rc::validMappings(set,rc::Board::Pico));
  set.count=2; set.channels[1].output_neutral=1470;
  set.channels[1].reverse_percent=10;
  rc::Bank bank;
  rc::Sample samples[rc::MAX_MAPPINGS];
  bank.step(set,0,samples); assert(!bank.arm(set,0));
  for(int i=0;i<2;i++) {samples[i].seen=true;samples[i].good=true;samples[i].pulse=1500;samples[i].last=100;}
  bank.step(set,100,samples);
  assert(!bank.arm(set,999999));
  for(int i=0;i<2;i++) samples[i].last=1000100;
  bank.step(set,1000100,samples); assert(bank.arm(set,1000100));
  assert(bank.armed && bank.channels[0].armed && bank.channels[1].armed);
  samples[0].pulse=2000; samples[1].pulse=1000;
  bank.step(set,1000101,samples);
  assert(bank.outputs[0]==1650 && bank.outputs[1]==1423);
  samples[0].last=1120000; // Input 2 has gone stale, although input 1 is healthy.
  bank.step(set,1120000,samples);
  assert(!bank.armed && !bank.channels[0].armed && !bank.channels[1].armed);
  assert(bank.outputs[0]==1500 && bank.outputs[1]==1470);
  samples[1].last=1120001; bank.step(set,1120001,samples);
  assert(!bank.arm(set,1120001)); // Restored pulses cannot rearm or bypass neutral.
  samples[0].pulse=1500;
  for(int i=0;i<2;i++) samples[i].last=1200000;
  bank.step(set,1200000,samples);
  for(int i=0;i<2;i++) samples[i].last=2300000;
  bank.step(set,2300000,samples);
  assert(!bank.arm(set,2300000)); // Channel 2 is still at reverse throttle.
  assert(!bank.channels[0].armed && !bank.channels[1].armed); // Atomic arming.
  samples[1].pulse=1500; bank.step(set,2300001,samples);
  for(int i=0;i<2;i++) samples[i].last=3300001;
  bank.step(set,3300001,samples); assert(bank.arm(set,3300001));
  samples[1].good=false; bank.step(set,3300002,samples);
  assert(!bank.armed && bank.outputs[0]==1500 && bank.outputs[1]==1470);
  std::cout << "Limiter mapping, bounds, arming, invalid pulses, timeout and rollover passed\n";
}

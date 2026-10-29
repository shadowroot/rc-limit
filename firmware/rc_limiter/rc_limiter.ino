#include <Arduino.h>
#include <ArduinoJson.h>
#include <EEPROM.h>
#include "limiter.h"
#include "identity.h"
#if defined(ARDUINO_ARCH_ESP32)
#include <esp_task_wdt.h>
#if defined(CONFIG_IDF_TARGET_ESP32C3)
#include "ble_serial.h"
BleSerial BT;
const rc::Board BOARD=rc::Board::Esp32C3;
constexpr int PWM_BITS=14;
#else
#include <BluetoothSerial.h>
#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED) || !defined(CONFIG_BT_SPP_ENABLED)
#error "Use the original ESP32 target with Bluetooth Classic SPP enabled."
#endif
BluetoothSerial BT;
const rc::Board BOARD=rc::Board::Esp32;
constexpr int PWM_BITS=16;
#endif
portMUX_TYPE captureMux = portMUX_INITIALIZER_UNLOCKED;
#define ISR_ATTR IRAM_ATTR
#else
#include <hardware/pwm.h>
#include <pico/unique_id.h>
#include <hardware/clocks.h>
#define ISR_ATTR
const rc::Board BOARD=rc::Board::Pico;
#endif

rc::MappingSet mappings;
rc::Bank bank;
struct CaptureState {
  volatile uint32_t rise=0,last=0;
  volatile int pulse=0;
  volatile bool seen=false,good=false,rising=false;
} captures[rc::MAX_MAPPINGS];
rc::Sample samples[rc::MAX_MAPPINGS];
uint32_t revision=0;
int requestId=0;
bool stored=false,bluetoothStarted=false,storageReady=false;
const int STORAGE=4096;
char deviceName[identity::MAX_NAME+1]={},deviceId[17]={},bootName[identity::MAX_NAME+1]={},bluetoothName[20]={};
void initIdentity() {
#if defined(ARDUINO_ARCH_ESP32)
  uint64_t mac=ESP.getEfuseMac();
  const uint8_t* bytes=reinterpret_cast<const uint8_t*>(&mac);
  snprintf(deviceId,sizeof(deviceId),"%02X%02X%02X%02X%02X%02X",bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5]);
#else
  pico_get_unique_board_id_string(deviceId,sizeof(deviceId));
#endif
  const char* prefix=BOARD==rc::Board::Pico?"Pico":BOARD==rc::Board::Esp32C3?"C3":"ESP32";
  snprintf(deviceName,sizeof(deviceName),"%s-%s",prefix,deviceId+strlen(deviceId)-6);
  if(storageReady) {
    uint8_t record[identity::RECORD_SIZE];
    for(size_t i=0;i<sizeof(record);i++) record[i]=EEPROM.read(STORAGE-sizeof(record)+i);
    identity::decode(record,deviceName);
  }
  strcpy(bootName,deviceName);snprintf(bluetoothName,sizeof(bluetoothName),"RC-%s",deviceName);
}
bool renameDevice(const char* name) {
  if(!storageReady) return false;
  uint8_t record[identity::RECORD_SIZE],old[identity::RECORD_SIZE];identity::encode(record,name);
  for(size_t i=0;i<sizeof(record);i++) {old[i]=EEPROM.read(STORAGE-sizeof(record)+i);EEPROM.write(STORAGE-sizeof(record)+i,record[i]);}
  if(!EEPROM.commit()) {
    for(size_t i=0;i<sizeof(old);i++) EEPROM.write(STORAGE-sizeof(old)+i,old[i]);
    return false;
  }
  strcpy(deviceName,name);return true;
}
const uint32_t MAGIC=0x52434c32,LEGACY_MAGIC=0x52434c31;

// One interrupt per unique input pin; shared inputs fan out to all matching mappings.
void ISR_ATTR capturePin(int index) {
#if defined(ARDUINO_ARCH_ESP32)
  portENTER_CRITICAL_ISR(&captureMux);
#endif
  uint32_t now=micros();
  int pin=mappings.channels[index].input_pin;
  bool high=digitalRead(pin);
  for(int i=0;i<mappings.count;i++) if(mappings.channels[i].input_pin==pin) {
    CaptureState& c=captures[i];
    if(high) { c.rise=now; c.rising=true; }
    else if(c.rising) {
      uint32_t width=now-c.rise;
      c.last=now; c.good=width>=800 && width<=2200;
      c.pulse=c.good ? int(width) : 0;
      c.seen=true; c.rising=false;
    }
  }
#if defined(ARDUINO_ARCH_ESP32)
  portEXIT_CRITICAL_ISR(&captureMux);
#endif
}
void ISR_ATTR capture0() { capturePin(0); }
void ISR_ATTR capture1() { capturePin(1); }
void ISR_ATTR capture2() { capturePin(2); }
void ISR_ATTR capture3() { capturePin(3); }
void (*const captureHandlers[])()={capture0,capture1,capture2,capture3};
void writeOutputs() {
  for(int i=0;i<mappings.count;i++) {
#if defined(ARDUINO_ARCH_ESP32)
    ledcWrite(i,uint32_t(bank.outputs[i])*((1u<<PWM_BITS)-1)/20000);
#else
    pwm_set_gpio_level(mappings.channels[i].output_pin,bank.outputs[i]);
#endif
  }
}
void attachHardware() {
  bank=rc::Bank{}; bank.disarm(mappings);
#if defined(ARDUINO_ARCH_ESP32)
  for(int i=0;i<mappings.count;i++) {
    ledcSetup(i,50,PWM_BITS);
    ledcWrite(i,uint32_t(bank.outputs[i])*((1u<<PWM_BITS)-1)/20000);
    ledcAttachPin(mappings.channels[i].output_pin,i);
  }
#else
  // Initialize each slice once: configuring a second channel must not clear the first.
  uint32_t slices=0;
  for(int i=0;i<mappings.count;i++) slices |= 1u<<pwm_gpio_to_slice_num(mappings.channels[i].output_pin);
  for(uint slice=0;slice<8;slice++) if(slices & (1u<<slice)) {
    pwm_config pwm=pwm_get_default_config();
    pwm_config_set_clkdiv(&pwm,float(clock_get_hz(clk_sys))/1000000.0f);
    pwm_config_set_wrap(&pwm,19999);
    pwm_init(slice,&pwm,false);
  }
  writeOutputs();
  for(int i=0;i<mappings.count;i++) gpio_set_function(mappings.channels[i].output_pin,GPIO_FUNC_PWM);
  pwm_set_mask_enabled(slices);
#endif
  for(int i=0;i<mappings.count;i++) {
    captures[i].rise=0; captures[i].last=0; captures[i].pulse=0;
    captures[i].seen=false; captures[i].good=false; captures[i].rising=false;
    samples[i]=rc::Sample{};
  }
  for(int i=0;i<mappings.count;i++) {
    bool duplicate=false;
    for(int j=0;j<i;j++) if(mappings.channels[j].input_pin==mappings.channels[i].input_pin) duplicate=true;
    if(!duplicate) {
      pinMode(mappings.channels[i].input_pin,INPUT);
      attachInterrupt(digitalPinToInterrupt(mappings.channels[i].input_pin),captureHandlers[i],CHANGE);
    }
  }
}
void detachHardware() {
  for(int i=0;i<mappings.count;i++) detachInterrupt(digitalPinToInterrupt(mappings.channels[i].input_pin));
  for(int i=0;i<mappings.count;i++) {
    int pin=mappings.channels[i].output_pin;
#if defined(ARDUINO_ARCH_ESP32)
    ledcDetachPin(pin);
#else
    pwm_set_enabled(pwm_gpio_to_slice_num(pin),false);
#endif
    pinMode(pin,OUTPUT); digitalWrite(pin,LOW);
  }
}
#define CONFIG_FIELDS(X) \
 X(input_pin) X(output_pin) X(input_min) X(input_neutral) X(input_max) \
 X(output_min) X(output_neutral) X(output_max) X(forward_percent) \
 X(reverse_percent) X(bidirectional) X(scale) X(invert) X(deadband) X(timeout_ms)
void encode(JsonObject obj,const rc::Config& c) {
#define ENCODE(name) obj[#name]=c.name;
  CONFIG_FIELDS(ENCODE)
#undef ENCODE
}
bool decode(JsonObjectConst obj,rc::Config& c) {
  if(obj.size()!=15) return false;
#define DECODE(name) if(!obj[#name].is<int>()) return false; c.name=obj[#name].as<int>();
  CONFIG_FIELDS(DECODE)
#undef DECODE
  return rc::valid(c);
}
void encodeMappings(JsonArray array) {
  for(int i=0;i<mappings.count;i++) encode(array.add<JsonObject>(),mappings.channels[i]);
}
bool decodeMappings(JsonArrayConst array,rc::MappingSet& next) {
  if(array.isNull() || array.size()<1 || array.size()>rc::MAX_MAPPINGS) return false;
  next.count=array.size();
  for(int i=0;i<next.count;i++) if(!decode(array[i].as<JsonObjectConst>(),next.channels[i])) return false;
  return rc::validMappings(next,BOARD);
}
uint32_t checksum(const char* data,size_t n) {
  uint32_t hash=2166136261u;
  for(size_t i=0;i<n;i++) { hash^=uint8_t(data[i]); hash*=16777619u; }
  return hash;
}
bool saveConfig() {
  if(!storageReady) return false;
  JsonDocument doc;
  doc["version"]=2; encodeMappings(doc["mappings"].to<JsonArray>());
  char data[STORAGE-12-identity::RECORD_SIZE];
  size_t len=serializeJson(doc,data,sizeof(data));
  if(len==0 || len>=sizeof(data)) return false;
  EEPROM.put(0,MAGIC);
  uint32_t length=len,hash=checksum(data,len);
  EEPROM.put(4,length); EEPROM.put(8,hash);
  for(size_t i=0;i<len;i++) EEPROM.write(12+i,data[i]);
  return EEPROM.commit();
}
bool loadConfig() {
  uint32_t magic,length,hash;
  EEPROM.get(0,magic); EEPROM.get(4,length); EEPROM.get(8,hash);
  if((magic!=MAGIC && magic!=LEGACY_MAGIC) || length==0 || length>=STORAGE-12) return false;
  char data[STORAGE-12];
  for(size_t i=0;i<length;i++) data[i]=EEPROM.read(12+i);
  if(hash!=checksum(data,length)) return false;
  JsonDocument doc;
  if(deserializeJson(doc,data,length)) return false;
  rc::MappingSet next;
  if(magic==LEGACY_MAGIC) {
    if(!decode(doc.as<JsonObjectConst>(),next.channels[0]) || !rc::validMappings(next,BOARD)) return false;
  } else if(!doc["version"].is<int>() || doc["version"].as<int>()!=2 || !decodeMappings(doc["mappings"].as<JsonArrayConst>(),next)) return false;
  mappings=next; return true;
}
void update() {
#if defined(ARDUINO_ARCH_ESP32)
  portENTER_CRITICAL(&captureMux);
#else
  noInterrupts();
#endif
  for(int i=0;i<mappings.count;i++) {
    samples[i].last=captures[i].last; samples[i].pulse=captures[i].pulse;
    samples[i].seen=captures[i].seen; samples[i].good=captures[i].good;
  }
#if defined(ARDUINO_ARCH_ESP32)
  portEXIT_CRITICAL(&captureMux);
#else
  interrupts();
#endif
  bank.step(mappings,micros(),samples); writeOutputs();
}
void response(Stream& io,const char* error=nullptr) {
  JsonDocument doc;
  doc["ok"]=error==nullptr; doc["id"]=requestId;
  if(error) doc["error"]=error;
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  doc["board"]="esp32c3";
#elif defined(ARDUINO_ARCH_ESP32)
  doc["board"]="esp32";
#else
  doc["board"]="pico";
#endif
  doc["device_name"]=deviceName;doc["device_id"]=deviceId;
  doc["name_pending_restart"]=BOARD!=rc::Board::Pico && strcmp(deviceName,bootName)!=0;
  doc["protocol_version"]=2; doc["max_mappings"]=rc::MAX_MAPPINGS;
  doc["armed"]=bank.armed; doc["signal_ok"]=bank.healthy;
  // Legacy clients can still inspect channel 1. Legacy set cannot erase multiple mappings.
  doc["input_us"]=samples[0].pulse; doc["output_us"]=bank.outputs[0];
  encode(doc["config"].to<JsonObject>(),mappings.channels[0]);
  doc["revision"]=revision; doc["saved"]=stored;
  encodeMappings(doc["mappings"].to<JsonArray>());
  JsonArray states=doc["channel_states"].to<JsonArray>();
  for(int i=0;i<mappings.count;i++) {
    JsonObject state=states.add<JsonObject>();
    state["input_us"]=samples[i].pulse; state["output_us"]=bank.outputs[i];
    state["signal_ok"]=bank.channels[i].healthy; state["armed"]=bank.channels[i].armed;
  }
  JsonObject transports=doc["transports"].to<JsonObject>();
  transports["usb_serial"]=true; transports["bluetooth_serial"]=bluetoothStarted;
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  transports["bluetooth_type"]="ble";
  transports["bluetooth_name"]=bluetoothName;
  transports["ble_service"]=BleSerial::SERVICE;
#if ARDUINO_USB_CDC_ON_BOOT
  transports["usb_interface"]="native_cdc";
#else
  transports["usb_interface"]="usb_uart";
#endif
#else
  transports["bluetooth_type"]=bluetoothStarted?"classic_spp":"none";
  if(bluetoothStarted) transports["bluetooth_name"]=bluetoothName;
#endif
  serializeJson(doc,io); io.println();
}
void command(Stream& io,const char* line) {
  JsonDocument doc;
  requestId=0;
  if(deserializeJson(doc,line)) { response(io,"invalid_json"); return; }
  requestId=doc["id"] | 0;
  const char* cmd=doc["cmd"] | "";
  update();
  if(!strcmp(cmd,"get")) { response(io); return; }
  if(!strcmp(cmd,"disarm")) { bank.disarm(mappings); writeOutputs(); response(io); return; }
  if(!strcmp(cmd,"arm")) { bool ok=bank.arm(mappings,micros()); response(io,ok?nullptr:"hold_all_neutral_for_1s"); return; }
  if(bank.armed) { response(io,"disarm_first"); return; }
  if(!strcmp(cmd,"set_name")) {
    const char* name=doc["name"].is<const char*>()?doc["name"].as<const char*>():nullptr;
    if(!identity::valid(name) || strstr(line,"\\u0000")) {response(io,"invalid_name");return;}
    response(io,renameDevice(name)?nullptr:"name_save_failed");return;
  }
  if(!strcmp(cmd,"set") || !strcmp(cmd,"set_mappings")) {
    rc::MappingSet next;
    if(!strcmp(cmd,"set")) {
      if(mappings.count!=1) { response(io,"use_set_mappings"); return; }
      if(!decode(doc["config"].as<JsonObjectConst>(),next.channels[0]) || !rc::validMappings(next,BOARD)) { response(io,"invalid_config"); return; }
    } else if(!decodeMappings(doc["mappings"].as<JsonArrayConst>(),next)) { response(io,"invalid_mappings"); return; }
    detachHardware(); mappings=next; revision++; stored=false;
    attachHardware(); response(io); return;
  }
  if(!strcmp(cmd,"save")) {
    bank.disarm(mappings); writeOutputs();
    stored=saveConfig(); response(io,stored?nullptr:"save_failed"); return;
  }
  response(io,"unknown_command");
}
struct Lines {
  char data[3072]; size_t used=0; bool overflow=false;
  void reset() { used=0; overflow=false; }
  void poll(Stream& io) {
    for(int n=0;n<64 && io.available();n++) {
      char ch=io.read();
      if(ch=='\n') {
        if(overflow) { requestId=0; response(io,"line_too_long"); }
        else if(used) { data[used]=0; command(io,data); }
        used=0; overflow=false;
      } else if(ch!='\r') {
        if(used<sizeof(data)-1 && !overflow) data[used++]=ch; else overflow=true;
      }
    }
  }
} usbLines,btLines;
void setup() {
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  mappings.channels[0].input_pin=3; mappings.channels[0].output_pin=4;
#elif defined(ARDUINO_ARCH_ESP32)
  mappings.channels[0].input_pin=27; mappings.channels[0].output_pin=25;
#endif
#if defined(ARDUINO_ARCH_ESP32)
  storageReady=EEPROM.begin(STORAGE);
#else
  EEPROM.begin(STORAGE); storageReady=EEPROM.length()==STORAGE;
#endif
  initIdentity();stored=storageReady && loadConfig();
  attachHardware(); Serial.begin(115200);
#if defined(ARDUINO_ARCH_ESP32)
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  bluetoothStarted=BT.begin(bluetoothName);
#else
  bluetoothStarted=BT.begin(bluetoothName);
#endif
  esp_task_wdt_init(2,true); esp_task_wdt_add(nullptr);
#else
  rp2040.wdt_begin(2000);
#endif
}
void loop() {
  update(); usbLines.poll(Serial);
#if defined(ARDUINO_ARCH_ESP32)
#if defined(CONFIG_IDF_TARGET_ESP32C3)
  static uint32_t bleEpoch=0;
  if(BT.epoch()!=bleEpoch) { bleEpoch=BT.epoch(); btLines.reset(); }
  BT.pollTx();
#endif
  update(); if(bluetoothStarted) btLines.poll(BT); esp_task_wdt_reset();
#else
  rp2040.wdt_reset();
#endif
  delay(1);
}

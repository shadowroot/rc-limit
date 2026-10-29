#pragma once
// ESP32-C3 UART-style BLE transport. Callbacks only queue bytes; commands run in loop().
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

class BleSerial : public Stream {
 public:
  static constexpr const char* SERVICE="6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  static constexpr const char* RX="6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  static constexpr const char* TX="6e400003-b5a3-f393-e0a9-e50e24dcca9e";
  uint32_t epoch() { portENTER_CRITICAL(&mux); uint32_t e=generation; portEXIT_CRITICAL(&mux); return e; }
  bool begin() {
    BLEDevice::init("RC-Limiter-C3");
    if(!BLEDevice::getInitialized()) return false;
    server=BLEDevice::createServer();
    if(!server) return false;
    server->setCallbacks(new ServerCallbacks(*this));
    BLEService* service=server->createService(SERVICE);
    tx=service->createCharacteristic(TX,BLECharacteristic::PROPERTY_NOTIFY);
    tx->addDescriptor(new BLE2902());
    tx->setCallbacks(new TxCallbacks(*this));
    BLECharacteristic* rx=service->createCharacteristic(RX,BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
    rx->setCallbacks(new RxCallbacks(*this));
    service->start();
    BLEAdvertising* advertising=BLEDevice::getAdvertising();
    advertising->addServiceUUID(SERVICE); advertising->setScanResponse(true); advertising->start();
    return true;
  }
  int available() override {
    portENTER_CRITICAL(&mux); int n=faulted?0:((rxHead-rxTail)&4095); portEXIT_CRITICAL(&mux); return n;
  }
  int peek() override {
    portENTER_CRITICAL(&mux); int ch=(faulted || rxHead==rxTail)?-1:rxBuffer[rxTail]; portEXIT_CRITICAL(&mux); return ch;
  }
  int read() override {
    portENTER_CRITICAL(&mux);
    int ch=-1;
    if(!faulted && rxHead!=rxTail) { ch=rxBuffer[rxTail]; rxTail=(rxTail+1)&4095; }
    portEXIT_CRITICAL(&mux); return ch;
  }
  size_t write(uint8_t ch) override { return write(&ch,1); }
  size_t write(const uint8_t* data,size_t size) override {
    portENTER_CRITICAL(&mux);
    if(!connected || faulted) { portEXIT_CRITICAL(&mux); return 0; }
    if(size>size_t((txTail-txHead-1)&8191)) { fail(); portEXIT_CRITICAL(&mux); return 0; }
    for(size_t i=0;i<size;i++) { txBuffer[txHead]=data[i]; txHead=(txHead+1)&8191; }
    portEXIT_CRITICAL(&mux); return size;
  }
  void flush() override {} // Nonblocking: pollTx() drains the queue while receiver checks continue.
  void pollTx() {
    if(restartAdvertising) { restartAdvertising=false; BLEDevice::startAdvertising(); }
    if(uint32_t(millis()-lastTx)<5) return;
    uint8_t chunk[20]; size_t size=0; uint16_t start=0; uint32_t sendEpoch=0;
    portENTER_CRITICAL(&mux);
    start=txTail; sendEpoch=generation;
    if(connected && !faulted) while(size<sizeof(chunk) && ((start+size)&8191)!=txHead) {
      chunk[size]=txBuffer[(start+size)&8191]; size++;
    }
    portEXIT_CRITICAL(&mux);
    if(size) {
      notificationAccepted=false; tx->setValue(chunk,size); tx->notify(); lastTx=millis();
      // The pinned BLE library reports stack acceptance synchronously. Retain bytes
      // during congestion or before subscription instead of silently dropping a chunk.
      portENTER_CRITICAL(&mux);
      if(notificationAccepted && generation==sendEpoch && txTail==start) txTail=(txTail+size)&8191;
      portEXIT_CRITICAL(&mux);
    }
  }
 private:
  portMUX_TYPE mux=portMUX_INITIALIZER_UNLOCKED;
  uint8_t rxBuffer[4096],txBuffer[8192];
  uint16_t rxHead=0,rxTail=0,txHead=0,txTail=0;
  bool connected=false,faulted=false;
  volatile bool restartAdvertising=false;
  volatile bool notificationAccepted=false;
  uint32_t generation=0,lastTx=0;
  BLEServer* server=nullptr;
  BLECharacteristic* tx=nullptr;
  void fail() { faulted=true; rxHead=rxTail=txHead=txTail=0; generation++; }
  void session(bool active) {
    portENTER_CRITICAL(&mux);
    connected=active; faulted=false; rxHead=rxTail=txHead=txTail=0; generation++;
    portEXIT_CRITICAL(&mux);
  }
  class ServerCallbacks : public BLEServerCallbacks {
    BleSerial& owner;
   public:
    explicit ServerCallbacks(BleSerial& owner):owner(owner){}
    void onConnect(BLEServer*) override { owner.session(true); }
    void onDisconnect(BLEServer*) override { owner.session(false); owner.restartAdvertising=true; }
  };
  class RxCallbacks : public BLECharacteristicCallbacks {
    BleSerial& owner;
   public:
    explicit RxCallbacks(BleSerial& owner):owner(owner){}
    void onWrite(BLECharacteristic* characteristic) override {
      std::string data=characteristic->getValue();
      portENTER_CRITICAL(&owner.mux);
      if(!owner.faulted) {
        if(data.size()>size_t((owner.rxTail-owner.rxHead-1)&4095)) owner.fail();
        else for(char ch:data) { owner.rxBuffer[owner.rxHead]=uint8_t(ch); owner.rxHead=(owner.rxHead+1)&4095; }
      }
      portEXIT_CRITICAL(&owner.mux);
    }
  };
  class TxCallbacks : public BLECharacteristicCallbacks {
    BleSerial& owner;
   public:
    explicit TxCallbacks(BleSerial& owner):owner(owner){}
    void onStatus(BLECharacteristic*,Status status,uint32_t) override {
      owner.notificationAccepted=status==Status::SUCCESS_NOTIFY;
    }
  };
};
constexpr const char* BleSerial::SERVICE;
constexpr const char* BleSerial::RX;
constexpr const char* BleSerial::TX;

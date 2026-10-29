#include "transport.hpp"
#include <cstring>
#include "driver/uart.h"
#if CONFIG_IDF_TARGET_ESP32C3
#include "driver/usb_serial_jtag.h"
#endif
#include "esp_err.h"
namespace io {
Port usb,radio;
std::atomic<bool> radioReady{false};
void Port::init() {
    rx=xQueueCreate(4096,sizeof(uint8_t));tx=xMessageBufferCreate(16384);
    configASSERT(rx && tx);
}
void Port::session(bool active) {
    connected.store(false);epoch.fetch_add(1);xQueueReset(rx);dropping=false;
    // TX messages carry an epoch and are discarded by the single TX consumer.
    connected.store(active);
}
void Port::receive(const uint8_t* data,size_t size) {
    for(size_t i=0;i<size;i++) {
        if(dropping) {if(data[i]=='\n') dropping=false;continue;}
        if(xQueueSend(rx,&data[i],0)!=pdTRUE) {
            dropping=data[i]!='\n';epoch.fetch_add(1);xQueueReset(rx);
        }
    }
}
bool Port::send(const char* json) {
    if(!connected.load()) return false;
    size_t length=strlen(json);
    if(length+1>MAX_REPLY) return false;
    uint8_t message[sizeof(uint32_t)+MAX_REPLY];
    uint32_t generation=epoch.load();memcpy(message,&generation,sizeof(generation));
    memcpy(message+sizeof(generation),json,length);message[sizeof(generation)+length]='\n';
    size_t size=sizeof(generation)+length+1;
    return xMessageBufferSend(tx,message,size,0)==size;
}
static void usbRxTask(void*) {
    uint8_t buffer[256];
    for(;;) {
#if CONFIG_IDF_TARGET_ESP32C3 && RC_USB_NATIVE
        int size=usb_serial_jtag_read_bytes(buffer,sizeof(buffer),pdMS_TO_TICKS(20));
#else
        int size=uart_read_bytes(UART_NUM_0,buffer,sizeof(buffer),pdMS_TO_TICKS(20));
#endif
        if(size>0) usb.receive(buffer,size);
    }
}
static bool sendUsb(const uint8_t* bytes,size_t size) {
    size_t sent=0;
    while(sent<size) {
#if CONFIG_IDF_TARGET_ESP32C3 && RC_USB_NATIVE
        int n=usb_serial_jtag_write_bytes(bytes+sent,size-sent,pdMS_TO_TICKS(50));
#else
        int n=uart_write_bytes(UART_NUM_0,bytes+sent,size-sent);
#endif
        if(n<=0) return false;
        sent+=n;
    }
    return true;
}
void txTask(void* context) {
    Port& port=*static_cast<Port*>(context);
    uint8_t message[sizeof(uint32_t)+MAX_REPLY];
    for(;;) {
        size_t size=xMessageBufferReceive(port.tx,message,sizeof(message),portMAX_DELAY);
        if(size<=sizeof(uint32_t)) continue;
        uint32_t generation;memcpy(&generation,message,sizeof(generation));
        if(generation!=port.epoch.load() || !port.connected.load()) continue;
        if(&port==&usb) sendUsb(message+sizeof(generation),size-sizeof(generation));
        else sendRadio(message+sizeof(generation),size-sizeof(generation),generation);
    }
}
void initUsb() {
#if CONFIG_IDF_TARGET_ESP32C3 && RC_USB_NATIVE
    usb_serial_jtag_driver_config_t config={};config.rx_buffer_size=4096;config.tx_buffer_size=4096;
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&config));
#else
    uart_config_t config={};config.baud_rate=115200;config.data_bits=UART_DATA_8_BITS;
    config.parity=UART_PARITY_DISABLE;config.stop_bits=UART_STOP_BITS_1;config.flow_ctrl=UART_HW_FLOWCTRL_DISABLE;
    config.source_clk=UART_SCLK_DEFAULT;
    ESP_ERROR_CHECK(uart_param_config(UART_NUM_0,&config));
#if CONFIG_IDF_TARGET_ESP32C3
    ESP_ERROR_CHECK(uart_set_pin(UART_NUM_0,21,20,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE));
#else
    ESP_ERROR_CHECK(uart_set_pin(UART_NUM_0,1,3,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE));
#endif
    ESP_ERROR_CHECK(uart_driver_install(UART_NUM_0,4096,4096,0,nullptr,0));
#endif
    usb.session(true);
    xTaskCreate(usbRxTask,"usb_rx",3072,nullptr,4,nullptr);
    xTaskCreate(txTask,"usb_tx",6144,&usb,3,nullptr);
}
}

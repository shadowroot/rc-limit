#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/message_buffer.h"
#if !defined(RC_USB_NATIVE)
#if CONFIG_IDF_TARGET_ESP32C3
#define RC_USB_NATIVE 1
#else
#define RC_USB_NATIVE 0
#endif
#endif
namespace io {
constexpr size_t MAX_LINE=3071;
constexpr size_t MAX_REPLY=4096;
struct Port {
    QueueHandle_t rx=nullptr;
    MessageBufferHandle_t tx=nullptr;
    std::atomic<uint32_t> epoch{0};
    std::atomic<bool> connected{false};
    bool dropping=false; // Only the RX producer touches this field.
    void init();
    void session(bool active);
    void receive(const uint8_t* bytes,size_t length);
    bool send(const char* json);
};
extern Port usb,radio;
extern std::atomic<bool> radioReady;
void initUsb();
void initRadio();
void txTask(void* context);
bool sendRadio(const uint8_t* data,size_t size,uint32_t epoch);
}

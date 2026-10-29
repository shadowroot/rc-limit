#include <cstring>
#include <cstdlib>
#include "model_json.hpp"
#include "identity.h"
#include "esp_mac.h"
#include <cstdio>
#include "transport.hpp"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_timer.h"
#include "esp_task_wdt.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "hal/gpio_ll.h"
#include "soc/gpio_struct.h"
namespace {
#if CONFIG_IDF_TARGET_ESP32C3
constexpr rc::Board BOARD=rc::Board::Esp32C3;
constexpr int PWM_BITS=14;
const char* BOARD_NAME="esp32c3";
#else
constexpr rc::Board BOARD=rc::Board::Esp32;
constexpr int PWM_BITS=16;
const char* BOARD_NAME="esp32";
#endif
rc::MappingSet mappings;
rc::Bank bank;
struct Capture {uint32_t rise=0,last=0;int pulse=0;bool rising=false,seen=false,good=false;} captures[rc::MAX_MAPPINGS];
rc::Sample samples[rc::MAX_MAPPINGS];
portMUX_TYPE captureMux=portMUX_INITIALIZER_UNLOCKED;
bool storageReady=false,stored=false;
uint32_t revision=0;
char deviceName[identity::MAX_NAME+1]={},deviceId[17]={},bootName[identity::MAX_NAME+1]={};
void initIdentity() {
    uint8_t mac[6];ESP_ERROR_CHECK(esp_efuse_mac_get_default(mac));
    snprintf(deviceId,sizeof(deviceId),"%02X%02X%02X%02X%02X%02X",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
    snprintf(deviceName,sizeof(deviceName),"%s-%s",BOARD==rc::Board::Esp32C3?"C3":"ESP32",deviceId+6);
    nvs_handle_t handle;
    bool found=false;
    if(storageReady && nvs_open("rc_limit",NVS_READONLY,&handle)==ESP_OK) {
        char name[identity::MAX_NAME+1];size_t size=sizeof(name);
        if(nvs_get_str(handle,"name",name,&size)==ESP_OK && identity::valid(name)) {strcpy(deviceName,name);found=true;}
        nvs_close(handle);
    }
    if(!found && storageReady && nvs_open("eeprom",NVS_READONLY,&handle)==ESP_OK) {
        uint8_t legacy[4096];size_t size=sizeof(legacy);
        if(nvs_get_blob(handle,"eeprom",legacy,&size)==ESP_OK && size==sizeof(legacy)) identity::decode(legacy+sizeof(legacy)-identity::RECORD_SIZE,deviceName);
        nvs_close(handle);
    }
    strcpy(bootName,deviceName);snprintf(io::bluetoothName,sizeof(io::bluetoothName),"RC-%s",bootName);
}
bool renameDevice(const char* name) {
    if(!storageReady) return false;
    nvs_handle_t handle;if(nvs_open("rc_limit",NVS_READWRITE,&handle)!=ESP_OK) return false;
    bool ok=nvs_set_str(handle,"name",name)==ESP_OK && nvs_commit(handle)==ESP_OK;nvs_close(handle);
    if(ok) strcpy(deviceName,name);
    return ok;
}
void IRAM_ATTR capture(void* context) {
    int index=static_cast<int>(reinterpret_cast<uintptr_t>(context));
    portENTER_CRITICAL_ISR(&captureMux);
    uint32_t now=static_cast<uint32_t>(esp_timer_get_time());
    int pin=mappings.channels[index].input_pin;
    bool high=gpio_ll_get_level(&GPIO,pin);
    for(int i=0;i<mappings.count;i++) if(mappings.channels[i].input_pin==pin) {
        Capture& c=captures[i];
        if(high) {c.rise=now;c.rising=true;}
        else if(c.rising) {
            uint32_t width=now-c.rise;c.last=now;c.good=width>=800 && width<=2200;
            c.pulse=c.good?static_cast<int>(width):0;c.seen=true;c.rising=false;
        }
    }
    portEXIT_CRITICAL_ISR(&captureMux);
}
void writeOutputs() {
    for(int i=0;i<mappings.count;i++) {
        uint32_t duty=static_cast<uint32_t>(bank.outputs[i])*((1u<<PWM_BITS)-1)/20000;
        ledc_set_duty(LEDC_LOW_SPEED_MODE,static_cast<ledc_channel_t>(i),duty);
        ledc_update_duty(LEDC_LOW_SPEED_MODE,static_cast<ledc_channel_t>(i));
    }
}
void attachHardware() {
    bank=rc::Bank{};bank.disarm(mappings);
    ledc_timer_config_t timer={};timer.speed_mode=LEDC_LOW_SPEED_MODE;
    timer.duty_resolution=static_cast<ledc_timer_bit_t>(PWM_BITS);timer.timer_num=LEDC_TIMER_0;
    timer.freq_hz=50;timer.clk_cfg=LEDC_AUTO_CLK;ESP_ERROR_CHECK(ledc_timer_config(&timer));
    for(int i=0;i<mappings.count;i++) {
        captures[i]=Capture{};samples[i]=rc::Sample{};
        ledc_channel_config_t output={};output.gpio_num=mappings.channels[i].output_pin;
        output.speed_mode=LEDC_LOW_SPEED_MODE;output.channel=static_cast<ledc_channel_t>(i);
        output.timer_sel=LEDC_TIMER_0;output.intr_type=LEDC_INTR_DISABLE;
        output.duty=static_cast<uint32_t>(bank.outputs[i])*((1u<<PWM_BITS)-1)/20000;
        ESP_ERROR_CHECK(ledc_channel_config(&output));
    }
    for(int i=0;i<mappings.count;i++) {
        bool duplicate=false;for(int j=0;j<i;j++) duplicate|=mappings.channels[j].input_pin==mappings.channels[i].input_pin;
        if(duplicate) continue;
        gpio_config_t input={};input.pin_bit_mask=1ULL<<mappings.channels[i].input_pin;
        input.mode=GPIO_MODE_INPUT;input.intr_type=GPIO_INTR_ANYEDGE;
        ESP_ERROR_CHECK(gpio_config(&input));
        ESP_ERROR_CHECK(gpio_isr_handler_add(static_cast<gpio_num_t>(mappings.channels[i].input_pin),capture,reinterpret_cast<void*>(static_cast<uintptr_t>(i))));
    }
}
void detachHardware() {
    for(int i=0;i<mappings.count;i++) {
        gpio_num_t pin=static_cast<gpio_num_t>(mappings.channels[i].input_pin);
        gpio_intr_disable(pin);gpio_isr_handler_remove(pin);
    }
    for(int i=0;i<mappings.count;i++) {
        ledc_stop(LEDC_LOW_SPEED_MODE,static_cast<ledc_channel_t>(i),0);
        gpio_num_t pin=static_cast<gpio_num_t>(mappings.channels[i].output_pin);
        gpio_reset_pin(pin);gpio_set_direction(pin,GPIO_MODE_OUTPUT);gpio_set_level(pin,0);
    }
}
void update() {
    portENTER_CRITICAL(&captureMux);
    for(int i=0;i<mappings.count;i++) {
        const Capture& c=captures[i];samples[i].last=c.last;samples[i].pulse=c.pulse;samples[i].seen=c.seen;samples[i].good=c.good;
    }
    portEXIT_CRITICAL(&captureMux);
    bank.step(mappings,static_cast<uint32_t>(esp_timer_get_time()),samples);writeOutputs();
}
uint32_t checksum(const uint8_t* data,size_t size) {
    uint32_t hash=2166136261u;for(size_t i=0;i<size;i++){hash^=data[i];hash*=16777619u;}return hash;
}
bool parseStored(const char* json,rc::MappingSet& result) {
    cJSON* value=cJSON_ParseWithOpts(json,nullptr,true);bool valid=codec::profile(value,BOARD,result);cJSON_Delete(value);return valid;
}
bool loadConfig() {
    nvs_handle_t handle;char data[4096];size_t size=sizeof(data);
    esp_err_t opened=nvs_open("rc_limit",NVS_READONLY,&handle);
    if(opened==ESP_OK) {
        esp_err_t result=nvs_get_str(handle,"mappings",data,&size);nvs_close(handle);
        if(result==ESP_OK) return parseStored(data,mappings);
        if(result!=ESP_ERR_NVS_NOT_FOUND) return false;
    } else if(opened!=ESP_ERR_NVS_NOT_FOUND) return false;
    // Import the Arduino EEPROM namespace without overwriting its original blob.
    if(nvs_open("eeprom",NVS_READONLY,&handle)!=ESP_OK) return false;
    size=sizeof(data);esp_err_t result=nvs_get_blob(handle,"eeprom",data,&size);nvs_close(handle);
    if(result!=ESP_OK || size<12) return false;
    uint32_t magic,length,hash;memcpy(&magic,data,4);memcpy(&length,data+4,4);memcpy(&hash,data+8,4);
    if((magic!=0x52434c31 && magic!=0x52434c32) || length==0 || length>=sizeof(data)-12 || length>size-12) return false;
    if(hash!=checksum(reinterpret_cast<uint8_t*>(data+12),length)) return false;
    data[12+length]=0;return parseStored(data+12,mappings);
}
bool saveConfig() {
    if(!storageReady) return false;
    cJSON* value=codec::profile(mappings);char* json=cJSON_PrintUnformatted(value);cJSON_Delete(value);
    if(!json) return false;
    nvs_handle_t handle;bool success=false;
    if(nvs_open("rc_limit",NVS_READWRITE,&handle)==ESP_OK) {
        success=nvs_set_str(handle,"mappings",json)==ESP_OK && nvs_commit(handle)==ESP_OK;nvs_close(handle);
    }
    cJSON_free(json);return success;
}
void response(io::Port& port,int id,const char* error=nullptr) {
    cJSON* doc=cJSON_CreateObject();
    cJSON_AddBoolToObject(doc,"ok",!error);cJSON_AddNumberToObject(doc,"id",id);
    if(error) cJSON_AddStringToObject(doc,"error",error);
    cJSON_AddStringToObject(doc,"board",BOARD_NAME);cJSON_AddStringToObject(doc,"framework","esp-idf");
    cJSON_AddStringToObject(doc,"device_name",deviceName);cJSON_AddStringToObject(doc,"device_id",deviceId);
    cJSON_AddBoolToObject(doc,"name_pending_restart",strcmp(deviceName,bootName)!=0);
    cJSON_AddNumberToObject(doc,"protocol_version",2);cJSON_AddNumberToObject(doc,"max_mappings",rc::MAX_MAPPINGS);
    cJSON_AddBoolToObject(doc,"armed",bank.armed);cJSON_AddBoolToObject(doc,"signal_ok",bank.healthy);
    cJSON_AddNumberToObject(doc,"input_us",samples[0].pulse);cJSON_AddNumberToObject(doc,"output_us",bank.outputs[0]);
    cJSON_AddNumberToObject(doc,"revision",revision);cJSON_AddBoolToObject(doc,"saved",stored);
    cJSON_AddItemToObject(doc,"config",codec::channel(mappings.channels[0]));
    cJSON_AddItemToObject(doc,"mappings",codec::mappings(mappings));
    cJSON* states=cJSON_AddArrayToObject(doc,"channel_states");
    for(int i=0;i<mappings.count;i++) {
        cJSON* state=cJSON_CreateObject();cJSON_AddItemToArray(states,state);
        cJSON_AddNumberToObject(state,"input_us",samples[i].pulse);cJSON_AddNumberToObject(state,"output_us",bank.outputs[i]);
        cJSON_AddBoolToObject(state,"signal_ok",bank.channels[i].healthy);cJSON_AddBoolToObject(state,"armed",bank.channels[i].armed);
    }
    cJSON* transports=cJSON_AddObjectToObject(doc,"transports");
    cJSON_AddBoolToObject(transports,"usb_serial",true);cJSON_AddBoolToObject(transports,"bluetooth_serial",io::radioReady.load());
#if CONFIG_IDF_TARGET_ESP32C3
    cJSON_AddStringToObject(transports,"bluetooth_type","ble");cJSON_AddStringToObject(transports,"bluetooth_name",io::bluetoothName);
    cJSON_AddStringToObject(transports,"ble_service","6e400001-b5a3-f393-e0a9-e50e24dcca9e");
    cJSON_AddStringToObject(transports,"usb_interface",RC_USB_NATIVE?"native_cdc":"usb_uart");
#else
    cJSON_AddStringToObject(transports,"bluetooth_type","classic_spp");cJSON_AddStringToObject(transports,"bluetooth_name",io::bluetoothName);
#endif
    char* json=cJSON_PrintUnformatted(doc);cJSON_Delete(doc);
    if(json) {port.send(json);cJSON_free(json);}
}
void command(io::Port& port,const char* line) {
    cJSON* doc=cJSON_ParseWithOpts(line,nullptr,true);int id=0;
    if(!doc) {response(port,0,"invalid_json");return;}
    codec::integer(cJSON_GetObjectItemCaseSensitive(doc,"id"),id);
    const cJSON* item=cJSON_GetObjectItemCaseSensitive(doc,"cmd");const char* cmd=cJSON_IsString(item)?item->valuestring:"";
    update();const char* error=nullptr;
    if(!strcmp(cmd,"get")) {}
    else if(!strcmp(cmd,"disarm")) {bank.disarm(mappings);writeOutputs();}
    else if(!strcmp(cmd,"arm")) {if(!bank.arm(mappings,static_cast<uint32_t>(esp_timer_get_time()))) error="hold_all_neutral_for_1s";}
    else if(bank.armed) error="disarm_first";
    else if(!strcmp(cmd,"set_name")) {
        const cJSON* value=cJSON_GetObjectItemCaseSensitive(doc,"name");
        const char* name=cJSON_IsString(value)?value->valuestring:nullptr;
        if(!identity::valid(name) || strstr(line,"\\u0000")) error="invalid_name";
        else if(!renameDevice(name)) error="name_save_failed";
    }
    else if(!strcmp(cmd,"set") || !strcmp(cmd,"set_mappings")) {
        rc::MappingSet next;bool valid=false;
        if(!strcmp(cmd,"set")) {
            if(mappings.count!=1) error="use_set_mappings";
            else {valid=codec::channel(cJSON_GetObjectItemCaseSensitive(doc,"config"),next.channels[0]) && rc::validMappings(next,BOARD);if(!valid) error="invalid_config";}
        } else {valid=codec::mappings(cJSON_GetObjectItemCaseSensitive(doc,"mappings"),BOARD,next);if(!valid) error="invalid_mappings";}
        if(valid) {detachHardware();mappings=next;revision++;stored=false;attachHardware();}
    } else if(!strcmp(cmd,"save")) {
        bank.disarm(mappings);writeOutputs();stored=saveConfig();if(!stored) error="save_failed";
    } else error="unknown_command";
    cJSON_Delete(doc);response(port,id,error);
}
struct Lines {
    char data[io::MAX_LINE+1];size_t used=0;bool overflow=false;uint32_t epoch=0;
    void poll(io::Port& port) {
        uint8_t ch;
        for(int i=0;i<64;i++) {
            uint32_t current=port.epoch.load();if(epoch!=current){epoch=current;used=0;overflow=false;}
            if(xQueueReceive(port.rx,&ch,0)!=pdTRUE) break;
            if(ch=='\n') {
                if(overflow) response(port,0,"line_too_long");
                else if(used) {data[used]=0;command(port,data);}
                used=0;overflow=false;
            } else if(ch!='\r') {if(used<io::MAX_LINE && !overflow)data[used++]=static_cast<char>(ch);else overflow=true;}
        }
    }
} usbLines,radioLines;
void controlTask(void*) {
    esp_task_wdt_config_t watchdog={};watchdog.timeout_ms=2000;watchdog.trigger_panic=true;
    esp_err_t status=esp_task_wdt_init(&watchdog);
    if(status==ESP_ERR_INVALID_STATE) status=esp_task_wdt_reconfigure(&watchdog);
    ESP_ERROR_CHECK(status);ESP_ERROR_CHECK(esp_task_wdt_add(nullptr));
    for(;;) {
        update();usbLines.poll(io::usb);update();radioLines.poll(io::radio);esp_task_wdt_reset();
        vTaskDelay(pdMS_TO_TICKS(1)>0?pdMS_TO_TICKS(1):1);
    }
}
}
extern "C" void app_main() {
#if CONFIG_IDF_TARGET_ESP32C3
    mappings.channels[0].input_pin=3;mappings.channels[0].output_pin=4;
#else
    mappings.channels[0].input_pin=27;mappings.channels[0].output_pin=25;
#endif
    storageReady=nvs_flash_init()==ESP_OK;initIdentity();stored=storageReady && loadConfig();
    ESP_ERROR_CHECK(gpio_install_isr_service(ESP_INTR_FLAG_IRAM));attachHardware();
    io::usb.init();io::radio.init();io::initUsb();
    xTaskCreatePinnedToCore(controlTask,"rc_control",16384,nullptr,10,nullptr,xPortGetCoreID());
    if(storageReady) io::initRadio();
}

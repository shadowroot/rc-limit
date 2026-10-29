#include "transport.hpp"
#include <cstring>
#include <algorithm>
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_timer.h"
#include "freertos/event_groups.h"
#if CONFIG_IDF_TARGET_ESP32
#include "esp_bt_device.h"
#include "esp_gap_bt_api.h"
#include "esp_spp_api.h"
#else
#include "esp_gap_ble_api.h"
#include "esp_gatts_api.h"
#include "esp_gatt_common_api.h"
#endif
namespace io {
char bluetoothName[20]="RC-Limiter";
namespace {
EventGroupHandle_t events;
constexpr EventBits_t WRITE_ACK=1,UNCONGESTED=2;
#if CONFIG_IDF_TARGET_ESP32
std::atomic<uint32_t> sppHandle{0};
std::atomic<bool> writeSuccess{false};
void gapCallback(esp_bt_gap_cb_event_t event,esp_bt_gap_cb_param_t* param) {
    if(event==ESP_BT_GAP_CFM_REQ_EVT) esp_bt_gap_ssp_confirm_reply(param->cfm_req.bda,true);
    if(event==ESP_BT_GAP_PIN_REQ_EVT) {
        esp_bt_pin_code_t pin={};memcpy(pin,"1234",4);esp_bt_gap_pin_reply(param->pin_req.bda,true,4,pin);
    }
}
void sppCallback(esp_spp_cb_event_t event,esp_spp_cb_param_t* param) {
    switch(event) {
    case ESP_SPP_INIT_EVT:
        if(param->init.status==ESP_SPP_SUCCESS) esp_spp_start_srv(ESP_SPP_SEC_NONE,ESP_SPP_ROLE_SLAVE,0,"RC-Limiter");
        break;
    case ESP_SPP_START_EVT:
        if(param->start.status==ESP_SPP_SUCCESS) {
            esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE,ESP_BT_GENERAL_DISCOVERABLE);radioReady.store(true);
        }
        break;
    case ESP_SPP_SRV_OPEN_EVT:
        sppHandle.store(param->srv_open.handle);radio.session(true);xEventGroupSetBits(events,UNCONGESTED);break;
    case ESP_SPP_CLOSE_EVT:
        sppHandle.store(0);radio.session(false);xEventGroupSetBits(events,WRITE_ACK|UNCONGESTED);break;
    case ESP_SPP_DATA_IND_EVT:radio.receive(param->data_ind.data,param->data_ind.len);break;
    case ESP_SPP_WRITE_EVT:
        writeSuccess.store(param->write.status==ESP_SPP_SUCCESS);
        if(param->write.cong) xEventGroupClearBits(events,UNCONGESTED);else xEventGroupSetBits(events,UNCONGESTED);
        xEventGroupSetBits(events,WRITE_ACK);break;
    case ESP_SPP_CONG_EVT:
        if(param->cong.cong) xEventGroupClearBits(events,UNCONGESTED);else xEventGroupSetBits(events,UNCONGESTED);break;
    default:break;
    }
}
#else
// NUS UUIDs in Bluetooth little-endian byte order.
uint8_t serviceUuid[16]={0x9e,0xca,0xdc,0x24,0x0e,0xe5,0xa9,0xe0,0x93,0xf3,0xa3,0xb5,0x01,0x00,0x40,0x6e};
uint8_t rxUuid[16]={0x9e,0xca,0xdc,0x24,0x0e,0xe5,0xa9,0xe0,0x93,0xf3,0xa3,0xb5,0x02,0x00,0x40,0x6e};
uint8_t txUuid[16]={0x9e,0xca,0xdc,0x24,0x0e,0xe5,0xa9,0xe0,0x93,0xf3,0xa3,0xb5,0x03,0x00,0x40,0x6e};
uint16_t primaryUuid=ESP_GATT_UUID_PRI_SERVICE,charUuid=ESP_GATT_UUID_CHAR_DECLARE,cccdUuid=ESP_GATT_UUID_CHAR_CLIENT_CONFIG;
uint8_t rxProperties=ESP_GATT_CHAR_PROP_BIT_WRITE|ESP_GATT_CHAR_PROP_BIT_WRITE_NR,txProperties=ESP_GATT_CHAR_PROP_BIT_NOTIFY;
uint8_t cccdValue[2]={0,0};
uint16_t handles[6]={};
esp_gatt_if_t serverInterface=ESP_GATT_IF_NONE;
std::atomic<uint16_t> connection{0};
std::atomic<bool> subscribed{false};
bool advConfigured=false,scanConfigured=false,serviceStarted=false;
esp_ble_adv_params_t advParams={};
void advertiseIfReady() {
    if(advConfigured && scanConfigured && serviceStarted && !radio.connected.load()) esp_ble_gap_start_advertising(&advParams);
}
void gapCallback(esp_gap_ble_cb_event_t event,esp_ble_gap_cb_param_t* param) {
    if(event==ESP_GAP_BLE_ADV_DATA_SET_COMPLETE_EVT) {advConfigured=param->adv_data_cmpl.status==ESP_BT_STATUS_SUCCESS;advertiseIfReady();}
    else if(event==ESP_GAP_BLE_SCAN_RSP_DATA_SET_COMPLETE_EVT) {scanConfigured=param->scan_rsp_data_cmpl.status==ESP_BT_STATUS_SUCCESS;advertiseIfReady();}
    else if(event==ESP_GAP_BLE_ADV_START_COMPLETE_EVT) radioReady.store(param->adv_start_cmpl.status==ESP_BT_STATUS_SUCCESS);
}
void createTable(esp_gatt_if_t interface) {
    esp_gatts_attr_db_t table[6]={};
    for(int i=0;i<6;i++) table[i].attr_control.auto_rsp=ESP_GATT_AUTO_RSP;
    table[0].att_desc={ESP_UUID_LEN_16,reinterpret_cast<uint8_t*>(&primaryUuid),ESP_GATT_PERM_READ,16,16,serviceUuid};
    table[1].att_desc={ESP_UUID_LEN_16,reinterpret_cast<uint8_t*>(&charUuid),ESP_GATT_PERM_READ,1,1,&rxProperties};
    table[2].attr_control.auto_rsp=ESP_GATT_RSP_BY_APP;
    table[2].att_desc={ESP_UUID_LEN_128,rxUuid,ESP_GATT_PERM_WRITE,512,0,nullptr};
    table[3].att_desc={ESP_UUID_LEN_16,reinterpret_cast<uint8_t*>(&charUuid),ESP_GATT_PERM_READ,1,1,&txProperties};
    table[4].att_desc={ESP_UUID_LEN_128,txUuid,ESP_GATT_PERM_READ,512,0,nullptr};
    table[5].att_desc={ESP_UUID_LEN_16,reinterpret_cast<uint8_t*>(&cccdUuid),ESP_GATT_PERM_READ|ESP_GATT_PERM_WRITE,2,2,cccdValue};
    esp_ble_gatts_create_attr_tab(table,interface,6,0);
}
void gattsCallback(esp_gatts_cb_event_t event,esp_gatt_if_t interface,esp_ble_gatts_cb_param_t* param) {
    switch(event) {
    case ESP_GATTS_REG_EVT: {
        if(param->reg.status!=ESP_GATT_OK) break;
        serverInterface=interface;esp_ble_gap_set_device_name(bluetoothName);
        esp_ble_adv_data_t adv={};adv.flag=ESP_BLE_ADV_FLAG_GEN_DISC|ESP_BLE_ADV_FLAG_BREDR_NOT_SPT;
        adv.service_uuid_len=sizeof(serviceUuid);adv.p_service_uuid=serviceUuid;
        esp_ble_gap_config_adv_data(&adv);
        esp_ble_adv_data_t scan={};scan.set_scan_rsp=true;scan.include_name=true;
        esp_ble_gap_config_adv_data(&scan);createTable(interface);break;
    }
    case ESP_GATTS_CREAT_ATTR_TAB_EVT:
        if(param->add_attr_tab.status==ESP_GATT_OK && param->add_attr_tab.num_handle==6) {
            memcpy(handles,param->add_attr_tab.handles,sizeof(handles));esp_ble_gatts_start_service(handles[0]);
        }
        break;
    case ESP_GATTS_START_EVT:serviceStarted=param->start.status==ESP_GATT_OK;advertiseIfReady();break;
    case ESP_GATTS_CONNECT_EVT: {
        connection.store(param->connect.conn_id);subscribed.store(false);radio.session(true);
        xEventGroupSetBits(events,UNCONGESTED);
        esp_ble_conn_update_params_t settings={};memcpy(settings.bda,param->connect.remote_bda,6);
        settings.min_int=12;settings.max_int=24;settings.latency=0;settings.timeout=400;
        esp_ble_gap_update_conn_params(&settings);break;
    }
    case ESP_GATTS_DISCONNECT_EVT:
        subscribed.store(false);radio.session(false);advertiseIfReady();break;
    case ESP_GATTS_WRITE_EVT: {
        esp_gatt_status_t status=ESP_GATT_OK;
        if(param->write.handle==handles[2]) {
            if(param->write.is_prep || param->write.offset!=0) status=ESP_GATT_REQ_NOT_SUPPORTED;
            else radio.receive(param->write.value,param->write.len);
            if(param->write.need_rsp) esp_ble_gatts_send_response(interface,param->write.conn_id,param->write.trans_id,status,nullptr);
        } else if(param->write.handle==handles[5] && param->write.len==2) {
            subscribed.store((param->write.value[0]&1)!=0);
        }
        break;
    }
    case ESP_GATTS_CONGEST_EVT:
        if(param->congest.congested) xEventGroupClearBits(events,UNCONGESTED);else xEventGroupSetBits(events,UNCONGESTED);break;
    default:break;
    }
}
#endif
}
void initRadio() {
    events=xEventGroupCreate();configASSERT(events);
#if CONFIG_IDF_TARGET_ESP32
    esp_bt_controller_mem_release(ESP_BT_MODE_BLE);
#else
    esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
#endif
    esp_bt_controller_config_t controller=BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    if(esp_bt_controller_init(&controller)!=ESP_OK) return;
#if CONFIG_IDF_TARGET_ESP32
    if(esp_bt_controller_enable(ESP_BT_MODE_CLASSIC_BT)!=ESP_OK) return;
#else
    if(esp_bt_controller_enable(ESP_BT_MODE_BLE)!=ESP_OK) return;
#endif
    if(esp_bluedroid_init()!=ESP_OK || esp_bluedroid_enable()!=ESP_OK) return;
#if CONFIG_IDF_TARGET_ESP32
    esp_bt_gap_register_callback(gapCallback);esp_spp_register_callback(sppCallback);
    esp_bt_gap_set_device_name(bluetoothName);
    esp_bt_io_cap_t capability=ESP_BT_IO_CAP_NONE;
    esp_bt_gap_set_security_param(ESP_BT_SP_IOCAP_MODE,&capability,sizeof(capability));
    esp_spp_cfg_t config={};config.mode=ESP_SPP_MODE_CB;config.enable_l2cap_ertm=true;
    if(esp_spp_enhanced_init(&config)!=ESP_OK) return;
#else
    advParams.adv_int_min=0x20;advParams.adv_int_max=0x40;advParams.adv_type=ADV_TYPE_IND;
    advParams.own_addr_type=BLE_ADDR_TYPE_PUBLIC;advParams.channel_map=ADV_CHNL_ALL;
    advParams.adv_filter_policy=ADV_FILTER_ALLOW_SCAN_ANY_CON_ANY;
    esp_ble_gap_register_callback(gapCallback);esp_ble_gatts_register_callback(gattsCallback);
    if(esp_ble_gatts_app_register(0)!=ESP_OK) return;
#endif
    xTaskCreate(txTask,"radio_tx",6144,&radio,3,nullptr);
}
bool sendRadio(const uint8_t* data,size_t size,uint32_t epoch) {
    int64_t deadline=esp_timer_get_time()+15000000;
    size_t sent=0;
    while(sent<size && radio.connected.load() && radio.epoch.load()==epoch && esp_timer_get_time()<deadline) {
        if(!(xEventGroupWaitBits(events,UNCONGESTED,pdFALSE,pdTRUE,pdMS_TO_TICKS(50))&UNCONGESTED)) continue;
#if CONFIG_IDF_TARGET_ESP32
        size_t chunk=std::min(size-sent,size_t(128));xEventGroupClearBits(events,WRITE_ACK);writeSuccess.store(false);
        if(esp_spp_write(sppHandle.load(),chunk,const_cast<uint8_t*>(data+sent))!=ESP_OK) return false;
        if(!(xEventGroupWaitBits(events,WRITE_ACK,pdTRUE,pdTRUE,pdMS_TO_TICKS(1500))&WRITE_ACK) || !writeSuccess.load()) return false;
#else
        if(!subscribed.load()) {vTaskDelay(pdMS_TO_TICKS(5));continue;}
        size_t chunk=std::min(size-sent,size_t(20));
        if(esp_ble_gatts_send_indicate(serverInterface,connection.load(),handles[4],chunk,const_cast<uint8_t*>(data+sent),false)!=ESP_OK) {
            vTaskDelay(pdMS_TO_TICKS(5));continue;
        }
        vTaskDelay(pdMS_TO_TICKS(5));
#endif
        sent+=chunk;
    }
    return sent==size;
}
}

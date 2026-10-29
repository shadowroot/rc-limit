#include <cassert>
#include <climits>
#include <initializer_list>
#include "model_json.hpp"
int main() {
    rc::MappingSet original,decoded;
    original.channels[0].input_pin=3;original.channels[0].output_pin=4;
    auto* profile=codec::profile(original);
    assert(codec::profile(profile,rc::Board::Esp32C3,decoded));
    assert(decoded.count==1 && decoded.channels[0].input_pin==3);
    auto* array=cJSON_GetObjectItem(profile,"mappings");
    auto* channel=cJSON_GetArrayItem(array,0);
    cJSON_ReplaceItemInObject(channel,"forward_percent",cJSON_CreateNumber(30.5));
    assert(!codec::profile(profile,rc::Board::Esp32C3,decoded));
    assert(decoded.channels[0].forward_percent==30);
    cJSON_ReplaceItemInObject(channel,"forward_percent",cJSON_CreateNumber(30));
    cJSON_AddItemToArray(array,codec::channel(original.channels[0]));
    assert(!codec::profile(profile,rc::Board::Esp32C3,decoded)); // duplicate output
    cJSON_ReplaceItemInObject(cJSON_GetArrayItem(array,1),"output_pin",cJSON_CreateNumber(6));
    assert(codec::profile(profile,rc::Board::Esp32C3,decoded)); // shared input
    assert(decoded.count==2);
    cJSON_ReplaceItemInObject(channel,"input_pin",cJSON_CreateNumber(18));
    assert(!codec::profile(profile,rc::Board::Esp32C3,decoded)); // reserved USB
    cJSON_Delete(profile);
    auto* legacy=codec::channel(original.channels[0]);
    assert(codec::profile(legacy,rc::Board::Esp32C3,decoded));
    assert(decoded.count==1);
    cJSON_AddNumberToObject(legacy,"unknown",1);
    assert(!codec::profile(legacy,rc::Board::Esp32C3,decoded));
    cJSON_Delete(legacy);
    for(const char* text:{"true","1.5","2147483648","null","\"3\""}) {
        auto* value=cJSON_Parse(text);int number=123;
        assert(!codec::integer(value,number));assert(number==123);cJSON_Delete(value);
    }
    auto* value=cJSON_CreateNumber(INT_MIN);int number=0;
    assert(codec::integer(value,number) && number==INT_MIN);cJSON_Delete(value);
}

#include "model_json.hpp"
#include <cmath>
#include <limits>
#define FIELDS(X) \
 X(input_pin) X(output_pin) X(input_min) X(input_neutral) X(input_max) \
 X(output_min) X(output_neutral) X(output_max) X(forward_percent) X(reverse_percent) \
 X(bidirectional) X(scale) X(invert) X(deadband) X(timeout_ms)
namespace codec {
bool integer(const cJSON* value,int& result) {
    if(!cJSON_IsNumber(value) || !std::isfinite(value->valuedouble) ||
       value->valuedouble<std::numeric_limits<int>::min() || value->valuedouble>std::numeric_limits<int>::max() ||
       std::floor(value->valuedouble)!=value->valuedouble) return false;
    result=static_cast<int>(value->valuedouble);return true;
}
cJSON* channel(const rc::Config& config) {
    cJSON* value=cJSON_CreateObject();
#define ENCODE(name) cJSON_AddNumberToObject(value,#name,config.name);
    FIELDS(ENCODE)
#undef ENCODE
    return value;
}
bool channel(const cJSON* value,rc::Config& result) {
    if(!cJSON_IsObject(value) || cJSON_GetArraySize(value)!=15) return false;
#define DECODE(name) if(!integer(cJSON_GetObjectItemCaseSensitive(value,#name),result.name)) return false;
    FIELDS(DECODE)
#undef DECODE
    return rc::valid(result);
}
cJSON* mappings(const rc::MappingSet& set) {
    cJSON* array=cJSON_CreateArray();
    for(int i=0;i<set.count;i++) cJSON_AddItemToArray(array,channel(set.channels[i]));
    return array;
}
bool mappings(const cJSON* value,rc::Board board,rc::MappingSet& result) {
    if(!cJSON_IsArray(value)) return false;
    int count=cJSON_GetArraySize(value);
    if(count<1 || count>rc::MAX_MAPPINGS) return false;
    rc::MappingSet next;next.count=count;
    for(int i=0;i<count;i++) if(!channel(cJSON_GetArrayItem(value,i),next.channels[i])) return false;
    if(!rc::validMappings(next,board)) return false;
    result=next;return true;
}
cJSON* profile(const rc::MappingSet& set) {
    cJSON* value=cJSON_CreateObject();cJSON_AddNumberToObject(value,"version",2);
    cJSON_AddItemToObject(value,"mappings",mappings(set));return value;
}
bool profile(const cJSON* value,rc::Board board,rc::MappingSet& result) {
    int version;
    if(cJSON_IsObject(value) && cJSON_GetArraySize(value)==2 &&
       integer(cJSON_GetObjectItemCaseSensitive(value,"version"),version) && version==2)
        return mappings(cJSON_GetObjectItemCaseSensitive(value,"mappings"),board,result);
    rc::MappingSet next;
    if(!channel(value,next.channels[0]) || !rc::validMappings(next,board)) return false;
    result=next;return true;
}
}

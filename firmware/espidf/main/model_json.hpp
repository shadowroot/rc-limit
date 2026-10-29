#pragma once
#include "limiter.h"
#include "cJSON.h"
namespace codec {
cJSON* channel(const rc::Config& config);
cJSON* mappings(const rc::MappingSet& set);
cJSON* profile(const rc::MappingSet& set);
bool integer(const cJSON* value,int& result);
bool channel(const cJSON* value,rc::Config& result);
bool mappings(const cJSON* value,rc::Board board,rc::MappingSet& result);
bool profile(const cJSON* value,rc::Board board,rc::MappingSet& result);
}

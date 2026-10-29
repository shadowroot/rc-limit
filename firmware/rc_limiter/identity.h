#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string.h>
namespace identity {
constexpr size_t MAX_NAME=16;
inline bool valid(const char* name) {
  if(!name) return false;
  size_t length=strlen(name);
  if(length<1 || length>MAX_NAME || name[0]==' ' || name[length-1]==' ') return false;
  for(size_t i=0;i<length;i++) {
    char c=name[i];
    if(!((c>='a' && c<='z') || (c>='A' && c<='Z') || (c>='0' && c<='9') || c==' ' || c=='-' || c=='_' || c=='.')) return false;
  }
  return true;
}
constexpr size_t RECORD_SIZE=64;
constexpr uint32_t MAGIC=0x52434e31;
inline uint32_t hash(const char* name) {
  uint32_t value=2166136261u;
  for(size_t i=0;name[i];i++){value^=static_cast<uint8_t>(name[i]);value*=16777619u;}return value;
}
inline void encode(uint8_t* record,const char* name) {
  memset(record,0,RECORD_SIZE);uint32_t magic=MAGIC,sum=hash(name);
  memcpy(record,&magic,4);memcpy(record+4,&sum,4);memcpy(record+8,name,strlen(name)+1);
}
inline bool decode(const uint8_t* record,char* name) {
  uint32_t magic,sum;memcpy(&magic,record,4);memcpy(&sum,record+4,4);
  char next[MAX_NAME+1];memcpy(next,record+8,sizeof(next));
  if(magic!=MAGIC || !memchr(next,0,sizeof(next)) || !valid(next) || hash(next)!=sum) return false;
  strcpy(name,next);return true;
}
}

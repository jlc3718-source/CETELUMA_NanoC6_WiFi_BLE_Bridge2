#include "EventState.h"
#include <Preferences.h>

static constexpr const char* EVENT_STATE_NS = "anderson-evstate";
static constexpr uint8_t EVENT_STATE_REVISION = 1;
static uint64_t enabledWords[EVENT_STATE_WORDS] = {UINT64_MAX,UINT64_MAX,UINT64_MAX,UINT64_MAX};
static uint64_t favoriteWords[EVENT_STATE_WORDS] = {0,0,0,0};
static bool stateLoaded = false;

static String wordKey(const char* prefix,size_t word){return String(prefix)+String((unsigned)word);}
static bool persistWord(const char* prefix,size_t word,uint64_t value){
  Preferences p;if(!p.begin(EVENT_STATE_NS,false))return false;String key=wordKey(prefix,word);size_t wrote=p.putULong64(key.c_str(),value);uint64_t verify=p.getULong64(key.c_str(),~value);p.end();return wrote>0&&verify==value;
}
void eventStateBegin(){
  Preferences p;if(!p.begin(EVENT_STATE_NS,false))return;uint8_t rev=p.getUChar("rev",0);
  if(rev>=EVENT_STATE_REVISION){for(size_t w=0;w<EVENT_STATE_WORDS;w++){String ek=wordKey("en",w),fk=wordKey("fav",w);enabledWords[w]=p.getULong64(ek.c_str(),UINT64_MAX);favoriteWords[w]=p.getULong64(fk.c_str(),0);}}
  else{for(size_t w=0;w<EVENT_STATE_WORDS;w++){enabledWords[w]=UINT64_MAX;favoriteWords[w]=0;String ek=wordKey("en",w),fk=wordKey("fav",w);p.putULong64(ek.c_str(),enabledWords[w]);p.putULong64(fk.c_str(),favoriteWords[w]);}p.putUChar("rev",EVENT_STATE_REVISION);}
  p.end();stateLoaded=true;
}
bool eventStateEnabled(size_t index){if(index>=MAX_BUILTIN_EVENTS)return false;if(!stateLoaded)eventStateBegin();return (enabledWords[index/64]>>(index%64))&1ULL;}
bool eventStateFavorite(size_t index){if(index>=MAX_BUILTIN_EVENTS)return false;if(!stateLoaded)eventStateBegin();return (favoriteWords[index/64]>>(index%64))&1ULL;}
bool eventStateSetEnabled(size_t index,bool enabled){if(index>=MAX_BUILTIN_EVENTS)return false;if(!stateLoaded)eventStateBegin();size_t w=index/64;uint64_t bit=1ULL<<(index%64),next=enabled?enabledWords[w]|bit:enabledWords[w]&~bit;if(next==enabledWords[w])return true;if(!persistWord("en",w,next))return false;enabledWords[w]=next;return true;}
bool eventStateSetFavorite(size_t index,bool favorite){if(index>=MAX_BUILTIN_EVENTS)return false;if(!stateLoaded)eventStateBegin();size_t w=index/64;uint64_t bit=1ULL<<(index%64),next=favorite?favoriteWords[w]|bit:favoriteWords[w]&~bit;if(next==favoriteWords[w])return true;if(!persistWord("fav",w,next))return false;favoriteWords[w]=next;return true;}
bool eventStateReplaceFavorites(const size_t* indices,size_t count){
  if(!stateLoaded)eventStateBegin();uint64_t next[EVENT_STATE_WORDS]={0};
  for(size_t i=0;i<count;i++){size_t index=indices[i];if(index>=MAX_BUILTIN_EVENTS)return false;next[index/64]|=1ULL<<(index%64);}
  Preferences p;if(!p.begin(EVENT_STATE_NS,false))return false;bool ok=true;
  for(size_t w=0;w<EVENT_STATE_WORDS;w++){String fk=wordKey("fav",w);size_t wrote=p.putULong64(fk.c_str(),next[w]);ok=ok&&wrote>0&&p.getULong64(fk.c_str(),~next[w])==next[w];}
  p.end();if(!ok)return false;for(size_t w=0;w<EVENT_STATE_WORDS;w++)favoriteWords[w]=next[w];return true;
}
bool eventStateResetAll(){
  Preferences p;if(!p.begin(EVENT_STATE_NS,false))return false;bool ok=true;
  for(size_t w=0;w<EVENT_STATE_WORDS;w++){enabledWords[w]=UINT64_MAX;favoriteWords[w]=0;String ek=wordKey("en",w),fk=wordKey("fav",w);p.putULong64(ek.c_str(),enabledWords[w]);p.putULong64(fk.c_str(),favoriteWords[w]);ok=ok&&p.getULong64(ek.c_str(),0)==UINT64_MAX&&p.getULong64(fk.c_str(),UINT64_MAX)==0;}
  p.putUChar("rev",EVENT_STATE_REVISION);ok=ok&&p.getUChar("rev",0)==EVENT_STATE_REVISION;p.end();stateLoaded=true;return ok;
}

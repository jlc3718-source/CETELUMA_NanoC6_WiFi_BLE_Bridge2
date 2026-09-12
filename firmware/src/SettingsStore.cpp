#include "SettingsStore.h"

static bool putStringChecked(Preferences& p,const char* key,const String& value){String old=p.getString(key,"__ANDERSON_MISSING__");if(old==value)return true;p.putString(key,value);return p.getString(key,"__ANDERSON_VERIFY__")==value;}
static bool putUShortChecked(Preferences& p,const char* key,uint16_t value){if(p.getUShort(key,(uint16_t)(value^0xFFFF))==value)return true;return p.putUShort(key,value)>0&&p.getUShort(key,(uint16_t)(value^0xFFFF))==value;}
static bool putUCharChecked(Preferences& p,const char* key,uint8_t value){if(p.getUChar(key,(uint8_t)(value^0xFF))==value)return true;return p.putUChar(key,value)>0&&p.getUChar(key,(uint8_t)(value^0xFF))==value;}
static bool putBoolChecked(Preferences& p,const char* key,bool value){if(p.getBool(key,!value)==value)return true;return p.putBool(key,value)>0&&p.getBool(key,!value)==value;}
static bool putU64Checked(Preferences& p,const char* key,uint64_t value){if(p.getULong64(key,~value)==value)return true;return p.putULong64(key,value)>0&&p.getULong64(key,~value)==value;}

void SettingsStore::begin(){
  prefs.begin("anderson",false);s.ssid=prefs.getString("ssid","Anderson");s.password=prefs.getString("pass","HarleyD5");s.tz=prefs.getString("tz","EST5EDT,M3.2.0,M11.1.0");
  s.onMinutes=prefs.getUShort("on",17*60);s.offMinutes=prefs.getUShort("off",23*60);s.leadDays=prefs.getUChar("lead",2);s.trailDays=prefs.getUChar("trail",0);s.overlap=prefs.getUChar("overlap",0);
  s.schedulerEnabled=prefs.getBool("sched",true);s.schedule2Enabled=prefs.getBool("sched2",true);s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);s.favoriteMask=prefs.getULong64("favorite",(1ULL<<26)|(1ULL<<27)|(1ULL<<29));
  s.bleAddress=prefs.getString("bleaddr","");s.bleProtocol=prefs.getUChar("bleproto",0);s.bleAddress2=prefs.getString("bleaddr2","");s.bleProtocol2=prefs.getUChar("bleproto2",0);s.bleName=prefs.getString("blename","");s.bleName2=prefs.getString("blename2","");s.pixelCount=prefs.getUShort("pixels",100);
}
bool SettingsStore::writeSettings(const AppSettings& v){return putStringChecked(prefs,"tz",v.tz)&&putUShortChecked(prefs,"on",v.onMinutes)&&putUShortChecked(prefs,"off",v.offMinutes)&&putUCharChecked(prefs,"lead",v.leadDays)&&putUCharChecked(prefs,"trail",v.trailDays)&&putUCharChecked(prefs,"overlap",v.overlap)&&putBoolChecked(prefs,"sched",v.schedulerEnabled)&&putBoolChecked(prefs,"sched2",v.schedule2Enabled);}
bool SettingsStore::saveSettings(const AppSettings& next){AppSettings previous=s;if(!writeSettings(next)){writeSettings(previous);return false;}s=next;return true;}
bool SettingsStore::saveBle(){return putStringChecked(prefs,"bleaddr",s.bleAddress)&&putUCharChecked(prefs,"bleproto",s.bleProtocol)&&putStringChecked(prefs,"bleaddr2",s.bleAddress2)&&putUCharChecked(prefs,"bleproto2",s.bleProtocol2)&&putStringChecked(prefs,"blename",s.bleName)&&putStringChecked(prefs,"blename2",s.bleName2)&&putUShortChecked(prefs,"pixels",s.pixelCount);}
bool SettingsStore::saveAll(){return writeSettings(s)&&putU64Checked(prefs,"enabled",s.enabledMask)&&putU64Checked(prefs,"favorite",s.favoriteMask)&&saveBle();}
bool SettingsStore::saveWiFi(const String& ssid,const String& pass){String oldSsid=s.ssid,oldPass=s.password;if(!putStringChecked(prefs,"ssid",ssid)||!putStringChecked(prefs,"pass",pass)){putStringChecked(prefs,"ssid",oldSsid);putStringChecked(prefs,"pass",oldPass);return false;}s.ssid=ssid;s.password=pass;return true;}
bool SettingsStore::clearWiFi(){return saveWiFi("","");}

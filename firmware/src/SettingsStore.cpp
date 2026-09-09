#include "SettingsStore.h"
void SettingsStore::begin(){
  prefs.begin("anderson",false);
  s.ssid=prefs.getString("ssid","Anderson");
  s.password=prefs.getString("pass","HarleyD5");
  s.tz=prefs.getString("tz","EST5EDT,M3.2.0,M11.1.0");
  s.onMinutes=prefs.getUShort("on",17*60); s.offMinutes=prefs.getUShort("off",23*60);
  s.leadDays=prefs.getUChar("lead",2); s.trailDays=prefs.getUChar("trail",0); s.overlap=prefs.getUChar("overlap",0);
  s.schedulerEnabled=prefs.getBool("sched",true); s.enabledMask=prefs.getULong64("enabled",UINT64_MAX);
  s.favoriteMask=prefs.getULong64("favorite",(1ULL<<26)|(1ULL<<27)|(1ULL<<29));
  s.bleAddress=prefs.getString("bleaddr",""); s.bleProtocol=prefs.getUChar("bleproto",0); s.bleAddress2=prefs.getString("bleaddr2",""); s.bleProtocol2=prefs.getUChar("bleproto2",0); s.bleName=prefs.getString("blename",""); s.bleName2=prefs.getString("blename2",""); s.pixelCount=prefs.getUShort("pixels",100);
}
void SettingsStore::saveAll(){
  prefs.putString("tz",s.tz);prefs.putUShort("on",s.onMinutes);prefs.putUShort("off",s.offMinutes);prefs.putUChar("lead",s.leadDays);prefs.putUChar("trail",s.trailDays);
  prefs.putUChar("overlap",s.overlap);prefs.putBool("sched",s.schedulerEnabled);prefs.putULong64("enabled",s.enabledMask);prefs.putULong64("favorite",s.favoriteMask);
  prefs.putString("bleaddr",s.bleAddress);prefs.putUChar("bleproto",s.bleProtocol);prefs.putString("bleaddr2",s.bleAddress2);prefs.putUChar("bleproto2",s.bleProtocol2);prefs.putString("blename",s.bleName);prefs.putString("blename2",s.bleName2);prefs.putUShort("pixels",s.pixelCount);
}
void SettingsStore::saveWiFi(const String& ssid,const String& pass){s.ssid=ssid;s.password=pass;prefs.putString("ssid",ssid);prefs.putString("pass",pass);}
void SettingsStore::clearWiFi(){s.ssid="";s.password="";prefs.remove("ssid");prefs.remove("pass");}

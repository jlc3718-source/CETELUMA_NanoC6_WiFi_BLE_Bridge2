#pragma once
#include "Common.h"
class EufyCloud {
  String region="us-pr",bootstrap,share,ident,token,uid,accountUid,install;
  JsonDocument credentials,devices;
  bool exchange();
  bool raw(const String&host,const String&path,const String&body,JsonDocument&out,bool authenticated,const String&key="",const String&scope="eufy_mega",bool plain=false,const String&signatureBody="");
  bool signedCall(const String&service,const String&path,JsonVariantConst body,JsonDocument&out,const String&scope="eufy_mega");
  bool findDevices();
  bool prepareSession();
  bool mqtt(int index,const std::vector<std::pair<uint16_t,Bytes>>& frames,JsonDocument&report);
public:
  String error="Not configured";
  bool ready=false;
  void begin();
  bool prepare();
  bool login(const String&email,const String&password);
  bool control(JsonVariantConst request,JsonDocument&result);
  bool deviceReady(int i){return devices[i]["serial"].is<String>();}
  void describe(JsonArray array);
  bool api(const String&service,const String&path,JsonVariantConst body,JsonDocument&out){return signedCall(service,path,body,out);}
};
extern EufyCloud eufy;

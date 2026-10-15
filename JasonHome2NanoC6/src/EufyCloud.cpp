#include "EufyCloud.h"
#include "EufyProtocol.h"
#include "Factory.h"
#include <mbedtls/aes.h>
#include <mbedtls/ecp.h>
#include <mbedtls/ecdh.h>
#include <mbedtls/md.h>
#include <mbedtls/md5.h>
#include <mbedtls/sha256.h>

EufyCloud eufy;
static const char LOCAL_KEY[]="2500a7d5617812f9d52515b2c8f20a3d";
static const char SERVER_PUBLIC[]="04c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a3868d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076";
static const char* NAMES[]={"Pool","House","Garage","Shed"};
static const char* MODELS[]={"T8L00","T8L00","T8L02","T8L02"};
static const char* SERIALS[]={"T8L006102353014B","T8L00610243503A2","T8L028102427474A","T8L0281024470193"};
static int rng(void*,unsigned char*p,size_t n){esp_fill_random(p,n);return 0;}
struct ECDH{
  mbedtls_ecp_group group;mbedtls_mpi d;mbedtls_ecp_point q;
  ECDH(){mbedtls_ecp_group_init(&group);mbedtls_mpi_init(&d);mbedtls_ecp_point_init(&q);mbedtls_ecp_group_load(&group,MBEDTLS_ECP_DP_SECP256R1);mbedtls_ecp_gen_keypair(&group,&d,&q,rng,nullptr);}
  ~ECDH(){mbedtls_ecp_group_free(&group);mbedtls_mpi_free(&d);mbedtls_ecp_point_free(&q);}
  String publicKey(){uint8_t b[65];size_t n=0;mbedtls_ecp_point_write_binary(&group,&q,MBEDTLS_ECP_PF_UNCOMPRESSED,&n,b,sizeof(b));return hexBytes(b,n);}
  Bytes secret(const String&pub){auto b=fromHex(pub);mbedtls_ecp_point p;mbedtls_ecp_point_init(&p);mbedtls_mpi z;mbedtls_mpi_init(&z);int rc=mbedtls_ecp_point_read_binary(&group,&p,b.data(),b.size());if(!rc)rc=mbedtls_ecdh_compute_shared(&group,&z,&p,&d,rng,nullptr);Bytes out(32);if(!rc)rc=mbedtls_mpi_write_binary(&z,out.data(),32);mbedtls_mpi_free(&z);mbedtls_ecp_point_free(&p);return rc?Bytes{}:out;}
};
static String aesEncrypt(const String&plain,const Bytes&key,bool prefix=true){
  if(key.size()!=16&&key.size()!=32)return "";Bytes iv(16);if(prefix)esp_fill_random(iv.data(),16);else memcpy(iv.data(),key.data(),16);Bytes originalIV=iv;
  uint8_t pad=16-(plain.length()%16);Bytes in(plain.length()+pad,pad),out(in.size());memcpy(in.data(),plain.c_str(),plain.length());mbedtls_aes_context ctx;mbedtls_aes_init(&ctx);int rc=mbedtls_aes_setkey_enc(&ctx,key.data(),key.size()*8);if(!rc)rc=mbedtls_aes_crypt_cbc(&ctx,MBEDTLS_AES_ENCRYPT,in.size(),iv.data(),in.data(),out.data());mbedtls_aes_free(&ctx);if(rc)return "";if(prefix)out.insert(out.begin(),originalIV.begin(),originalIV.end());return to64(out.data(),out.size());
}
static String aesDecrypt(const String&cipher,const Bytes&key){
  auto in=from64(cipher);if(in.size()<32||in.size()%16||key.size()!=16)return "";Bytes iv(in.begin(),in.begin()+16),out(in.size()-16);mbedtls_aes_context ctx;mbedtls_aes_init(&ctx);mbedtls_aes_setkey_dec(&ctx,key.data(),128);int rc=mbedtls_aes_crypt_cbc(&ctx,MBEDTLS_AES_DECRYPT,out.size(),iv.data(),in.data()+16,out.data());mbedtls_aes_free(&ctx);if(rc)return "";uint8_t pad=out.back();if(pad<1||pad>16||pad>out.size())return "";for(size_t i=out.size()-pad;i<out.size();i++)if(out[i]!=pad)return "";return String((char*)out.data(),out.size()-pad);
}
bool EufyCloud::raw(const String&host,const String&path,const String&body,JsonDocument&out,bool authenticated,const String&key,const String&scope,bool plain){
  if(!host.endsWith(".eufy.com")||!(host.startsWith("mega-")||host.startsWith("app-"))){error="Invalid Eufy hostname";return false;}
  WiFiClientSecure c;trust(c);HTTPClient h;h.setConnectTimeout(6000);h.setTimeout(10000);if(!h.begin(c,"https://"+host+path)){error="Eufy TLS initialization failed";return false;}
  const std::pair<const char*,const char*> headers[]={{"app-version","6.0.41_26142"},{"app_version","6.0.41_26142"},{"os-type","android"},{"os_type","android"},{"os-version","36"},{"os_version","36"},{"phone-model","JasonHomeNanoC6"},{"model-type","PHONE"},{"country","US"},{"ab_code","US"},{"language","en"},{"test-flag","false"},{"accept","application/json"}};
  for(auto&p:headers)h.addHeader(p.first,p.second);h.addHeader("User-Agent","ktor-client");h.addHeader("openudid",install);h.addHeader("app-name",scope);h.addHeader("Content-Type",plain?"text/plain":"application/json");
  if(authenticated&&token.length()){h.addHeader("x-auth-token",token);h.addHeader("authorization",token);uint8_t hash[16];mbedtls_md5((const uint8_t*)accountUid.c_str(),accountUid.length(),hash);h.addHeader("gtoken",hexBytes(hash,16));}
  if(key.length()){
    String ts=String((uint32_t)time(nullptr)),once=randomHex(),message=ts+"+"+once+"+"+body;uint8_t digest[32];
    mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),(const uint8_t*)key.c_str(),32,(const uint8_t*)message.c_str(),message.length(),digest);
    h.addHeader("x-encryption-info","algo_ecdh");h.addHeader("x-replay-info","replay");h.addHeader("x-key-ident",ident);h.addHeader("x-request-ts",ts);h.addHeader("x-request-once",once);h.addHeader("x-signature",hexBytes(digest,32));
  }
  const char*hs[]={"Transfer-Encoding"};h.collectHeaders(hs,1);int rc=h.POST(body);String text;bool readOk=rc>0&&readHttpText(h,text);h.end();if(rc==401){ready=false;share="";token="";}if(rc!=200||!readOk||deserializeJson(out,text)){error="Eufy "+path+" HTTP "+String(rc);return false;}
  return true;
}
bool EufyCloud::exchange(){
  ECDH ec;ident=randomHex();String encrypted=aesEncrypt(ec.publicKey(),fromHex(LOCAL_KEY));JsonDocument body,out;body["client_public_key"]=encrypted;String encoded;serializeJson(body,encoded);
  if(!raw(bootstrap.length()?bootstrap:"app-openapi-"+region+".eufy.com","/openapi/oauth/key/exchange",encoded,out,token.length(),LOCAL_KEY)||(out["code"]|-1)!=0){error="Eufy key exchange failed";return false;}
  String server=aesDecrypt(out["data"]["server_public_key"]|String(""),fromHex(LOCAL_KEY));auto shared=ec.secret(server);if(shared.size()!=32){error="Invalid Eufy ECDH key";return false;}share=hexBytes(shared.data(),16);return true;
}
bool EufyCloud::signedCall(const String&service,const String&path,JsonVariantConst body,JsonDocument&out,const String&scope){
  if(!share.length()&&!exchange())return false;String text;serializeJson(body,text);String cipher=aesEncrypt(text,fromHex(share));
  for(int attempt=0;attempt<2;attempt++){
    JsonDocument r;bool plain=(path.startsWith("/passport/"))^(attempt==1);
    if(!raw("app-"+service+"-"+region+".eufy.com",path,cipher,r,true,share,scope,plain))return false;
    int code=r["code"]|-1;if(code==0){if(r["data"].is<String>()){String decrypted=aesDecrypt(r["data"].as<String>(),fromHex(share));if(deserializeJson(out,decrypted)){error="Eufy decryption failed";return false;}}else out.set(r["data"]);return true;}
    if(attempt==0&&(code==4416||code==10000))continue;if(code==401){ready=false;share="";token="";}error="Eufy "+path+" code "+String(code);return false;
  }return false;
}
void EufyCloud::begin(){
  install=secrets["eufyInstall"]|String("");if(!install.length()){install=randomHex();secrets["eufyInstall"]=install;}
  auto s=secrets["eufySession"];region=s["region"]|String("us-pr");bootstrap=s["bootstrap"]|String("");token=s["token"]|String("");uid=s["uid"]|String("");accountUid=s["accountUid"]|String("");
}
bool EufyCloud::login(const String&email,const String&password){
  JsonDocument body,r;body["ab"]="us";body["mode"]=1;String text;serializeJson(body,text);
  if(!raw("mega-us-pr.eufy.com","/passport/estimate_domain",text,r,false)||(r["code"]|-1)!=0)return false;
  String regionData;serializeJson(r["data"],regionData);region=regionData.indexOf("-eu-")>=0?"eu-pr":"us-pr";
  String host=r["data"]["domain"]|String("");if(host.startsWith("app-")&&host.endsWith(".eufy.com"))bootstrap=host;
  if(!exchange())return false;ECDH ec;auto key=ec.secret(SERVER_PUBLIC);if(key.size()!=32)return false;
  body.clear();body["email"]=email;body["password"]=aesEncrypt(password,key,false);body["ab"]="US";body["client_secret_info"]["public_key"]=ec.publicKey();for(auto k:{"verify_code","login_id","answer","captcha_id"})body[k]="";
  if(!signedCall("passport","/passport/login",body.as<JsonVariantConst>(),r))return false;
  if(r["fa_info"]["info"].is<JsonVariantConst>()&&!r["fa_info"]["info"].isNull()){error="Eufy requires account verification; import the existing private session";return false;}
  uid=(!r["ap_cloud_user_id"].isNull()?r["ap_cloud_user_id"]:r["user_id"]).as<String>();accountUid=(!r["user_id"].isNull()?r["user_id"]:r["userId"]).as<String>();if(accountUid=="null"||!accountUid.length())accountUid=uid;token=r["auth_token"]|r["token"]|String("");
  if(!uid.length()||!token.length()){error="Eufy login returned no session";return false;}
  auto s=secrets["eufySession"].to<JsonObject>();s["region"]=region;s["bootstrap"]=bootstrap;s["token"]=token;s["uid"]=uid;s["accountUid"]=accountUid;
  secrets["eufyEmail"]=email;secrets["eufyPassword"]=password;saveJson("/secrets.json",secrets.as<JsonVariantConst>());share="";return prepare();
}
bool EufyCloud::findDevices(){
  JsonDocument body,houses,found;body.to<JsonObject>();signedCall("house","/app/house/get_house_list",body.as<JsonVariantConst>(),houses);
  std::vector<String> ids={""};for(JsonObjectConst h:houses["house_infos"].as<JsonArrayConst>()){String id=h["house_id"]|String("");if(id.length())ids.push_back(id);}
  devices.clear();devices.to<JsonArray>();for(int i=0;i<4;i++)devices.add<JsonObject>();
  for(auto&id:ids){body.clear();body.to<JsonObject>();if(id.length())body["house_id"]=id;if(!signedCall("house","/app/house/get_devs_list",body.as<JsonVariantConst>(),found))continue;
    for(JsonObjectConst d:found["devices"].as<JsonArrayConst>())for(int i=0;i<4;i++){
      String sn=d["device_sn"]|String("");if(sn!=SERIALS[i]&&!(i==3&&sn=="T8L0291024470193"))continue;
      if(String(d["device_model"]|"")!=MODELS[i]||String(d["category"]|"")!="eufy_life")continue;
      String prior=devices[i]["serial"]|String("");if(prior.length()&&prior!=sn){devices[i]["ambiguous"]=true;devices[i].remove("serial");continue;}
      if(devices[i]["ambiguous"]|false)continue;devices[i]["serial"]=sn;devices[i]["account"]=d["member"]["admin_user_id"].isNull()?uid:d["member"]["admin_user_id"].as<String>();
    }
  }
  bool any=false;for(int i=0;i<4;i++)any|=deviceReady(i);return any;
}
bool EufyCloud::prepare(){
  if(!timeValid()){error="Waiting for network time";return false;}
  if(!token.length()){String email=secrets["eufyEmail"]|String(""),pw=secrets["eufyPassword"]|String("");if(email.length()&&pw.length())return login(email,pw);error="Eufy credentials required";return false;}
  if(!findDevices()){error="No unique known Eufy devices found";return false;}JsonDocument body;body.to<JsonObject>();
  if(!signedCall("devicemanage","/app/devicemanage/get_user_mqtt_info",body.as<JsonVariantConst>(),credentials,"eufy_life"))return false;
  String host=credentials["endpoint_addr"]|String("");if(!(host.endsWith(".amazonaws.com")||host.endsWith(".eufy.com")||host.endsWith(".anker.com"))||!credentials["certificate_pem"].is<String>()||!credentials["private_key"].is<String>()||!credentials["aws_root_ca1_pem"].is<String>()){error="Invalid Eufy MQTT certificate";return false;}
  ready=true;error="Ready";return true;
}
static void utf(Bytes&out,const String&s){out.push_back(s.length()>>8);out.push_back(s.length());out.insert(out.end(),s.c_str(),s.c_str()+s.length());}
static bool mqttWrite(WiFiClientSecure&c,uint8_t header,const Bytes&data){Bytes out={header};size_t n=data.size();do{uint8_t b=n%128;n/=128;if(n)b|=128;out.push_back(b);}while(n);out.insert(out.end(),data.begin(),data.end());return c.write(out.data(),out.size())==out.size();}
static bool mqttRead(WiFiClientSecure&c,uint8_t&header,Bytes&data,uint32_t timeout=5000){
  uint32_t end=millis()+timeout;auto one=[&](){while(!c.available()){if(!c.connected()||(int32_t)(millis()-end)>=0)return -1;delay(2);}return c.read();};
  int b=one();if(b<0)return false;header=b;size_t n=0,mul=1;bool done=false;for(int i=0;i<4;i++){b=one();if(b<0)return false;n+=(b&127)*mul;if(!(b&128)){done=true;break;}mul*=128;}if(!done||n>16384)return false;data.resize(n);for(size_t i=0;i<n;i++){b=one();if(b<0)return false;data[i]=b;}return true;
}
static void decodeReport(const Bytes&payload,const String&serial,JsonDocument&report){
  JsonDocument d,nested,frameJson;if(deserializeJson(d,payload.data(),payload.size()))return;String outer=d["payload"]|String("");if(deserializeJson(nested,outer))return;
  String sn=nested["sn"]|nested["device_sn"]|serial;if(sn!=serial)return;auto inner=from64(nested["data"]|String(""));if(deserializeJson(frameJson,inner.data(),inner.size()))return;
  Bytes b=fromHex(frameJson["data"]|String(""));if(b.size()<10||b[0]!=255||b[1]!=9)return;uint8_t x=0;for(auto v:b)x^=v;if(x)return;
  int cmd=(b[7]<<8)|b[8];if(cmd!=0xa00&&cmd!=0x204)return;report["cmd"]=cmd;
  for(size_t i=cmd==0xa00?10:9;i+1<b.size()-1;){int tag=b[i++],n=b[i++];if(i+n>b.size()-1)break;uint32_t v=0;for(int j=0;j<n&&j<4;j++)v|=(uint32_t)b[i+j]<<(8*j);if(tag==0xa1)report["power"]=v!=0;if(tag==0xa2)report["brightness"]=v;if(tag==0xa3)report["effectId"]=v;i+=n;}
}
bool EufyCloud::mqtt(int index,const std::vector<std::pair<uint16_t,Bytes>>&frames,JsonDocument&report){
  if(!deviceReady(index)){error=String(NAMES[index])+" identity not validated";return false;}
  String host=credentials["endpoint_addr"]|String(""),cert=credentials["certificate_pem"]|String(""),key=credentials["private_key"]|String(""),ca=credentials["aws_root_ca1_pem"]|String("");
  WiFiClientSecure c;c.setCACert(ca.c_str());c.setCertificate(cert.c_str());c.setPrivateKey(key.c_str());c.setHandshakeTimeout(8);c.setTimeout(6);
  if(!c.connect(host.c_str(),credentials["endpoint_port"]|8883,7000)){error="Eufy MQTT TLS connection failed";return false;}
  String serial=devices[index]["serial"]|String(""),account=devices[index]["account"]|uid;
  String clientId="android-eufy_life-"+(!credentials["user_id"].isNull()?credentials["user_id"].as<String>():uid)+"-"+install.substring(0,16)+"-"+serial.substring(serial.length()-6)+"-"+randomHex(3);
  Bytes packet;utf(packet,"MQTT");packet.insert(packet.end(),{4,2,0,60});utf(packet,clientId);if(!mqttWrite(c,0x10,packet))return false;
  uint8_t header;Bytes b;if(!mqttRead(c,header,b)||header!=0x20||b.size()!=2||b[1]){error="Eufy MQTT CONNECT rejected";return false;}
  String topic="cmd/eufy_life/"+String(MODELS[index])+"/"+serial;
  packet={0,1};for(auto&t:{topic+"/app/res",topic+"/res",String("synq/eufy_life/")+MODELS[index]+"/"+serial+"/state_info",topic+"/app/ota/res"}){utf(packet,t);packet.push_back(1);}
  mqttWrite(c,0x82,packet);if(!mqttRead(c,header,b)||(header>>4)!=9||b.size()!=6||b[2]==128){error="Eufy MQTT subscription rejected";return false;}
  uint16_t id=2;for(auto&f:frames){
    auto dp=EufyWire::command(f.first,account.c_str(),f.second,time(nullptr));JsonDocument envelope,inner;inner["account_id"]=account;inner["device_sn"]=serial;inner["data"]=to64(dp.data(),dp.size());inner["trans"]="";String in;serializeJson(inner,in);
    auto head=envelope["head"].to<JsonObject>();head["version"]="1.0.0.1";head["client_id"]=clientId;head["sess_id"]="0000";head["msg_seq"]=id-1;head["seed"]="";head["timestamp"]=(uint32_t)time(nullptr);head["cmd_status"]=1;head["cmd"]=17;head["sign_code"]=0;envelope["payload"]=in;String encoded;serializeJson(envelope,encoded);
    packet.clear();utf(packet,topic+"/req");packet.push_back(id>>8);packet.push_back(id++);packet.insert(packet.end(),encoded.c_str(),encoded.c_str()+encoded.length());if(!mqttWrite(c,0x32,packet))return false;delay(120);
  }
  bool acked[16]{};uint32_t end=millis()+6000;bool complete=false;
  while((int32_t)(millis()-end)<0){
    if(!mqttRead(c,header,b,500))continue;int type=header>>4;
    if(type==4&&b.size()==2){int ack=(b[0]<<8)|b[1];if(ack>=2&&ack<id&&ack<16)acked[ack]=true;}
    if(type==3&&b.size()>2){int n=(b[0]<<8)|b[1],off=2+n;if(off>(int)b.size())continue;String received((char*)b.data()+2,n);
      if(((header>>1)&3)==1){if(off+2>(int)b.size())continue;Bytes ack={b[off],b[off+1]};mqttWrite(c,0x40,ack);off+=2;}
      if(received.indexOf("/"+serial+"/")>=0)decodeReport(Bytes(b.begin()+off,b.end()),serial,report);
    }
    complete=true;for(int i=2;i<id;i++)complete&=acked[i];if(complete&&!report.isNull())break;
  }
  c.stop();if(!complete){error="MQTT broker did not acknowledge every command";return false;}if(report.isNull()){error="Broker accepted command; controller report not received";return false;}return true;
}
bool EufyCloud::control(JsonVariantConst r,JsonDocument&result){
  if(!ready&&!prepare()){result["error"]=error;return false;}
  String target=r["target"]|String("All");bool any=false,all=true;
  bool brightnessOnly=r["_brightnessOnly"]|false;/* request metadata does not change the command kind */
  bool unusedBrightnessKind=r["brightness"].is<int>()&&r.size()<=2&&!r["power"].is<bool>()&&!r["effect"].is<String>()&&!r["colors"].is<JsonArrayConst>();
  auto records=result["devices"].to<JsonArray>();
  JsonDocument factory;int factoryId=r["factoryId"]|0;
  if(factoryId&&!fetchFactoryPreset(factoryId,factory)){error="Factory preset could not be loaded";return false;}
  for(int i=0;i<4;i++){
    if(target!="All"&&target!=NAMES[i])continue;if(String(r["_skipTarget"]|"")==NAMES[i])continue;any=true;std::vector<std::pair<uint16_t,Bytes>>frames;
    int level=constrain(r["brightness"]|75,1,100);if((r["_scheduled"]|false)||(r["_preview"]|false))level=constrain(r["_brightnessOverrides"][NAMES[i]]|level,1,100);
    if(brightnessOnly)frames.push_back({0x201,EufyWire::setupBrightness(level)});
    else if(r["power"].is<bool>()&&!r["power"].as<bool>())frames.push_back({0x201,EufyWire::setupPower(false)});
    else{
      std::vector<uint32_t>colors;for(JsonVariantConst c:r["colors"].as<JsonArrayConst>()){if(c.is<String>()){String s=c.as<String>();s.replace("#","");colors.push_back(strtoul(s.c_str(),nullptr,16)&0xffffff);}else colors.push_back(c.as<uint32_t>()&0xffffff);}
      String effect=r["effect"]|String("Static");int speed=r["speed"]|3;
      if(factoryId&&String(r["mode"]|"")=="compatible"){
        JsonDocument compatible;factoryCompatibleScene(factory.as<JsonVariantConst>(),compatible.to<JsonObject>());effect=compatible["effect"]|String("Static");speed=compatible["speed"]|3;colors.clear();for(auto c:compatible["colors"].as<JsonArrayConst>())colors.push_back(c.as<uint32_t>());
      }
      if(colors.empty())colors.push_back(0xffffff);
      EufyWire::Pattern p;for(auto n:r["pattern"]["blocks"].as<JsonArrayConst>())p.blocks.push_back(n.as<int>());for(auto n:r["pattern"]["positions"].as<JsonArrayConst>())p.positions.push_back(n.as<int>());p.offset=r["pattern"]["offset"]|0;p.mirror=r["pattern"]["mirror"]|false;
      int lamps=r["_lampCounts"][NAMES[i]]|(i==3?30:60);
      bool nativeFactory=factoryId&&String(r["mode"]|"native")=="native";
      auto fields=nativeFactory?nativeFactoryFields(factory.as<JsonVariantConst>(),i>=2,i==0||i==3):EufyWire::effect(i>=2,effect.c_str(),colors,speed,i==0||i==3,lamps,level,p);
      if(fields.empty()){error="Unsupported Eufy effect";return false;}
      frames.push_back({0x201,EufyWire::setupPower(true)});frames.push_back({(uint16_t)(nativeFactory?0x20d:0x206),fields});frames.push_back({0x201,EufyWire::setupBrightness(level)});
    }
    frames.push_back({0x200,EufyWire::status()});JsonDocument report;bool ok=mqtt(i,frames,report);auto item=records.add<JsonObject>();item["name"]=NAMES[i];item["ok"]=ok;item["report"]=report.as<JsonVariantConst>();item["message"]=ok?"Controller report received":error;
    if(ok&&r["power"].is<bool>()&&report["power"].is<bool>()&&report["power"].as<bool>()!=r["power"].as<bool>()){item["ok"]=false;ok=false;item["message"]="Controller power differs from request";}
    if(ok&&r["brightness"].is<int>()&&report["brightness"].is<int>()&&report["brightness"].as<int>()!=level){item["ok"]=false;ok=false;item["message"]="Controller brightness differs from request";}
    all&=ok;
  }
  if(!all)ready=false;result["ok"]=any&&all;return any&&all;
}
void EufyCloud::describe(JsonArray a){for(int i=0;i<4;i++){auto d=a.add<JsonObject>();d["slot"]=i;d["name"]=NAMES[i];d["model"]=MODELS[i];d["connected"]=ready&&deviceReady(i);d["saved"]=deviceReady(i);d["protocol"]="NanoC6 / Eufy MQTT";}}

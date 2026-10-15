#include "Factory.h"
#include "EufyCloud.h"
#include "EufyProtocol.h"
#include "LocalScheduler.h"
#include <set>
static uint8_t factoryByte(JsonVariantConst v){return (uint8_t)(v.as<int>()&255);}
static void add(Bytes&b,std::initializer_list<uint8_t>v){b.insert(b.end(),v.begin(),v.end());}
static void range(Bytes&b,JsonVariantConst v){if(v.is<JsonArrayConst>())add(b,{factoryByte(v[1]),factoryByte(v[0])});else add(b,{factoryByte(v),0});}
static void tlv(Bytes&b,int tag,const Bytes&v){if(v.size()>255){b.clear();return;}add(b,{(uint8_t)tag,(uint8_t)v.size()});b.insert(b.end(),v.begin(),v.end());}
Bytes nativeFactoryFields(JsonVariantConst p,bool e22,bool reverse){
  Bytes out;uint32_t id=p["lightId"]|0;tlv(out,0xa3,{(uint8_t)id,(uint8_t)(id>>8),(uint8_t)(id>>16),(uint8_t)(id>>24)});tlv(out,0xa4,{factoryByte(p["speed"])});tlv(out,0xa5,{(uint8_t)p["layers"].size()});tlv(out,0xa6,{factoryByte(p["layerExecutionMode"])});tlv(out,0xa8,{0});
  int li=0;for(JsonVariantConst l:p["layers"].as<JsonArrayConst>()){
    Bytes b;add(b,{factoryByte(l["layer_priority"]),factoryByte(l["layer_speed"])});range(b,l["layer_range"]);add(b,{factoryByte(l["interval_type"]),factoryByte(l["interval_value"]),factoryByte(l["light_effect_post_cycle_status"]),factoryByte(l["layer_execution_parameter"]),0,factoryByte(l["current_layer_type"])});
    String palette=l["colors"]|String("");std::vector<uint32_t>colors;int pos=0;while(pos<(int)palette.length()){int end=palette.indexOf('|',pos);if(end<0)end=palette.length();String c=palette.substring(pos,end);if(c.length()!=6)return {};colors.push_back(strtoul(c.c_str(),nullptr,16));pos=end+1;}if(colors.empty())return {};b.push_back(colors.size());
    for(auto col:colors){auto c=e22?EufyWire::rgbcw(col):Bytes{(uint8_t)(col>>16),(uint8_t)(col>>8),(uint8_t)col,0};b.insert(b.end(),c.begin(),c.end());}
    int type=l["current_layer_type"]|0;
    if(type==0){uint8_t dir=factoryByte(l["flow_direction"]);if(reverse&&dir<2)dir^=1;add(b,{factoryByte(l["color_pick_mode"]),factoryByte(l["gradient_value"]),dir,factoryByte(l["direction_change_mode"]),factoryByte(l["length_range"]),factoryByte(l["color_fill_mode"]),factoryByte(l["insert_block_mode"])});range(b,l["insert_block_range"]);b.push_back(factoryByte(l["insert_black_block_mode"]));range(b,l["insert_black_block_range"]);b.push_back(factoryByte(l["brightness_variation_type"]));range(b,l["brightness_range"]);add(b,{factoryByte(l["light_effect_cycle_method"]),factoryByte(l["execution_parameter"].isNull()?l["is_lights_move_with_people"]:l["execution_parameter"])});}
    else if(type==1)add(b,{factoryByte(l["brightness_value"]),factoryByte(l["display_mode"]),factoryByte(l["color_quantity_range"]),factoryByte(l["transition_mode"]),factoryByte(l["unit_transition_duration"]),factoryByte(l["color_switch_mode"]),factoryByte(l["switch_count"]),factoryByte(l["color_pick_sequence"]),0,factoryByte(l["execution_parameter"])});
    else if(type==2){b.push_back(factoryByte(l["brightness_variation_type"]));range(b,l["brightness_range"]);add(b,{factoryByte(l["blink_cycle_count"]),factoryByte(l["blink_position_mode"])});range(b,l["blink_interval"]);add(b,{factoryByte(l["blink_quantity"]),factoryByte(l["blink_asynchrony"]),factoryByte(l["blink_color_switch_mode"]),factoryByte(l["light_effect_cycle_method"]),factoryByte(l["execution_parameter"].isNull()?l["is_lights_move_with_people"]:l["execution_parameter"])});}
    else return {};if(b.size()>255||li>80)return {};tlv(out,0xa9+li++,b);
  }return li?out:Bytes{};
}
static bool normalize(JsonVariantConst raw,JsonDocument&out){
  int id=raw["light_id"]|0;if(id<=0)return false;auto effect=raw["light_effect"][0];JsonDocument params;
  if(effect["params"].is<String>())deserializeJson(params,effect["params"].as<String>());else if(!effect["params"].isNull())params.set(effect["params"]);else if(raw["params"].is<String>())deserializeJson(params,raw["params"].as<String>());else params.set(raw["params"]);
  out["lightId"]=id;out["name"]=raw["name"]|String("Factory "+String(id));out["colors"]=effect["rgb_hex"]|raw["rgb_hex"]|String("");out["brightness"]=effect["brightness"]|raw["brightness"]|75;out["speed"]=params["light_effect_speed"]|1;out["layerExecutionMode"]=params["layer_execution_mode"]|0;out["layers"]=params["layer"];out["raw"]=raw;out["buildableE22"]=!nativeFactoryFields(out.as<JsonVariantConst>(),true,false).empty();out["buildableE120Experimental"]=!nativeFactoryFields(out.as<JsonVariantConst>(),false,false).empty();return out["layers"].size()>0;
}
bool fetchFactoryPreset(int id,JsonDocument&out){
  String key=String(id);bool found=false;
  for(JsonVariantConst p:state["referencedFactoryPresets"].as<JsonArrayConst>())if((p["lightId"]|0)==id){out.set(p);found=true;break;}
  if(!found){JsonDocument request,response;request["light_id"].to<JsonArray>().add(id);if(!eufy.api("light","/app/light/lighteffect/batchget",request.as<JsonVariantConst>(),response))return false;for(JsonVariantConst raw:response["list"].as<JsonArrayConst>())if((raw["light_id"]|0)==id){found=normalize(raw,out);break;}}
  if(!found)return false;for(JsonPairConst p:state["factoryEdits"][key].as<JsonObjectConst>())out[p.key()]=p.value();out["lightId"]=id;out["customized"]=state["factoryEdits"][key].size()>0;return true;
}
void factoryCompatibleScene(JsonVariantConst p,JsonObject scene){
  JsonVariantConst dominant=p["layers"][0];for(JsonVariantConst l:p["layers"].as<JsonArrayConst>())if((l["layer_priority"]|0)>(dominant["layer_priority"]|0))dominant=l;
  int type=dominant["current_layer_type"]|1;String effect=type==0?(int(dominant["length_range"]|0)>0?"Streamlight":"Flow1"):type==2?"Twinkle":int(dominant["transition_mode"]|0)==0?"Breathe":int(dominant["transition_mode"]|0)==2?"Flow1":"Cycle";
  std::set<uint32_t> seen;std::vector<uint32_t>colors;auto append=[&](const String&s){int at=0;while(at<(int)s.length()){int end=s.indexOf('|',at);if(end<0)end=s.length();String c=s.substring(at,end);c.replace("#","");if(c.length()==6){uint32_t n=strtoul(c.c_str(),nullptr,16)&0xffffff;if(!seen.count(n)&&colors.size()<8){seen.insert(n);colors.push_back(n);}}at=end+1;}};
  for(JsonVariantConst l:p["layers"].as<JsonArrayConst>())append(l["colors"]|String(""));append(p["colors"]|String(""));if(colors.empty())colors.push_back(0xffffff);int speed=p["speed"]|dominant["layer_speed"]|25;
  scene["power"]=true;scene["effect"]=effect;scene["brightness"]=constrain(p["brightness"]|75,1,100);scene["speed"]=speed<=5?1:speed<=20?3:speed<=40?5:speed<=70?8:10;auto ca=scene["colors"].to<JsonArray>();for(auto c:colors)ca.add(c);
}
void factoryPromotionRows(JsonArray rows){
  for(JsonPairConst binding:state["factoryPromotionMap"].as<JsonObjectConst>()){
    String id=binding.key().c_str(),eventId=binding.value()["eventId"]|String("");int i=eventIndex(eventId);if(i<0)continue;JsonDocument event,preset;eventAt(i,event);bool found=false;
    for(JsonVariantConst p:state["referencedFactoryPresets"].as<JsonArrayConst>())if((p["lightId"]|0)==id.toInt()){preset.set(p);found=true;break;}if(!found)continue;
    for(JsonPairConst edit:state["factoryEdits"][id].as<JsonObjectConst>())preset[edit.key()]=edit.value();auto r=rows.add<JsonObject>();r["lightId"]=id.toInt();r["name"]=preset["name"];r["eventId"]=eventId;r["eventName"]=event["name"];r["enabled"]=state["factoryPromotions"][id]["enabled"]|true;r["event"]=event.as<JsonVariantConst>();factoryCompatibleScene(preset.as<JsonVariantConst>(),r["scene"].to<JsonObject>());
  }
}
static void collect(JsonVariantConst v,std::set<int>&ids){if(v.is<JsonArrayConst>()){for(auto c:v.as<JsonArrayConst>())collect(c,ids);}else if(v.is<JsonObjectConst>())for(JsonPairConst p:v.as<JsonObjectConst>()){String k=p.key().c_str();if((k=="light_id"||k=="scene_id")&&p.value().is<int>())ids.insert(p.value().as<int>());else collect(p.value(),ids);}}
bool refreshFactoryCatalog(){
  if(!eufy.ready&&!eufy.prepare())return false;JsonDocument body,discovery;body.to<JsonObject>();std::set<int>ids;if(eufy.api("light","/app/light/discover/list",body.as<JsonVariantConst>(),discovery))collect(discovery.as<JsonVariantConst>(),ids);discovery.clear();for(int id=10001;id<=10999;id++)ids.insert(id);
  File file=LittleFS.open("/factory-index.tmp","w");if(!file)return false;file.print("{\"ok\":true,\"presets\":[");bool first=true;std::vector<int>batch;std::set<std::string>names;
  auto flush=[&](){JsonDocument request,response;auto a=request["light_id"].to<JsonArray>();for(int n:batch)a.add(n);batch.clear();if(!eufy.api("light","/app/light/lighteffect/batchget",request.as<JsonVariantConst>(),response))return false;
    for(JsonVariantConst raw:response["list"].as<JsonArrayConst>()){JsonDocument full,summary;if(!normalize(raw,full))continue;String name=full["name"]|String("");name.trim();name.toLowerCase();if(!names.insert(std::string(name.c_str())).second)continue;
      for(auto k:{"lightId","name","colors","brightness","speed","layerExecutionMode","buildableE22","buildableE120Experimental"})summary[k]=full[k];summary["_summary"]=true;
      auto layers=summary["layers"].to<JsonArray>();for(JsonVariantConst layer:full["layers"].as<JsonArrayConst>()){auto l=layers.add<JsonObject>();for(auto k:{"current_layer_type","colors","layer_speed","flow_direction"})l[k]=layer[k];}
      if(LittleFS.totalBytes()-LittleFS.usedBytes()<12000)return false;if(!first)file.print(',');first=false;serializeJson(summary,file);
    }return true;};
  bool success=true;for(int id:ids){batch.push_back(id);if(batch.size()==5&&!flush()){success=false;break;}}if(success&&!batch.empty())success=flush();file.print("]}");file.close();if(!success){LittleFS.remove("/factory-index.tmp");return false;}return LittleFS.rename("/factory-index.tmp","/factory-index.json");
}
bool handleFactoryApi(const String&path,JsonVariantConst in,bool post,bool busy){
  if(!path.startsWith("/api/eufy/factory-"))return false;JsonDocument out;
  if(path=="/api/eufy/factory-presets"&&!post){File file=LittleFS.open("/factory-index.json","r");if(file){web.streamFile(file,"application/json");file.close();}else{out["presets"]=state["referencedFactoryPresets"];out["ok"]=true;out["message"]="Refresh the Eufy catalog after account connection";reply(200,out.as<JsonVariantConst>());}return true;}
  if(path=="/api/eufy/factory-presets/refresh"&&post){JsonDocument request;request["_factoryRefresh"]=true;String job;if(!queueLocalControl(request.as<JsonVariantConst>(),job)){replyError(409,lastError);return true;}out["ok"]=true;out["jobId"]=job;out["refreshing"]=true;reply(202,out.as<JsonVariantConst>());return true;}
  if(path=="/api/eufy/factory-preset"&&!post){if(busy){replyError(409,"Eufy is busy");return true;}JsonDocument p;if(!fetchFactoryPreset(web.arg("id").toInt(),p)){replyError(502,eufy.error);return true;}out["ok"]=true;out["preset"]=p.as<JsonVariantConst>();reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/eufy/factory-presets/save"&&post){int id=in["lightId"]|0;if(id<1||!in["preset"]["layers"].is<JsonArrayConst>()){replyError(400,"Invalid factory preset");return true;}state["factoryEdits"][String(id)]=in["preset"];saveJson("/state.json",state.as<JsonVariantConst>());out["ok"]=true;out["preset"]=in["preset"];reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/eufy/factory-presets/reset"&&post){state["factoryEdits"].remove(String(in["lightId"]|0));saveJson("/state.json",state.as<JsonVariantConst>());web.send(200,"application/json","{\"ok\":true}");return true;}
  if(path=="/api/eufy/factory-test"&&post){JsonDocument request;request["factoryId"]=in["lightId"];request["mode"]=in["mode"]|"native";request["target"]=in["target"]|"All";request["brightness"]=in["brightness"]|75;String job;if(!queueLocalControl(request.as<JsonVariantConst>(),job)){replyError(409,lastError);return true;}out["ok"]=true;out["jobId"]=job;reply(202,out.as<JsonVariantConst>());return true;}
  if(path=="/api/eufy/factory-promotions"){
    if(post){int id=in["lightId"]|0;if(id<1){replyError(400,"Factory ID required");return true;}state["factoryPromotions"][String(id)]["enabled"]=in["enabled"]|true;saveJson("/state.json",state.as<JsonVariantConst>());}
    out["ok"]=true;auto promotions=out["promotions"].to<JsonArray>();factoryPromotionRows(promotions);int count=0;for(auto p:promotions)if(p["enabled"]|true)count++;out["group"]["total"]=promotions.size();out["group"]["enabledCount"]=count;out["group"]["enabled"]=count>0;if(post)for(auto p:promotions)if((p["lightId"]|0)==(in["lightId"]|0))out["promotion"]=p;reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/eufy/factory-promotions/group"&&post){for(JsonPair p:state["factoryPromotionMap"].as<JsonObject>())state["factoryPromotions"][String(p.key().c_str())]["enabled"]=in["enabled"]|false;saveJson("/state.json",state.as<JsonVariantConst>());out["ok"]=true;reply(200,out.as<JsonVariantConst>());return true;}
  return false;
}

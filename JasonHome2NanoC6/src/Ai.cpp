#include "Ai.h"
#include "LocalScheduler.h"
static bool configured(){return String(secrets["cfAccount"]|"").length()&&String(secrets["cfToken"]|"").length();}
static bool call(const String&route,JsonVariantConst value,JsonDocument&out){
  if(!configured()){lastError="Connect Cloudflare Workers AI in the AI tab";return false;}
  String account=secrets["cfAccount"]|String(""),token=secrets["cfToken"]|String(""),body;serializeJson(value,body);
  return httpsJson("https://api.cloudflare.com/client/v4/accounts/"+account+"/ai/"+route,&body,out,{{"Authorization","Bearer "+token}});
}
static void daily(){int day=time(nullptr)/86400;if((state["aiDay"]|-1)!=day){state["aiDay"]=day;state["aiNeurons"]=0.;}}
static void aiState(JsonDocument&out){daily();out["ok"]=true;out["configured"]=configured();out["provider"]="Cloudflare Workers AI";out["freeTier"]=true;out["model"]="@cf/zai-org/glm-4.7-flash";out["accountId"]=secrets["cfAccount"]|"";out["thread"]=state["aiThread"];out["draft"]=state["aiDraft"];auto u=out["usage"].to<JsonObject>();u["limit"]=10000;u["used"]=state["aiNeurons"]|0.;u["percent"]=double(state["aiNeurons"]|0.)/100.;u["source"]="local-estimate";u["resetAt"]="00:00 UTC";u["remaining"]=std::max(0.,10000.-double(state["aiNeurons"]|0.));u["estimated"]=true;auto a=out["applied"].to<JsonArray>();for(auto e:state["extraEvents"].as<JsonArrayConst>())if(e["aiOneTime"]|false)a.add(e);}
static bool chat(const String&message,JsonDocument&result){daily();
  JsonDocument request,response;request["model"]="@cf/zai-org/glm-4.7-flash";request["max_completion_tokens"]=1500;request["temperature"]=.55;request["response_format"]["type"]="json_object";
  auto messages=request["messages"].to<JsonArray>();auto system=messages.add<JsonObject>();system["role"]="system";
  system["content"]="You are Jason Home 2's lighting designer. Return JSON only: {\"reply\":\"natural response\",\"draft\":null or {\"name\":\"name\",\"target_event\":\"holiday or empty\",\"date\":\"YYYY-MM-DD or empty\",\"brightness\":1-100,\"colors\":[\"#RRGGBB\"],\"layers\":[{\"effect\":\"Static|Flow1|Flow2|Cycle|Streamlight|Twinkle|Breathe\",\"speed\":1-5,\"minutes\":2-30,\"shift\":0,\"pattern\":{\"blocks\":[5,3],\"offset\":0,\"mirror\":false}}]}}. Keep the user's selected palette. Use one to eight layers. Revise the current draft when asked. Pool and Shed are reversed automatically. Do not claim a draft is applied. Current draft: "+String(state["aiDraft"].isNull()?"none":"provided below");
  if(!state["aiDraft"].isNull()){auto old=messages.add<JsonObject>();old["role"]="assistant";String draft;serializeJson(state["aiDraft"],draft);old["content"]=draft;}
  auto thread=state["aiThread"].as<JsonArray>();for(auto item:thread){auto m=messages.add<JsonObject>();m["role"]=item["role"];m["content"]=item["text"];}
  auto user=messages.add<JsonObject>();user["role"]="user";user["content"]=message;
  if(!call("v1/chat/completions",request.as<JsonVariantConst>(),response))return false;
  String content=response["choices"][0]["message"]["content"]|response["result"]["choices"][0]["message"]["content"]|String("");JsonDocument answer;
  if(deserializeJson(answer,content)||!answer["reply"].is<String>()){lastError="AI returned an unreadable design";return false;}
  if(answer["draft"].is<JsonObject>()){
    auto draft=answer["draft"].as<JsonObject>();if(!draft["colors"].size()||!draft["layers"].size()||draft["layers"].size()>8){lastError="AI draft needs colors and 1–8 layers";return false;}
    for(auto p:draft["layers"].as<JsonArray>()){p["speed"]=constrain(p["speed"]|2,1,5);p["minutes"]=constrain(p["minutes"]|8,2,30);}
    draft["brightness"]=constrain(draft["brightness"]|100,1,100);state["aiDraft"]=draft;
  }
  if(!state["aiThread"].is<JsonArray>())state["aiThread"].to<JsonArray>();auto t=state["aiThread"].as<JsonArray>();while(t.size()>4)t.remove(0);auto a=t.add<JsonObject>();a["role"]="user";a["text"]=message;auto b=t.add<JsonObject>();b["role"]="assistant";b["text"]=answer["reply"];
  state["aiNeurons"]=double(state["aiNeurons"]|0.)+double(response["usage"]["prompt_tokens"]|0)*.0055+double(response["usage"]["completion_tokens"]|0)*.0364;
  saveJson("/state.json",state.as<JsonVariantConst>());result["ok"]=true;result["reply"]=answer["reply"];result["draft"]=state["aiDraft"];result["thread"]=state["aiThread"];JsonDocument status;aiState(status);result["state"]=status.as<JsonVariantConst>();return true;
}
bool handleAiApi(const String&path,JsonVariantConst in,bool post){
  if(path!="/api/ai"&&!path.startsWith("/api/ai/")&&path!="/api/curtain/ai-revamp")return false;
  JsonDocument out;
  if(path=="/api/ai"){aiState(out);reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/ai/key"&&post){
    if(in["remove"]|false){secrets.remove("cfAccount");secrets.remove("cfToken");}
    else{String account=in["accountId"]|String(""),token=in["token"]|String("");bool valid=account.length()>=8&&account.length()<=64&&token.length()>=20;for(char c:account)if(!isalnum(c)&&c!='_'&&c!='-')valid=false;if(!valid){replyError(400,"Check the Cloudflare Account ID and token");return true;}secrets["cfAccount"]=account;secrets["cfToken"]=token;}
    saveJson("/secrets.json",secrets.as<JsonVariantConst>());aiState(out);reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/ai/reset"){state["aiThread"].to<JsonArray>();state.remove("aiDraft");endPreview();saveJson("/state.json",state.as<JsonVariantConst>());aiState(out);reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/ai/chat"||path=="/api/ai/voice-turn"){
    String message=in["message"]|String("");
    if(path.endsWith("voice-turn")){JsonDocument voice,transcript;voice["audio"]=in["audio"];voice["task"]="transcribe";voice["language"]="en";voice["vad_filter"]=true;if(!call("run/@cf/openai/whisper-large-v3-turbo",voice.as<JsonVariantConst>(),transcript)){replyError(502,lastError);return true;}message=transcript["result"]["text"]|transcript["text"]|String("");}
    if(!message.length()){replyError(400,"Tell the AI what you want the lights to do");return true;}
    if(!chat(message,out)){replyError(502,lastError);return true;}if(path.endsWith("voice-turn")){out["transcript"]=message;out["audioBase64"]="";}reply(200,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/ai/preview"||path=="/api/ai/preview-edit"){
    JsonDocument draft;draft.set(path.endsWith("preview-edit")?in:state["aiDraft"].as<JsonVariantConst>());if(in["brightness"].is<int>())draft["brightness"]=in["brightness"];draft["creativePhases"]=draft["layers"];String id;
    if(!startPreview(draft.as<JsonVariantConst>(),id)){replyError(409,lastError);return true;}out["ok"]=true;out["queued"]=true;out["jobId"]=id;reply(202,out.as<JsonVariantConst>());return true;
  }
  if(path=="/api/ai/apply-once"){
    auto draft=state["aiDraft"];if(draft.isNull()){replyError(409,"Create an AI draft first");return true;}tm now{};time_t ts=time(nullptr);localtime_r(&ts,&now);int y=now.tm_year+1900,m=now.tm_mon+1,d=now.tm_mday;String date=draft["date"]|String("");bool explicitDate=sscanf(date.c_str(),"%d-%d-%d",&y,&m,&d)==3;
    if(!explicitDate){String wanted=draft["target_event"]|String("");wanted.toLowerCase();if(wanted.length())for(size_t i=0;i<eventCount();i++){JsonDocument event;eventAt(i,event);String name=event["name"]|String("");name.toLowerCase();if(name.indexOf(wanted)>=0&&nextLocalEventDate(event.as<JsonVariantConst>(),ts,y,m,d))break;}}
    if(m<1||m>12||d<1||d>31||y<2026||y>2100){replyError(400,"AI draft needs a valid date");return true;}
    if(!state["extraEvents"].is<JsonArray>())state["extraEvents"].to<JsonArray>();auto event=state["extraEvents"].add<JsonObject>();event.set(draft);event["id"]="ai-once-"+randomHex(6);event["enabled"]=true;event["aiOneTime"]=true;event["rule"]="Fixed";event["month"]=m;event["day"]=d;event["creativePhases"]=draft["layers"];auto sc=event["scheduleOverride"].to<JsonObject>();sc["mode"]="date";sc["annual"]=false;sc["year"]=y;sc["startMonth"]=m;sc["startDay"]=d;
    saveJson("/state.json",state.as<JsonVariantConst>());aiState(out);JsonDocument result;result["ok"]=true;result["state"]=out.as<JsonVariantConst>();char dt[12];snprintf(dt,sizeof(dt),"%04d-%02d-%02d",y,m,d);result["appliedDate"]=dt;reply(200,result.as<JsonVariantConst>());return true;
  }
  if(path=="/api/ai/remove"){String id=in["id"]|String("");auto a=state["extraEvents"].as<JsonArray>();for(size_t i=0;i<a.size();i++)if(String(a[i]["id"]|"")==id){a.remove(i);break;}saveJson("/state.json",state.as<JsonVariantConst>());JsonDocument st;aiState(st);out["ok"]=true;out["state"]=st.as<JsonVariantConst>();reply(200,out.as<JsonVariantConst>());return true;}
  if(path=="/api/curtain/ai-revamp"){
    String image=in["image"]|String("");int pos=image.indexOf(',');auto bytes=from64(image.substring(pos+1));if(bytes.size()<80||bytes.size()>22000){replyError(400,"Use a small JPEG preview for subject detection");return true;}
    if(!configured()){replyError(409,"Connect Cloudflare AI or use local Enhanced Detail");return true;}
    // Avoid one ArduinoJson heap node per image byte on the small C6.
    String body="{\"image\":[";body.reserve(bytes.size()*4+20);bool first=true;for(auto b:bytes){if(!first)body+=',';first=false;body+=String(b);}body+="]}";
    JsonDocument response;String url="https://api.cloudflare.com/client/v4/accounts/"+String(secrets["cfAccount"]|"")+"/ai/run/@cf/facebook/detr-resnet-50";
    if(!httpsJson(url,&body,response,{{"Authorization","Bearer "+String(secrets["cfToken"]|"")}})){replyError(502,lastError);return true;}
    double best=-1;auto detections=out["detected"].to<JsonArray>();for(JsonVariantConst hit:response["result"].as<JsonArrayConst>()){
      double score=hit["score"]|0.;if(score<.35)continue;auto box=hit["box"];double xmax=box["xmax"]|0.,ymax=box["ymax"]|0.,scale=std::max(xmax,ymax)>1.5?256.:1.;double x0=double(box["xmin"]|0.)/scale,y0=double(box["ymin"]|0.)/scale,x1=xmax/scale,y1=ymax/scale,area=std::max(0.,(x1-x0)*(y1-y0));
      auto item=detections.add<JsonObject>();item["label"]=hit["label"];item["confidence"]=score;item["x0"]=x0;item["y0"]=y0;item["x1"]=x1;item["y1"]=y1;double rank=score*(.4+std::min(.43,sqrt(area)*.65))-.15*(pow((x0+x1)/2-.5,2)+pow((y0+y1)/2-.5,2));if(rank>best){best=rank;out["subject"]=item;}
    }out["ok"]=true;reply(200,out.as<JsonVariantConst>());return true;
  }
  return false;
}

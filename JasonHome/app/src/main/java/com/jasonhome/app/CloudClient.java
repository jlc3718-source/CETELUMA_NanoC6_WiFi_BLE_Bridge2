package com.jasonhome.app;
import android.net.Network;
import android.os.Build;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.security.spec.*;
import java.util.*;
import javax.net.ssl.*;
import static com.jasonhome.app.CloudWire.*;

/**
 * Eufy cloud client proven by Home Wi-Fi Test 1.2.0.
 * Session persistence is handled externally by CloudSessionStore.
 */
final class CloudClient {
 interface Host{void log(String s);void check()throws Exception;Network network();void track(Closeable c);void untrack(Closeable c);void captcha(String image);}
 static final class LightSpec {
  final String name,model;final String[] serials;
  LightSpec(String n,String m,String... ids){name=n;model=m;serials=ids;}
  boolean matches(String serial){for(String s:serials)if(s.equals(serial))return true;return false;}
 }
 static final LightSpec[] LIGHTS={
  new LightSpec("Pool","T8L00","T8L006102353014B"),
  new LightSpec("House","T8L00","T8L00610243503A2"),
  new LightSpec("Garage","T8L02","T8L028102427474A"),
  new LightSpec("Shed","T8L02","T8L0281024470193","T8L0291024470193")
 };
 static LightSpec spec(String name)throws IOException{for(LightSpec s:LIGHTS)if(s.name.equals(name))return s;throw new IOException("Unknown light string");}
 final Host h;final String installId;
 String region="us-pr",bootstrap="",share="",ident="",token="",uid="",accountUid="",email="",pass="",captchaId="";
 boolean authed=false,twoFactor=false; final Map<String,JSONObject> lights=new LinkedHashMap<>();JSONObject selected,creds;LightSpec selectedSpec;
 long lastLogin=0;
 CloudClient(Host h,String installId){this.h=h;this.installId=installId;}

 JSONObject exportSession()throws Exception{
  return new JSONObject().put("region",region).put("bootstrap",bootstrap).put("token",token).put("uid",uid).put("accountUid",accountUid);
 }
 boolean importSession(JSONObject o){
  if(o==null)return false;
  region=o.optString("region","us-pr");bootstrap=o.optString("bootstrap","");
  token=o.optString("token","");uid=o.optString("uid","");accountUid=o.optString("accountUid","");
  authed=!token.isEmpty()&&!uid.isEmpty()&&!accountUid.isEmpty();
  share="";ident="";lights.clear();selected=null;selectedSpec=null;creds=null;
  return authed;
 }
 void logout(){share="";ident="";token="";uid="";accountUid="";email="";pass="";captchaId="";authed=false;twoFactor=false;lights.clear();selected=null;selectedSpec=null;creds=null;h.captcha("");h.log("Cloud session cleared.");}
 Map<String,String> base(){Map<String,String> m=new LinkedHashMap<>();m.put("app-name","eufy_mega");m.put("app-version","6.0.41_26142");m.put("app_version","6.0.41_26142");for(String k:new String[]{"os-type","os_type"})m.put(k,"android");for(String k:new String[]{"os-version","os_version"})m.put(k,""+Build.VERSION.SDK_INT);for(String k:new String[]{"phone-model","phone_model"})m.put(k,Build.MODEL);m.put("model-type","PHONE");m.put("country","US");m.put("ab_code","US");m.put("openudid",installId);m.put("language","en");m.put("test-flag","false");m.put("user-agent","ktor-client");m.put("accept","application/json");m.put("accept-charset","UTF-8");return m;}
 void auth(Map<String,String> headers)throws Exception{if(!token.isEmpty()){headers.put("x-auth-token",token);headers.put("authorization",token);headers.put("gtoken",md5(accountUid));}}
 static boolean allowedApi(String host){return host.matches("(?:mega|app-(?:openapi|passport|push|house|devicemanage))-(?:us|eu)-pr\\.eufy\\.com");}
 static boolean allowedBroker(String host){return host.matches("[a-zA-Z0-9.-]+")&&(host.endsWith(".anker.com")||host.endsWith(".eufy.com")||host.endsWith(".amazonaws.com"));}
 JSONObject raw(String host,String path,String body,Map<String,String> headers)throws Exception{
  h.check();if(!allowedApi(host))throw new IOException("Unexpected API hostname rejected");
  Network n=h.network();if(n==null)throw new IOException("No active network");
  HttpsURLConnection c=(HttpsURLConnection)n.openConnection(new URL("https://"+host+path));Closeable stop=()->c.disconnect();h.track(stop);
  try{c.setInstanceFollowRedirects(false);c.setRequestMethod("POST");c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setDoOutput(true);for(Map.Entry<String,String> e:headers.entrySet())c.setRequestProperty(e.getKey(),e.getValue());byte[] b=bytes(body);c.setFixedLengthStreamingMode(b.length);try(OutputStream out=c.getOutputStream()){out.write(b);}int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream data=new ByteArrayOutputStream();if(in!=null)try(InputStream stream=in){byte[] buf=new byte[4096];int z;while((z=stream.read(buf))!=-1){h.check();data.write(buf,0,z);if(data.size()>4*1024*1024)throw new IOException("API response exceeds size limit");}}JSONObject obj;try{obj=new JSONObject(data.toString("UTF-8"));}catch(JSONException e){throw new IOException("API "+path+" HTTP "+status+" returned non-JSON content");}obj.put("_http",status);return obj;
  }finally{h.untrack(stop);c.disconnect();}
 }
 void signedHeaders(Map<String,String> m,String key,String keyId,String cipher)throws Exception{String ts=""+(System.currentTimeMillis()/1000),nonce=id();m.put("x-encryption-info","algo_ecdh");m.put("x-replay-info","replay");m.put("x-key-ident",keyId);m.put("x-request-ts",ts);m.put("x-request-once",nonce);m.put("x-signature",signature(key,ts,nonce,cipher));}
 void exchange()throws Exception{h.log("Cloud: negotiating encrypted API session.");KeyPair k=pair();String encrypted=encrypt(publicHex(k),LOCAL);ident=id();Map<String,String> headers=base();auth(headers);headers.put("content-type","application/json");signedHeaders(headers,LOCAL,ident,encrypted);String host=bootstrap.isEmpty()?"app-openapi-"+region+".eufy.com":bootstrap;JSONObject response=raw(host,"/openapi/oauth/key/exchange",new JSONObject().put("client_public_key",encrypted).toString(),headers);if(response.optInt("code",-1)!=0)throw error("Key exchange",response);String server=decrypt(response.getJSONObject("data").getString("server_public_key"),LOCAL);share=hex(secret(k,server)).substring(0,32);h.log("Cloud: API key exchange succeeded.");}
 static final class ApiError extends IOException{final int code;ApiError(String stage,int http,int code){super(stage+": HTTP "+http+", API code "+code);this.code=code;}}
 ApiError error(String stage,JSONObject r){return new ApiError(stage,r.optInt("_http"),r.optInt("code",-1));}
 JSONObject signed(String service,String path,JSONObject body,boolean authenticated,String scope)throws Exception{
  if(share.isEmpty())exchange();String cipher=encrypt(body.toString(),share);String[] types=path.startsWith("/passport/")?new String[]{"text/plain","application/json"}:new String[]{"application/json","text/plain"};
  for(int attempt=0;attempt<2;attempt++){Map<String,String> headers=base();headers.put("content-type",types[attempt]);signedHeaders(headers,share,ident,cipher);if(authenticated)auth(headers);if(scope!=null)headers.put("app-name",scope);
   JSONObject r=raw("app-"+service+"-"+region+".eufy.com",path,cipher,headers);int code=r.optInt("code",-1);if(r.optInt("_http")==200&&code==0){Object d=r.opt("data");if(d instanceof String&&!((String)d).isEmpty())d=new JSONTokener(decrypt((String)d,share)).nextValue();if(d instanceof JSONObject)return(JSONObject)d;if(d==null||d==JSONObject.NULL)return new JSONObject();return new JSONObject().put("result",d);}
   if(attempt==0&&(code==4416||code==10000||r.optInt("_http")==400))continue;
   if(code==401||r.optInt("_http")==401){authed=false;lights.clear();selected=null;selectedSpec=null;creds=null;}
   throw error(path,r);
  }throw new IOException("API request failed");
 }
 void login(String address,String password,String answer,String verification)throws Exception{
  if(authed){h.log("Already signed in.");return;}
  if(address.isEmpty()||password.isEmpty())throw new IOException("Enter your Eufy email and password.");
  if(answer.isEmpty()&&verification.isEmpty()&&System.currentTimeMillis()-lastLogin<30000)throw new IOException("Wait 30 seconds between initial login attempts.");
  email=address;pass=password;lastLogin=System.currentTimeMillis();
  if(share.isEmpty()){
   Map<String,String> headers=base();headers.put("content-type","application/json");JSONObject r=raw("mega-us-pr.eufy.com","/passport/estimate_domain",new JSONObject().put("ab","us").put("mode",1).toString(),headers);
   if(r.optInt("code",-1)!=0)throw error("Region lookup",r);JSONObject d=r.optJSONObject("data");if(d!=null){String blob=d.toString();region=blob.contains("-eu-")?"eu-pr":"us-pr";String domain=d.optString("domain",d.optString("host",""));if(!domain.isEmpty()&&!domain.startsWith("mega-")&&allowedApi(domain))bootstrap=domain;}
   h.log("Cloud region: "+region);exchange();
  }
  String[] encrypted=password(password);JSONObject body=new JSONObject().put("email",email).put("password",encrypted[1]).put("ab","US").put("client_secret_info",new JSONObject().put("public_key",encrypted[0])).put("verify_code",verification).put("login_id","");if(verification.isEmpty())body.put("answer",answer).put("captcha_id",captchaId);
  JSONObject result;
  try{result=signed("passport","/passport/login",body,!token.isEmpty(),null);}catch(ApiError e){if(e.code==100032||e.code==100033){JSONObject cap=signed("passport","/passport/generate/captcha",new JSONObject(),false,null);captchaId=cap.getString("captcha_id");h.captcha(cap.getString("item"));h.log("Captcha required.");return;}throw e;}
  uid=result.optString("ap_cloud_user_id",result.optString("user_id",result.optString("userId","")));accountUid=result.optString("user_id",result.optString("userId",uid));token=result.optString("auth_token",result.optString("token",""));
  if(uid.isEmpty()||accountUid.isEmpty()||token.isEmpty())throw new IOException("Login response contained no usable session.");
  JSONObject fa=result.optJSONObject("fa_info");if(fa!=null&&!fa.optString("info").isEmpty()){twoFactor=true;captchaId="";h.captcha("");h.log("Verification required.");return;}
  twoFactor=false;captchaId="";h.captcha("");share="";exchange();authed=true;pass="";email="";h.log("SIGNED IN.");
 }
 void sendCode()throws Exception{if(!twoFactor||token.isEmpty())throw new IOException("No verification session is pending.");signed("push","/app/sendmsg/verify_code",new JSONObject().put("biz_type",1004).put("message_type",2).put("transaction",""+System.currentTimeMillis()),true,null);h.log("Verification email requested.");}
 void continueLogin(String captcha,String code)throws Exception{if(pass.isEmpty())throw new IOException("No pending login.");if(!code.isEmpty()&&!twoFactor)throw new IOException("No verification code is pending.");if(!captcha.isEmpty()&&captchaId.isEmpty())throw new IOException("No captcha is pending.");login(email,pass,captcha,code);}
 void requireLogin()throws IOException{if(!authed)throw new IOException("Complete Eufy sign-in first.");}
 void findLights()throws Exception{requireLogin();lights.clear();selected=null;selectedSpec=null;creds=null;List<JSONObject> bodies=new ArrayList<>();bodies.add(new JSONObject());boolean partial=false;
  try{JSONObject houses=signed("house","/app/house/get_house_list",new JSONObject(),true,null);JSONArray entries=houses.optJSONArray("house_infos");if(entries!=null)for(int i=0;i<entries.length();i++){JSONObject house=entries.optJSONObject(i);if(house!=null&&!house.optString("house_id").isEmpty())bodies.add(new JSONObject().put("house_id",house.getString("house_id")));}}catch(ApiError e){partial=true;h.log("Home list: "+e.getMessage()+"; trying base list.");}
  Map<String,JSONObject> found=new LinkedHashMap<>();
  for(JSONObject body:bodies){h.check();try{JSONObject list=signed("house","/app/house/get_devs_list",body,true,null);JSONArray devs=list.optJSONArray("devices");if(devs!=null)for(int i=0;i<devs.length();i++){JSONObject d=devs.optJSONObject(i);if(d==null)continue;String sn=d.optString("device_sn");for(LightSpec spec:LIGHTS)if(spec.matches(sn))found.put(sn,d);}}catch(ApiError e){partial=true;h.log("One device list: "+e.getMessage());}}
  for(LightSpec spec:LIGHTS){JSONObject match=null;int count=0;for(String candidate:spec.serials){JSONObject d=found.get(candidate);if(d==null)continue;if(!spec.model.equals(d.optString("device_model"))||!"eufy_life".equals(d.optString("category"))){h.log(spec.name+": returned identity has unexpected model/category; blocked.");continue;}match=d;count++;}
   if(count==1){lights.put(spec.name,match);h.log(spec.name+" READY: "+match.optString("device_sn")+" / "+spec.model);}else h.log(spec.name+(count>1?" AMBIGUOUS":" NOT FOUND"));
  }
  if(partial)h.log("Some home lists failed; missing strings may need retry.");
  if(lights.isEmpty())throw new IOException("No known light string found.");
  h.log("Discovered "+lights.size()+" of 4 known strings.");
 }
 void requireTarget(String name)throws IOException{requireLogin();LightSpec spec=spec(name);JSONObject record=lights.get(name);if(record==null||!spec.matches(record.optString("device_sn"))||!spec.model.equals(record.optString("device_model"))||!"eufy_life".equals(record.optString("category")))throw new IOException(name+" has no validated Eufy record.");selected=record;selectedSpec=spec;}
 void certificate()throws Exception{requireLogin();if(lights.isEmpty())throw new IOException("Find the light strings first.");creds=signed("devicemanage","/app/devicemanage/get_user_mqtt_info",new JSONObject(),true,"eufy_life");for(String field:new String[]{"endpoint_addr","certificate_pem","private_key","aws_root_ca1_pem"})if(creds.optString(field).isEmpty()){creds=null;throw new IOException("Certificate response is missing "+field);}
  String host=creds.getString("endpoint_addr"),scope=creds.optString("app_name","eufy_life");if(!allowedBroker(host)||!scope.equals("eufy_life")){creds=null;throw new IOException("Unexpected broker or certificate scope.");}h.log("Lighting MQTT certificate ready; scope eufy_life.");
 }
 String account(){JSONObject member=selected.optJSONObject("member");return member!=null&&!member.optString("admin_user_id").isEmpty()?member.optString("admin_user_id"):uid;}
 static byte[] pem(String text){return Base64.getDecoder().decode(text.replaceAll("-----[^-]+-----","").replaceAll("\\s",""));}
 static byte[] der(int tag,byte[] value)throws Exception{ByteArrayOutputStream b=new ByteArrayOutputStream();b.write(tag);if(value.length<128)b.write(value.length);else{int n=value.length,count=0;for(int x=n;x>0;x>>=8)count++;b.write(128|count);for(int i=count-1;i>=0;i--)b.write(n>>(8*i));}b.write(value);return b.toByteArray();}
 SSLContext context()throws Exception{
  CertificateFactory cf=CertificateFactory.getInstance("X.509");Collection<? extends java.security.cert.Certificate> chain=cf.generateCertificates(new ByteArrayInputStream(bytes(creds.getString("certificate_pem"))));String keyPem=creds.getString("private_key");byte[] key=pem(keyPem);
  if(keyPem.contains("BEGIN RSA PRIVATE KEY"))key=der(0x30,concat(new byte[]{2,1,0},unhex("300d06092a864886f70d0101010500"),der(4,key)));
  PrivateKey privateKey;try{privateKey=KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(key));}catch(InvalidKeySpecException e){privateKey=KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(key));}
  KeyStore ks=KeyStore.getInstance(KeyStore.getDefaultType());ks.load(null);ks.setKeyEntry("client",privateKey,new char[0],chain.toArray(new java.security.cert.Certificate[0]));KeyManagerFactory km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(ks,new char[0]);
  KeyStore roots=KeyStore.getInstance(KeyStore.getDefaultType());roots.load(null);int n=0;for(java.security.cert.Certificate c:cf.generateCertificates(new ByteArrayInputStream(bytes(creds.getString("aws_root_ca1_pem")))))roots.setCertificateEntry("ca"+(n++),c);if(n==0)throw new IOException("No broker CA certificate");TrustManagerFactory tm=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());tm.init(roots);SSLContext ctx=SSLContext.getInstance("TLS");ctx.init(km.getKeyManagers(),tm.getTrustManagers(),null);return ctx;
 }
 String[] topics(){String b="eufy_life/"+selectedSpec.model+"/"+selected.optString("device_sn");return new String[]{"cmd/"+b+"/app/res","cmd/"+b+"/res","synq/"+b+"/state_info","cmd/"+b+"/app/ota/res"};}
 void mqtt(String lightName,int command)throws Exception{
  if(command==-2){mqttFrames(lightName,null,null,"LISTEN",25000);return;}
  if(command==0){mqttFrames(lightName,new int[]{0x0200},new byte[][]{new byte[]{(byte)0xA3,2,(byte)0xFF,0x1F}},"STATUS",10000);return;}
  if(command==1||command==2){mqttFrames(lightName,new int[]{EufyLightCommands.OP_SETUP},new byte[][]{new byte[]{(byte)0xA3,1,(byte)(command==1?1:0)}},command==1?"ON":"OFF",10000);return;}
  throw new IOException("Unknown cloud command");
 }
 void mqttBrightness(String lightName,int percent)throws Exception{
  int v=Math.max(0,Math.min(100,percent));
  mqttFrames(lightName,new int[]{EufyLightCommands.OP_SETUP},new byte[][]{EufyLightCommands.brightness(v)},"BRIGHTNESS "+v+"%",10000);
 }
 void mqttColor(String lightName,int rgb)throws Exception{
  String model=spec(lightName).model;
  byte[] fields=EufyLightCommands.color(model,rgb&0xffffff,EufyLightCommands.defaultLampCount(model));
  mqttFrames(lightName,new int[]{EufyLightCommands.OP_COLOR},new byte[][]{fields},"COLOR",10000);
 }
 void mqttEffect(String lightName,String effect,int[] colors,int speed,boolean reverse)throws Exception{
  String model=spec(lightName).model;
  int[] safe=colors==null||colors.length==0?new int[]{0xFFFFFF}:colors.clone();
  int opcode;
  byte[] fields;
  if(model.startsWith("T8L02")){
   if(EufyLightCommands.isSolidEffect(effect)){
    opcode=EufyLightCommands.OP_COLOR;
    fields=EufyLightCommands.color(model,safe[0],EufyLightCommands.defaultLampCount(model));
   }else{
    opcode=EufyLightCommands.OP_SHOW;
    fields=EufyLightCommands.show(model,effect,safe,speed,reverse);
   }
  }else{
   opcode=EufyLightCommands.OP_COLOR;
   fields=EufyLightCommands.isSolidEffect(effect)
    ?EufyLightCommands.color(model,safe[0],EufyLightCommands.defaultLampCount(model))
    :EufyLightCommands.effectE120(effect,safe,speed,reverse,EufyLightCommands.defaultLampCount(model));
  }
  mqttFrames(lightName,new int[]{opcode},new byte[][]{fields},"EFFECT "+effect,10000);
 }
 void mqttScene(String lightName,String effect,int[] colors,int speed,boolean reverse,int brightness)throws Exception{
  String model=spec(lightName).model;
  int[] safe=colors==null||colors.length==0?new int[]{0xFFFFFF}:colors.clone();
  int effectOpcode;
  byte[] effectFields;
  if(model.startsWith("T8L02")){
   if(EufyLightCommands.isSolidEffect(effect)){
    effectOpcode=EufyLightCommands.OP_COLOR;
    effectFields=EufyLightCommands.color(model,safe[0],EufyLightCommands.defaultLampCount(model));
   }else{
    effectOpcode=EufyLightCommands.OP_SHOW;
    effectFields=EufyLightCommands.show(model,effect,safe,speed,reverse);
   }
  }else{
   effectOpcode=EufyLightCommands.OP_COLOR;
   effectFields=EufyLightCommands.isSolidEffect(effect)
    ?EufyLightCommands.color(model,safe[0],EufyLightCommands.defaultLampCount(model))
    :EufyLightCommands.effectE120(effect,safe,speed,reverse,EufyLightCommands.defaultLampCount(model));
  }
  mqttFrames(lightName,
   new int[]{EufyLightCommands.OP_SETUP,EufyLightCommands.OP_SETUP,effectOpcode},
   new byte[][]{new byte[]{(byte)0xA3,1,1},EufyLightCommands.brightness(Math.max(1,Math.min(100,brightness))),effectFields},
   "SCENE "+effect,12000);
 }
 private void mqttFrames(String lightName,int[] opcodes,byte[][] fields,String label,long responseWait)throws Exception{
  requireTarget(lightName);if(creds==null)throw new IOException("Get lighting certificate first.");h.check();
  if((opcodes==null)!=(fields==null)||opcodes!=null&&opcodes.length!=fields.length)throw new IOException("Invalid cloud command frame set");
  String host=creds.getString("endpoint_addr");int port=creds.optInt("endpoint_port",8883);if(!allowedBroker(host)||port<1||port>65535)throw new IOException("Invalid broker endpoint");
  Network network=h.network();if(network==null)throw new IOException("No active network");
  Socket raw=new Socket();h.track(raw);try{network.bindSocket(raw);raw.connect(new InetSocketAddress(network.getAllByName(host)[0],port),12000);SSLSocket ssl=(SSLSocket)context().getSocketFactory().createSocket(raw,host,port,true);h.track(ssl);
   try{ssl.setSoTimeout(12000);SSLParameters p=ssl.getSSLParameters();p.setEndpointIdentificationAlgorithm("HTTPS");ssl.setSSLParameters(p);ssl.startHandshake();h.log(selectedSpec.name+": broker TLS ready.");InputStream in=ssl.getInputStream();OutputStream out=ssl.getOutputStream();
    String sn=selected.optString("device_sn");String snTail=sn.length()>4?sn.substring(sn.length()-4):sn;String clientId="android-eufy_life-"+creds.optString("user_id",uid)+"-"+md5(installId).substring(0,16)+"-"+snTail+"-"+(System.currentTimeMillis()%100000);ByteArrayOutputStream b=new ByteArrayOutputStream();DataOutputStream d=new DataOutputStream(b);utf(d,"MQTT");d.writeByte(4);d.writeByte(2);d.writeShort(45);utf(d,clientId);packet(out,0x10,b.toByteArray());Packet response=read(in);if(response.type()!=2||response.data.length!=2)throw new IOException("Invalid MQTT CONNACK");int rc=response.data[1]&255;if(rc!=0)throw new IOException("MQTT CONNACK refused with code "+rc+(rc==2?" (client identifier rejected)":""));
    b.reset();d=new DataOutputStream(b);d.writeShort(1);String[] requested=topics();for(String topic:requested){utf(d,topic);d.writeByte(1);}packet(out,0x82,b.toByteArray());long deadline=System.currentTimeMillis()+15000;boolean subscribed=false;while(System.currentTimeMillis()<deadline){h.check();response=read(in);if(response.type()==9){if(response.data.length!=6||response.data[0]!=0||response.data[1]!=1)throw new IOException("Malformed subscription acknowledgment");int granted=0;for(int i=0;i<4;i++){int q=response.data[i+2]&255;if(q!=128&&q<=2)granted++;}if(granted==0)throw new IOException("All subscriptions denied");if(opcodes!=null&&(response.data[2]&255)==128)throw new IOException(selectedSpec.name+" state topic denied; writes blocked.");subscribed=true;break;}handle(response,out);}
    if(!subscribed)throw new IOException("No MQTT SUBACK received");
    if(opcodes!=null){
     for(int i=0;i<opcodes.length;i++){
      long ts=System.currentTimeMillis()/1000;
      byte[] frame=dpCommand(opcodes[i],account(),fields[i],ts);
      JSONObject inner=new JSONObject().put("account_id",account()).put("device_sn",selected.optString("device_sn")).put("data",Base64.getEncoder().encodeToString(frame)).put("trans","");
      JSONObject head=new JSONObject().put("version","1.0.0.1").put("client_id",clientId).put("sess_id","0000").put("msg_seq",i+1).put("seed","").put("timestamp",ts).put("cmd_status",1).put("cmd",17).put("sign_code",0);
      byte[] payload=bytes(new JSONObject().put("head",head).put("payload",inner.toString()).toString());
      h.check();b.reset();d=new DataOutputStream(b);utf(d,"cmd/eufy_life/"+selectedSpec.model+"/"+selected.optString("device_sn")+"/req");d.writeShort(2+i);d.write(payload);packet(out,0x32,b.toByteArray());
      if(i+1<opcodes.length)Thread.sleep(180);
     }
     h.log(selectedSpec.name+" "+label+" published over Wi-Fi.");
    }
    long until=System.currentTimeMillis()+responseWait;while(System.currentTimeMillis()<until){h.check();ssl.setSoTimeout(800);int first;try{first=in.read();}catch(SocketTimeoutException e){continue;}ssl.setSoTimeout(12000);response=readAfterHeader(first,in);handle(response,out);}
    packet(out,0xe0,new byte[0]);
   }finally{h.untrack(ssl);ssl.close();}
  }finally{h.untrack(raw);raw.close();}
 }
 void handle(Packet p,OutputStream out)throws Exception{
  if(p.type()==4)return;
  if(p.type()!=3)return;DataInputStream d=new DataInputStream(new ByteArrayInputStream(p.data));int n=d.readUnsignedShort();if(n>d.available())throw new IOException("Bad MQTT topic length");byte[] t=new byte[n];d.readFully(t);String topic=new String(t,StandardCharsets.UTF_8);String[] parts=topic.split("/");boolean ours=parts.length>=5&&parts[1].equals("eufy_life")&&parts[2].equals(selectedSpec.model)&&parts[3].equals(selected.optString("device_sn"));int qos=(p.header>>1)&3;if(qos==1){int packetId=d.readUnsignedShort();packet(out,0x40,new byte[]{(byte)(packetId>>8),(byte)packetId});}else if(qos!=0)throw new IOException("Unexpected MQTT QoS");byte[] body=new byte[d.available()];d.readFully(body);if(!ours)return;
  try{JSONObject envelope=new JSONObject(new String(body,StandardCharsets.UTF_8));Object payload=envelope.opt("payload");JSONObject outer=payload instanceof String?new JSONObject((String)payload):(JSONObject)payload;if(outer==null)return;String sn=outer.optString("sn",outer.optString("device_sn",selected.optString("device_sn")));if(!selected.optString("device_sn").equals(sn))return;String nested=new String(Base64.getDecoder().decode(outer.getString("data")),StandardCharsets.UTF_8);String frameHex=new JSONObject(nested).getString("data");byte[] frame=unhex(frameHex);if(frame.length<10||frame[0]!=(byte)0xff||frame[1]!=9||((frame[2]&255)|((frame[3]&255)<<8))!=frame.length)return;int x=0;for(byte v:frame)x^=v&255;if(x!=0)return;int cmd=((frame[7]&255)<<8)|(frame[8]&255);int start=(cmd>>8)==10?10:9;if(cmd!=0x0a00&&cmd!=0x0204)return;for(int i=start;i+1<frame.length-1;){int tag=frame[i]&255,len=frame[i+1]&255;i+=2;if(i+len>frame.length-1)return;if((tag==0xa1||tag==0xa2)&&len>0&&len<=4){long value=0;for(int k=0;k<len;k++)value|=(long)(frame[i+k]&255)<<(8*k);h.log(tag==0xa1?selectedSpec.name+" reported power: "+(value==0?"OFF":"ON"):selectedSpec.name+" reported brightness: "+value);}i+=len;}
  }catch(JSONException|IllegalArgumentException ignored){}
 }
}

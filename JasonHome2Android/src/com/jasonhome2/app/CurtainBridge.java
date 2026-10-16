package com.jasonhome2.app;
import android.app.Activity;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.content.ContentValues;
import android.os.Environment;
import android.provider.MediaStore;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
/** Oracle transport and local file export only. This class never opens Android Bluetooth. */
public final class CurtainBridge {
 public static final int PERMISSIONS_REQUEST=74;
 private static final String[] NANO_BASES={"http://jason-home-2.local","http://192.168.68.116"};
 private final Activity activity;private final WebView web;
 public CurtainBridge(Activity activity,WebView web){this.activity=activity;this.web=web;}
 @JavascriptInterface public boolean localControllerAvailable(){return true;}
 @JavascriptInterface public void call(String id,String action,String payload){
  activity.runOnUiThread(()->{try{
   requireOracleOrigin();
   if(id==null||id.length()>48)throw new IllegalArgumentException("Invalid request");
   JSONObject json=new JSONObject(payload==null?"{}":payload);
   if("saveRawFile".equals(action)){save(id,json);return;}
   if("openNanoController".equals(action)||"pairNano".equals(action)){localController(id,action,json);return;}
   String script="(async()=>{try{if(!window.JH2OracleCurtainCall)throw Error('Reload Jason Home 2 to enable the Oracle curtain relay');const r=await window.JH2OracleCurtainCall("+JSONObject.quote(action)+","+json.toString()+");window.__curtainNativeResult("+JSONObject.quote(id)+",r);}catch(e){window.__curtainNativeResult("+JSONObject.quote(id)+",{ok:false,error:e.message});}})();";
   web.evaluateJavascript(script,null);
  }catch(Throwable t){finish(id,false,t.getMessage());}});
 }
 private void requireOracleOrigin(){
   Uri origin=Uri.parse(web.getUrl()==null?"":web.getUrl());
   if(!"https".equals(origin.getScheme())||!"150.136.245.51".equals(origin.getHost())||origin.getPath()==null||!origin.getPath().startsWith("/jason-home-2/"))throw new IllegalArgumentException("Unexpected page origin");
 }
 private void localController(String id,String action,JSONObject json){
   new Thread(()->{try{
     String base=findNano();
     if("pairNano".equals(action)){
       JSONObject result=request(base,"/api/bridge/pair","POST",json.toString().getBytes(StandardCharsets.UTF_8));
       if(!result.optBoolean("ok",false))throw new IllegalStateException(result.optString("error","NanoC6 rejected pairing"));
       finish(id,true,"NanoC6 paired directly over the home network.");
     }else{
       activity.runOnUiThread(()->{try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(base+"/")));finish(id,true,"Opened NanoC6 controller.");}catch(Throwable t){finish(id,false,"Could not open the NanoC6 controller: "+t.getMessage());}});
     }
   }catch(Throwable t){finish(id,false,"NanoC6 is not reachable on the home Wi-Fi. "+String.valueOf(t.getMessage()));}},"jh2-local-nano").start();
 }
 private String findNano()throws Exception{
   Exception last=null;
   for(String base:NANO_BASES)try{JSONObject health=request(base,"/api/health","GET",null);if(health.optBoolean("ok",false)&&health.optString("product","").startsWith("Jason Home 2"))return base;}catch(Exception e){last=e;}
   throw new IllegalStateException(last==null?"Connect this phone to the home Wi-Fi.":last.getMessage());
 }
 private JSONObject request(String base,String path,String method,byte[] body)throws Exception{
   HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();
   c.setConnectTimeout(2500);c.setReadTimeout(5000);c.setInstanceFollowRedirects(false);c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");
   if(body!=null){if(body.length>8192)throw new IllegalArgumentException("Pairing configuration is too large");c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json; charset=utf-8");try(OutputStream out=c.getOutputStream()){out.write(body);}}
   int status=c.getResponseCode();InputStream stream=status>=200&&status<300?c.getInputStream():c.getErrorStream();ByteArrayOutputStream out=new ByteArrayOutputStream();
   if(stream!=null)try(InputStream in=stream){byte[] buf=new byte[1024];int n,total=0;while((n=in.read(buf))>0){total+=n;if(total>8192)throw new IllegalStateException("NanoC6 response is too large");out.write(buf,0,n);}}
   String text=out.toString(StandardCharsets.UTF_8.name());c.disconnect();if(status<200||status>=300)throw new IllegalStateException("controller returned HTTP "+status);return new JSONObject(text);
 }
 private void save(String id,JSONObject json)throws Exception{
            String name=json.optString("name","curtain-effect.eff").replaceAll("[^a-zA-Z0-9._-]","_");
            if(name.length()>90)name=name.substring(name.length()-90);
            String mime=json.optString("mime","application/octet-stream");
            if(!mime.equals("text/plain")&&!mime.equals("application/octet-stream")&&!mime.equals("image/png")
               &&!mime.equals("image/gif"))mime="application/octet-stream";
            byte[] data=Base64.decode(json.optString("data",""),Base64.DEFAULT);
            if(data.length==0||data.length>10_000_000)throw new IllegalArgumentException("Export must be 1 byte–10 MB");
            if(Build.VERSION.SDK_INT>=29){
                ContentValues values=new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);
                values.put(MediaStore.MediaColumns.MIME_TYPE,mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/JasonHome2");
                Uri uri=activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);
                if(uri==null)throw new IllegalStateException("Android Downloads unavailable");
                try(OutputStream out=activity.getContentResolver().openOutputStream(uri)){
                    if(out==null)throw new IllegalStateException("Cannot write Downloads file");
                    out.write(data);
                }
            }else{
                File dir=activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if(dir==null)throw new IllegalStateException("Android Downloads unavailable");
                if(!dir.exists()&&!dir.mkdirs())throw new IllegalStateException("Cannot create download directory");
                try(OutputStream out=new FileOutputStream(new File(dir,name))){out.write(data);}
            }

 finish(id,true,"Saved "+name+" to Downloads / JasonHome2");
 }
 private void finish(String id,boolean ok,String message){activity.runOnUiThread(()->{try{if(web==null)return;JSONObject result=new JSONObject();result.put("ok",ok);result.put(ok?"message":"error",message);web.evaluateJavascript("window.__curtainNativeResult&&window.__curtainNativeResult("+JSONObject.quote(id)+","+result+");",null);}catch(Exception ignored){}});}
 public void onPermissionsResult(int code,String[] permissions,int[] grants){}
 public void close(){}
}

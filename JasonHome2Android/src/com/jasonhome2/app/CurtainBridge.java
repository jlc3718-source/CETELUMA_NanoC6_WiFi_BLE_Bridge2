package com.jasonhome2.app;
import android.app.Activity;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import android.content.ContentValues;
import android.os.Environment;
import android.provider.MediaStore;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import org.json.JSONObject;
/** Oracle transport and local file export only. This class never opens Android Bluetooth. */
public final class CurtainBridge {
 public static final int PERMISSIONS_REQUEST=74;
 private final Activity activity;private final WebView web;
 public CurtainBridge(Activity activity,WebView web){this.activity=activity;this.web=web;}
 @JavascriptInterface public void call(String id,String action,String payload){
  activity.runOnUiThread(()->{try{
   Uri origin=Uri.parse(web.getUrl()==null?"":web.getUrl());
   if(!"https".equals(origin.getScheme())||!"150.136.245.51".equals(origin.getHost())||!origin.getPath().startsWith("/jason-home-2/"))throw new IllegalArgumentException("Unexpected page origin");
   if(id==null||id.length()>48)throw new IllegalArgumentException("Invalid request");
   JSONObject json=new JSONObject(payload==null?"{}":payload);
   if("saveRawFile".equals(action)){save(id,json);return;}
   String script="(async()=>{try{if(!window.JH2OracleCurtainCall)throw Error('Reload Jason Home 2 to enable the Oracle curtain relay');const r=await window.JH2OracleCurtainCall("+JSONObject.quote(action)+","+json.toString()+");window.__curtainNativeResult("+JSONObject.quote(id)+",r);}catch(e){window.__curtainNativeResult("+JSONObject.quote(id)+",{ok:false,error:e.message});}})();";
   web.evaluateJavascript(script,null);
  }catch(Throwable t){finish(id,false,t.getMessage());}});
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
 private void finish(String id,boolean ok,String message){try{JSONObject result=new JSONObject();result.put("ok",ok);result.put(ok?"message":"error",message);web.evaluateJavascript("window.__curtainNativeResult&&window.__curtainNativeResult("+JSONObject.quote(id)+","+result+");",null);}catch(Exception ignored){}}
 public void onPermissionsResult(int code,String[] permissions,int[] grants){}
 public void close(){}
}

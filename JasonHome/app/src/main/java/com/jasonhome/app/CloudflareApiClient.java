package com.jasonhome.app;

import android.content.Context;
import org.json.JSONObject;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

final class CloudflareApiClient {
    static final class Result {
        final int status; final String body;
        Result(int status,String body){this.status=status;this.body=body==null?"":body;}
    }
    private final CloudflareConfigStore store;
    CloudflareApiClient(Context context){store=new CloudflareConfigStore(context);}
    CloudflareConfigStore store(){return store;}
    boolean isCloudMode(){return store.isCloudMode();}
    boolean configured(){return store.hasToken();}
    Result health()throws Exception{return requestRaw("GET","/api/health","",false);}
    Result request(String method,String path,String body)throws Exception{
        if(!configured())throw new IOException("Oracle API token is not configured");
        return requestRaw(method,path,body,true);
    }
    private Result requestRaw(String method,String path,String body,boolean auth)throws Exception{
        if(path==null||!path.startsWith("/api/"))throw new IOException("Invalid Oracle API path");
        URL url=new URL(CloudflareConfigStore.ENDPOINT+path);
        HttpsURLConnection c=(HttpsURLConnection)url.openConnection();
        try{
            c.setInstanceFollowRedirects(false);c.setConnectTimeout(10000);c.setReadTimeout(25000);
            c.setRequestMethod(method==null?"GET":method.toUpperCase(java.util.Locale.ROOT));
            c.setRequestProperty("Accept","application/json");
            if(auth)c.setRequestProperty("Authorization","Bearer "+store.token());
            if(body!=null&&!body.isEmpty()&&!"GET".equalsIgnoreCase(method)){
                byte[] data=body.getBytes(StandardCharsets.UTF_8);c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");
                c.setFixedLengthStreamingMode(data.length);try(OutputStream out=c.getOutputStream()){out.write(data);}
            }
            int status=c.getResponseCode();InputStream in=status>=400?c.getErrorStream():c.getInputStream();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(in!=null)try(InputStream s=in){byte[] buf=new byte[4096];int n;while((n=s.read(buf))!=-1){bytes.write(buf,0,n);if(bytes.size()>2*1024*1024)throw new IOException("Oracle response too large");}}
            return new Result(status,bytes.toString("UTF-8"));
        }finally{c.disconnect();}
    }
    JSONObject configJson()throws Exception{
        JSONObject o=new JSONObject();o.put("endpoint",CloudflareConfigStore.ENDPOINT).put("mode",isCloudMode()?"cloud":"direct").put("configured",configured());return o;
    }
}

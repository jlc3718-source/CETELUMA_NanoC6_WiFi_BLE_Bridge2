package com.jasonhome.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import org.json.JSONObject;
import java.io.Closeable;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.*;
import java.util.concurrent.*;

/**
 * Production transport wrapper for the four known Eufy light strings.
 * Bluetooth is not used by this class. Commands go through the validated
 * Eufy cloud API + mutual-TLS MQTT path.
 */
final class EufyCloudController {
    interface Listener {
        void onCloudStatus(String message);
        void onCloudLoginRequired(String reason);
        default void onCloudCommandResult(boolean complete,String message){}
    }

    private static final String[] NAMES={"Pool","House","Garage","Shed"};
    private final Context context;
    private final Listener listener;
    private final CloudSessionStore store;
    private final ExecutorService control=Executors.newSingleThreadExecutor();
    private final ExecutorService mqttPool=Executors.newFixedThreadPool(4);
    private final Set<Closeable> tracked=Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final Set<String> readyNames=Collections.newSetFromMap(new ConcurrentHashMap<>());
    private final String installId;

    private volatile CloudClient client;
    private volatile boolean ready=false;
    private volatile boolean busy=false;
    private volatile boolean closed=false;
    private volatile String status="Wi-Fi cloud starting";

    EufyCloudController(Context context,Listener listener){
        this.context=context.getApplicationContext();
        this.listener=listener;
        this.store=new CloudSessionStore(this.context);
        SharedPreferences p=this.context.getSharedPreferences("jason_home_cloud_install",Context.MODE_PRIVATE);
        String id=p.getString("install_id","");
        if(id.isEmpty()){
            id=UUID.randomUUID().toString().replace("-","");
            p.edit().putString("install_id",id).apply();
        }
        installId=id;
    }

    void start(){queueConnect(false);}
    void refresh(){ready=false;queueConnect(false);}

    boolean isReady(){return ready;}
    boolean isBusy(){return busy;}
    int readyCount(){return readyNames.size();}
    boolean isDeviceReady(String name){return readyNames.contains(name);}
    String status(){return status;}
    String installId(){return installId;}
    boolean hasRememberedSignIn(){return store.hasSavedAuth();}

    void login(String email,String password){
        if(email==null||email.trim().isEmpty()||password==null||password.isEmpty()){
            requireLogin("Enter your Eufy email and password once. Jason Home will remember it securely.");
            return;
        }
        submit(()->{
            setStatus("Signing in to Eufy cloud…");
            CloudClient c=newClient();
            c.login(email.trim(),password,"","");
            if(!c.authed){
                if(c.twoFactor)throw new IOException("Eufy requested an email verification code. Use the Wi-Fi test sign-in once, then retry this build.");
                if(!c.captchaId.isEmpty())throw new IOException("Eufy requested a captcha. Complete sign-in again when prompted.");
                throw new IOException("Eufy sign-in did not complete.");
            }
            client=c;
            store.saveCredentials(email.trim(),password);
            store.saveSession(c.exportSession());
            prepare(c);
            setStatus("Wi-Fi ready • "+readyNames.size()+"/4 Eufy strings");
        },true);
    }

    void setPower(int target,boolean on){
        submit(()->{
            ensureReady();
            String[] names=target<=0?NAMES:new String[]{NAMES[Math.max(0,Math.min(3,target-1))]};
            setStatus((on?"Turning ON ":"Turning OFF ")+(target<=0?"all four strings":names[0])+" over Wi-Fi…");
            List<Future<String>> futures=new ArrayList<>();
            for(String name:names){
                futures.add(mqttPool.submit(()->{
                    CloudClient fork=forkClient();
                    fork.mqtt(name,on?1:2);
                    return name;
                }));
            }
            int ok=0;StringBuilder failures=new StringBuilder();
            for(Future<String> f:futures){
                try{f.get(35,TimeUnit.SECONDS);ok++;}
                catch(Throwable t){
                    Throwable cause=t instanceof ExecutionException&&t.getCause()!=null?t.getCause():t;
                    if(failures.length()>0)failures.append("; ");
                    failures.append(cause.getMessage()==null?cause.getClass().getSimpleName():cause.getMessage());
                }
            }
            if(ok==0){
                ready=false;
                String fail="No Wi-Fi light command completed"+(failures.length()>0?": "+failures:"");
                if(listener!=null)listener.onCloudCommandResult(false,fail);
                throw new IOException(fail);
            }
            String result=(on?"ON":"OFF")+" sent over Wi-Fi to "+ok+"/"+names.length+" string"+(names.length==1?"":"s")+(failures.length()>0?" • "+failures:"");
            setStatus(result);if(listener!=null)listener.onCloudCommandResult(ok==names.length,result);
        },false);
    }

    void setBrightness(int target,int percent){
        int value=Math.max(0,Math.min(100,percent));
        fanOut(target,"Brightness "+value+"%",fork->fork.mqttBrightness(fork.targetName,value));
    }

    void setEffect(int target,String effect,int[] colors,int speed,boolean reverse){
        int[] safe=colors==null||colors.length==0?new int[]{0xFFFFFF}:colors.clone();
        String fx=effect==null||effect.isEmpty()?"Jump":effect;
        int sp=Math.max(1,Math.min(5,speed));
        fanOut(target,"Effect "+fx,fork->fork.mqttEffect(fork.targetName,fx,safe,sp,reverse));
    }

    void setScene(int target,String effect,int[] colors,int speed,boolean reverse,int brightness){
        int[] safe=colors==null||colors.length==0?new int[]{0xFFFFFF}:colors.clone();
        String fx=effect==null||effect.isEmpty()?"Jump":effect;
        int sp=Math.max(1,Math.min(5,speed));
        int br=Math.max(1,Math.min(100,brightness));
        fanOut(target,"Scene "+fx,fork->fork.mqttScene(fork.targetName,fx,safe,sp,reverse,br));
    }

    private interface ForkAction{void run(TargetFork fork)throws Exception;}
    private static final class TargetFork{
        final CloudClient client; final String targetName;
        TargetFork(CloudClient client,String targetName){this.client=client;this.targetName=targetName;}
        void mqttBrightness(String name,int value)throws Exception{client.mqttBrightness(name,value);}
        void mqttEffect(String name,String effect,int[] colors,int speed,boolean reverse)throws Exception{client.mqttEffect(name,effect,colors,speed,reverse);}
        void mqttScene(String name,String effect,int[] colors,int speed,boolean reverse,int brightness)throws Exception{client.mqttScene(name,effect,colors,speed,reverse,brightness);}
    }

    private void fanOut(int target,String action,ForkAction fn){
        submit(()->{
            ensureReady();
            String[] names=target<=0?NAMES:new String[]{NAMES[Math.max(0,Math.min(3,target-1))]};
            setStatus(action+" • "+(target<=0?"all four strings":names[0])+" over Wi-Fi…");
            List<Future<String>> futures=new ArrayList<>();
            for(String name:names){
                futures.add(mqttPool.submit(()->{
                    TargetFork fork=new TargetFork(forkClient(),name);
                    fn.run(fork);
                    return name;
                }));
            }
            int ok=0;StringBuilder failures=new StringBuilder();
            for(Future<String> future:futures){
                try{future.get(45,TimeUnit.SECONDS);ok++;}
                catch(Throwable t){
                    Throwable cause=t instanceof ExecutionException&&t.getCause()!=null?t.getCause():t;
                    if(failures.length()>0)failures.append("; ");
                    failures.append(cause.getMessage()==null?cause.getClass().getSimpleName():cause.getMessage());
                }
            }
            if(ok==0){ready=false;String fail="No Wi-Fi light command completed"+(failures.length()>0?": "+failures:"");if(listener!=null)listener.onCloudCommandResult(false,fail);throw new IOException(fail);}
            String result=action+" sent over Wi-Fi to "+ok+"/"+names.length+" string"+(names.length==1?"":"s")+(failures.length()>0?" • "+failures:"");
            setStatus(result);if(listener!=null)listener.onCloudCommandResult(ok==names.length,result);
        },false);
    }

    void close(){
        closed=true;
        ready=false;
        for(Closeable c:new ArrayList<>(tracked)){try{c.close();}catch(Throwable ignored){}}
        tracked.clear();
        control.shutdownNow();
        mqttPool.shutdownNow();
    }

    private void queueConnect(boolean forceLogin){
        submit(()->{
            if(!forceLogin&&ready)return;
            ensureReady();
            setStatus("Wi-Fi ready • "+readyNames.size()+"/4 Eufy strings");
        },false);
    }

    private void ensureReady()throws Exception{
        if(ready&&client!=null&&client.authed&&client.creds!=null)return;

        JSONObject saved=store.loadSession();
        if(saved!=null){
            CloudClient restored=newClient();
            if(restored.importSession(saved)){
                try{
                    setStatus("Restoring remembered Eufy session…");
                    prepare(restored);
                    client=restored;
                    store.saveSession(restored.exportSession());
                    return;
                }catch(Throwable t){
                    store.clearSession();
                    readyNames.clear();
                    setStatus("Saved Eufy session expired • re-signing in");
                }
            }
        }

        CloudSessionStore.Credentials savedCredentials=store.loadCredentials();
        if(savedCredentials==null){
            requireLogin("One-time Eufy Wi-Fi sign-in required");
            throw new IOException("Eufy sign-in required");
        }

        CloudClient c=newClient();
        setStatus("Signing in automatically with remembered Eufy account…");
        c.login(savedCredentials.email,savedCredentials.password,"","");
        if(!c.authed){
            requireLogin(c.twoFactor?"Eufy verification is required":"Eufy sign-in needs attention");
            throw new IOException("Automatic Eufy sign-in did not complete");
        }
        client=c;
        store.saveSession(c.exportSession());
        prepare(c);
    }

    private void prepare(CloudClient c)throws Exception{
        c.findLights();
        c.certificate();
        readyNames.clear();
        readyNames.addAll(c.lights.keySet());
        ready=!readyNames.isEmpty();
        if(!ready)throw new IOException("No known Eufy light strings were found");
    }

    private CloudClient forkClient()throws Exception{
        CloudClient source=client;
        if(source==null||!source.authed||source.creds==null)throw new IOException("Wi-Fi cloud transport is not ready");
        CloudClient copy=newClient();
        copy.importSession(source.exportSession());
        copy.authed=true;
        copy.lights.putAll(source.lights);
        copy.creds=source.creds;
        return copy;
    }

    private CloudClient newClient(){
        return new CloudClient(new CloudClient.Host(){
            public void log(String s){if(s!=null&&!s.isEmpty())setStatus(s);}
            public void check()throws Exception{if(closed||Thread.currentThread().isInterrupted())throw new InterruptedIOException("Cloud operation stopped");}
            public Network network(){
                ConnectivityManager cm=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);
                return cm==null?null:cm.getActiveNetwork();
            }
            public void track(Closeable c){if(c!=null)tracked.add(c);}
            public void untrack(Closeable c){if(c!=null)tracked.remove(c);}
            public void captcha(String image){if(image!=null&&!image.isEmpty())requireLogin("Eufy captcha verification is required");}
        },installId);
    }

    private void submit(Throwing task,boolean loginAttempt){
        if(closed)return;
        try{
            control.execute(()->{
                busy=true;
                try{task.run();}
                catch(Throwable t){
                    String m=t.getMessage()==null?t.getClass().getSimpleName():t.getMessage();
                    setStatus("Wi-Fi cloud: "+m);
                    if(loginAttempt)requireLogin(m);
                }finally{busy=false;}
            });
        }catch(RejectedExecutionException ignored){}
    }

    private void setStatus(String message){
        status=message==null?"":message;
        if(listener!=null)listener.onCloudStatus(status);
    }

    private void requireLogin(String reason){
        ready=false;
        if(listener!=null)listener.onCloudLoginRequired(reason==null?"Eufy sign-in required":reason);
    }

    private interface Throwing{void run()throws Exception;}
}

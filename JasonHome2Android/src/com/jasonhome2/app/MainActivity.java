package com.jasonhome2.app;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.media.MediaRecorder;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.util.Base64;
import java.io.File;
import java.io.FileInputStream;

/** Jason Home 2 has a separate package and loads the Oracle-hosted interface. */
public final class MainActivity extends Activity {
    private static final String URL = "https://150.136.245.51/jason-home-2/";
    private static final String HOST = "150.136.245.51";
    private static final int REQUEST_RECORD_AUDIO = 41;
    private WebView web;
    private LinearLayout error;
    private boolean loadFailed=false;
    private PermissionRequest pendingAudioRequest;
    private MediaRecorder nativeRecorder;
    private File nativeVoiceFile;
    private final Handler voiceHandler=new Handler(Looper.getMainLooper());
    private long nativeVoiceStartedAt=0L;
    private long nativeVoiceLastSoundAt=0L;
    private boolean nativeVoiceHeard=false;
    private boolean pendingNativeStart=false;
    private Runnable nativeVoiceMonitor;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(6,17,29));
        getWindow().setNavigationBarColor(Color.rgb(6,17,29));
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(6,17,29));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(6,17,29));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setAllowFileAccessFromFileURLs(false);
        web.getSettings().setAllowUniversalAccessFromFileURLs(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.getSettings().setSafeBrowsingEnabled(true);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.addJavascriptInterface(new VoiceBridge(), "AndroidVoice");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    Uri origin=request.getOrigin();
                    boolean trusted=origin!=null && "https".equals(origin.getScheme()) && HOST.equals(origin.getHost());
                    boolean wantsAudio=false;
                    for(String resource:request.getResources()){
                        if(PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)){wantsAudio=true;break;}
                    }
                    if(!trusted || !wantsAudio){request.deny();return;}
                    if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    }else{
                        pendingAudioRequest=request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},REQUEST_RECORD_AUDIO);
                    }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if(pendingAudioRequest==request)pendingAudioRequest=null;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){
                loadFailed=false;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri=request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                        && uri.getPath()!=null && uri.getPath().startsWith("/jason-home-2/")) return false;
                startActivity(new Intent(Intent.ACTION_VIEW,uri));
                return true;
            }
            @Override public void onPageFinished(WebView view,String url) {
                if(!loadFailed && error!=null)error.setVisibility(View.GONE);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                                   android.webkit.WebResourceError failure) {
                if(request.isForMainFrame() && error!=null){loadFailed=true;error.setVisibility(View.VISIBLE);}
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                                       android.webkit.WebResourceResponse response) {
                if(request.isForMainFrame() && response.getStatusCode()>=500 && error!=null){
                    loadFailed=true;error.setVisibility(View.VISIBLE);
                }
            }
        });
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        error=new LinearLayout(this);
        error.setOrientation(LinearLayout.VERTICAL);
        error.setPadding(36,80,36,36);
        error.setBackgroundColor(Color.rgb(6,17,29));
        TextView message=new TextView(this);
        message.setText("Jason Home 2 cannot reach Oracle right now. The Oracle scheduler continues independently.");
        message.setTextColor(Color.WHITE);
        message.setTextSize(18);
        Button retry=new Button(this);
        retry.setText("Retry connection");
        retry.setOnClickListener(v->{error.setVisibility(View.GONE);web.loadUrl(URL);});
        error.addView(message);
        error.addView(retry);
        error.setVisibility(View.GONE);
        root.addView(error,new FrameLayout.LayoutParams(-1,-1));
        root.setOnApplyWindowInsetsListener((v,insets)->{
            int top,bottom;
            if(android.os.Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                top=bars.top;bottom=bars.bottom;
            }else{
                top=insets.getSystemWindowInsetTop();bottom=insets.getSystemWindowInsetBottom();
            }
            web.setPadding(0,top,0,bottom);
            error.setPadding(36,80+top,36,36+bottom);
            return insets;
        });
        setContentView(root);
        root.requestApplyInsets();
        web.loadUrl(URL);
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grantResults) {
        super.onRequestPermissionsResult(requestCode,permissions,grantResults);
        if(requestCode!=REQUEST_RECORD_AUDIO)return;
        boolean granted=grantResults.length>0 && grantResults[0]==PackageManager.PERMISSION_GRANTED;
        if(pendingAudioRequest!=null){
            PermissionRequest request=pendingAudioRequest;
            pendingAudioRequest=null;
            if(granted)request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else request.deny();
        }
        if(pendingNativeStart){
            pendingNativeStart=false;
            if(granted)startNativeVoiceRecorder();
            else notifyVoiceError("Microphone permission was denied. Allow Microphone for Jason Home 2 in Android settings.");
        }
    }
    private final class VoiceBridge {
        @JavascriptInterface public boolean available(){return true;}
        @JavascriptInterface public void start(){
            runOnUiThread(() -> {
                if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
                    pendingNativeStart=true;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},REQUEST_RECORD_AUDIO);
                    return;
                }
                startNativeVoiceRecorder();
            });
        }
        @JavascriptInterface public void stop(){runOnUiThread(() -> stopNativeVoiceRecorder(false));}
    }

    private void startNativeVoiceRecorder(){
        stopNativeVoiceRecorder(false);
        try{
            nativeVoiceFile=new File(getCacheDir(),"ai-voice-turn.m4a");
            if(nativeVoiceFile.exists())nativeVoiceFile.delete();
            nativeRecorder=new MediaRecorder();
            nativeRecorder.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            nativeRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            nativeRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            nativeRecorder.setAudioSamplingRate(16000);
            nativeRecorder.setAudioEncodingBitRate(64000);
            nativeRecorder.setOutputFile(nativeVoiceFile.getAbsolutePath());
            nativeRecorder.prepare();
            nativeRecorder.start();
            nativeVoiceStartedAt=System.currentTimeMillis();
            nativeVoiceLastSoundAt=nativeVoiceStartedAt;
            nativeVoiceHeard=false;
            notifyVoiceListening();
            nativeVoiceMonitor=new Runnable(){
                @Override public void run(){
                    if(nativeRecorder==null)return;
                    long now=System.currentTimeMillis();
                    int amp=0;
                    try{amp=nativeRecorder.getMaxAmplitude();}catch(Throwable ignored){}
                    if(amp>1200){nativeVoiceHeard=true;nativeVoiceLastSoundAt=now;}
                    long elapsed=now-nativeVoiceStartedAt;
                    if((nativeVoiceHeard && now-nativeVoiceLastSoundAt>1200 && elapsed>1300) || elapsed>30000){
                        stopNativeVoiceRecorder(true);
                        return;
                    }
                    if(!nativeVoiceHeard && elapsed>12000){
                        stopNativeVoiceRecorder(true);
                        return;
                    }
                    voiceHandler.postDelayed(this,140);
                }
            };
            voiceHandler.postDelayed(nativeVoiceMonitor,140);
        }catch(Throwable e){
            stopNativeVoiceRecorder(false);
            notifyVoiceError("Could not start microphone: "+e.getMessage());
        }
    }

    private void stopNativeVoiceRecorder(boolean deliver){
        if(nativeVoiceMonitor!=null)voiceHandler.removeCallbacks(nativeVoiceMonitor);
        nativeVoiceMonitor=null;
        MediaRecorder recorder=nativeRecorder;
        nativeRecorder=null;
        if(recorder!=null){
            try{recorder.stop();}catch(Throwable ignored){}
            try{recorder.release();}catch(Throwable ignored){}
        }
        if(!deliver)return;
        if(!nativeVoiceHeard || nativeVoiceFile==null || !nativeVoiceFile.exists() || nativeVoiceFile.length()<800){
            notifyVoiceNoSpeech();
            return;
        }
        try(FileInputStream in=new FileInputStream(nativeVoiceFile)){
            byte[] bytes=new byte[(int)Math.min(nativeVoiceFile.length(),5_000_000L)];
            int off=0,n;
            while(off<bytes.length && (n=in.read(bytes,off,bytes.length-off))>0)off+=n;
            String audio=Base64.encodeToString(off==bytes.length?bytes:java.util.Arrays.copyOf(bytes,off),Base64.NO_WRAP);
            String quoted=orgJsonQuote(audio);
            web.evaluateJavascript("window.__androidVoiceCaptured&&window.__androidVoiceCaptured("+quoted+",\"audio/mp4\");",null);
        }catch(Throwable e){
            notifyVoiceError("Could not read microphone recording: "+e.getMessage());
        }finally{
            try{nativeVoiceFile.delete();}catch(Throwable ignored){}
        }
    }

    private void notifyVoiceListening(){
        if(web!=null)web.evaluateJavascript("window.__androidVoiceListening&&window.__androidVoiceListening();",null);
    }
    private void notifyVoiceNoSpeech(){
        if(web!=null)web.evaluateJavascript("window.__androidVoiceNoSpeech&&window.__androidVoiceNoSpeech();",null);
    }
    private void notifyVoiceError(String message){
        if(web!=null)web.evaluateJavascript("window.__androidVoiceError&&window.__androidVoiceError("+orgJsonQuote(message)+");",null);
    }
    private static String orgJsonQuote(String value){
        if(value==null)return "\"\"";
        StringBuilder b=new StringBuilder("\"");
        for(int i=0;i<value.length();i++){
            char c=value.charAt(i);
            switch(c){
                case '\\':b.append("\\\\");break;
                case '\"':b.append("\\\"");break;
                case '\n':b.append("\\n");break;
                case '\r':b.append("\\r");break;
                case '\t':b.append("\\t");break;
                default:if(c<32)b.append(String.format(java.util.Locale.ROOT,"\\u%04x",(int)c));else b.append(c);
            }
        }
        return b.append('\"').toString();
    }

    @Override public void onBackPressed() {
        if(error!=null && error.getVisibility()==View.VISIBLE){error.setVisibility(View.GONE);web.loadUrl(URL);}
        else if(web!=null && web.canGoBack())web.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy(){
        stopNativeVoiceRecorder(false);
        if(web!=null){web.removeJavascriptInterface("AndroidVoice");web.destroy();web=null;}
        super.onDestroy();
    }
}

package com.jasonhome2.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Jason Home 2 has a separate package and loads the Oracle-hosted interface. */
public final class MainActivity extends Activity {
    private static final String URL = "https://150.136.245.51/jason-home-2/";
    private static final String HOST = "150.136.245.51";
    private WebView web;
    private LinearLayout error;
    private boolean loadFailed=false;

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
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setWebChromeClient(new WebChromeClient());
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
    @Override public void onBackPressed() {
        if(error!=null && error.getVisibility()==View.VISIBLE){error.setVisibility(View.GONE);web.loadUrl(URL);}
        else if(web!=null && web.canGoBack())web.goBack();
        else super.onBackPressed();
    }
    @Override protected void onDestroy(){
        if(web!=null){web.destroy();web=null;}
        super.onDestroy();
    }
}

package com.jasonhome.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public class MainActivity extends Activity implements AndersonApiBridge.Host, EufyCloudController.Listener {
    private WebView webView;
    private DeviceStore deviceStore;
    private AndersonSchedule schedule;
    private EufyCloudController cloud;
    private CloudflareApiClient cloudflare;
    private AndersonApiBridge bridge;
    private volatile boolean cloudLoginShowing=false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        getWindow().setStatusBarColor(Color.rgb(4,13,29));
        getWindow().setNavigationBarColor(Color.rgb(4,13,29));

        deviceStore = new DeviceStore(this);
        schedule = new AndersonSchedule(this);
        cloud = new EufyCloudController(this, this);
        cloudflare = new CloudflareApiClient(this);
        bridge = new AndersonApiBridge(this, this, deviceStore, cloud, cloudflare, schedule);

        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(4,13,29));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(4,13,29));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(bridge, "AndroidAnderson");

        frame.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));

        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = 0, bottom = 0;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            webView.setPadding(0, top, 0, bottom);
            return insets;
        });

        setContentView(frame);
        frame.requestApplyInsets();
        webView.loadUrl("file:///android_asset/anderson_home.html");

        // Oracle mode leaves Eufy transport and schedules to the server.
        // Direct mode preserves the known-good 5.2.2 Android -> Eufy fallback.
        if (!cloudflare.isCloudMode()) cloud.start();
        else bridge.syncCalendarToOracleAsync();
        AndersonScheduleService.update(this);
    }

    @Override
    public void runOnUi(Runnable action) {
        runOnUiThread(action);
    }

    @Override
    public void onCloudStatus(String message) {
        if (bridge != null) bridge.updateCloudStatus(message);
        onBridgeStatus(message);
    }

    @Override
    public void onCloudLoginRequired(String reason) {
        if (bridge != null && bridge.usesDirectMode()) runOnUiThread(() -> showCloudLogin(reason));
    }

    private void showCloudLogin(String reason) {
        if (isFinishing() || cloudLoginShowing) return;
        cloudLoginShowing=true;

        int pad=(int)(18*getResources().getDisplayMetrics().density);
        LinearLayout box=new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad,pad/2,pad,pad/2);

        TextView note=new TextView(this);
        note.setText((reason==null||reason.isEmpty()?"One-time Eufy Wi-Fi sign-in required":reason)
            +"\n\nAfter a successful sign-in, Jason Home stores the session and credentials encrypted in this app's private storage and signs in automatically on future launches.");
        note.setTextSize(14);
        box.addView(note);

        EditText email=new EditText(this);
        email.setHint("Eufy email");
        email.setSingleLine(true);
        email.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        box.addView(email);

        EditText password=new EditText(this);
        password.setHint("Eufy password");
        password.setSingleLine(true);
        password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(password);

        AlertDialog dialog=new AlertDialog.Builder(this)
            .setTitle("Connect Jason Home to Eufy Wi-Fi")
            .setView(box)
            .setNegativeButton("Not now",(d,w)->{})
            .setPositiveButton("Sign in",null)
            .create();

        dialog.setOnShowListener(x -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String e=email.getText().toString().trim();
            String p=password.getText().toString();
            if(e.isEmpty()){email.setError("Enter your Eufy email");return;}
            if(p.isEmpty()){password.setError("Enter your Eufy password");return;}
            cloud.login(e,p);
            dialog.dismiss();
        }));
        dialog.setOnDismissListener(x -> cloudLoginShowing=false);
        dialog.show();
    }

    @Override
    public void onBridgeStatus(String message) {
        if (webView == null) return;
        runOnUiThread(() -> {
            String safe = JSONObjectQuote.quote(message == null ? "" : message);
            webView.evaluateJavascript(
                "(function(){var e=document.getElementById('statusMsg');if(e)e.textContent=" + safe + ";})();",
                null
            );
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        try { cloud.close(); } catch (Throwable ignored) {}
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidAnderson");
            webView.destroy();
        }
        super.onDestroy();
    }

    /** Minimal JSON string quoting without adding a dependency to the WebView shell. */
    private static final class JSONObjectQuote {
        static String quote(String value) {
            if (value == null) return "\"\"";
            StringBuilder b = new StringBuilder("\"");
            for (int i = 0; i < value.length(); i++) {
                char c = value.charAt(i);
                switch (c) {
                    case '\\': b.append("\\\\"); break;
                    case '\"': b.append("\\\""); break;
                    case '\n': b.append("\\n"); break;
                    case '\r': b.append("\\r"); break;
                    case '\t': b.append("\\t"); break;
                    default:
                        if (c < 32) b.append(String.format(java.util.Locale.ROOT, "\\u%04x", (int)c));
                        else b.append(c);
                }
            }
            return b.append('\"').toString();
        }
    }
}

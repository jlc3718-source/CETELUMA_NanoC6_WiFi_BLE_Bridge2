package com.jasonhome.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity implements BleLightController.Listener, AndersonApiBridge.Host {
    private static final int BLE_PERMISSION_REQUEST = 71;

    private WebView webView;
    private DeviceStore deviceStore;
    private AndersonSchedule schedule;
    private BleLightController ble;
    private AndersonApiBridge bridge;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        getWindow().setStatusBarColor(Color.rgb(4,13,29));
        getWindow().setNavigationBarColor(Color.rgb(4,13,29));

        deviceStore = new DeviceStore(this);
        schedule = new AndersonSchedule(this);
        ble = new BleLightController(this, deviceStore, this);
        bridge = new AndersonApiBridge(this, this, deviceStore, ble, schedule);

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

        requestBlePermissions(false);
    }

    @Override
    public void runOnUi(Runnable action) {
        runOnUiThread(action);
    }

    @Override
    public void requestBlePermissionsAndScan() {
        runOnUiThread(() -> requestBlePermissions(true));
    }

    private void requestBlePermissions(boolean scanAfter) {
        ArrayList<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.BLUETOOTH_SCAN);
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
                needed.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }

        getPreferences(MODE_PRIVATE).edit().putBoolean("scan_after_permission", scanAfter).apply();
        if (needed.isEmpty()) {
            if (scanAfter) startScanSafely();
        } else {
            requestPermissions(needed.toArray(new String[0]), BLE_PERMISSION_REQUEST);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != BLE_PERMISSION_REQUEST) return;
        for (int r : results) {
            if (r != PackageManager.PERMISSION_GRANTED) {
                onBridgeStatus("Bluetooth permission is required to control the Eufy lights.");
                return;
            }
        }
        boolean scan = getPreferences(MODE_PRIVATE).getBoolean("scan_after_permission", false);
        if (scan) startScanSafely();
    }

    private void startScanSafely() {
        try {
            ble.startScan();
        } catch (SecurityException e) {
            onBridgeStatus("Bluetooth permission is required.");
        } catch (Throwable t) {
            onBridgeStatus("Bluetooth scan could not start: " + t.getMessage());
        }
    }

    @Override
    public void onScanChanged(List<BleLightController.FoundLight> items) {
        bridge.updateDiscovered(items);
    }

    @Override
    public void onStatus(String message) {
        bridge.updateBleStatus(message);
        onBridgeStatus(message);
    }

    @Override
    public void onProgress(int done, int total) {
        // The Anderson UI already displays current state; BLE progress is surfaced through status text.
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
        try { ble.close(); } catch (Throwable ignored) {}
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

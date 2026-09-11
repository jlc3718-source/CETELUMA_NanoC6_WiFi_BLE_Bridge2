package com.jlc3718.silveradostreambrowser;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.graphics.Color;
import android.media.MediaDrm;
import android.media.UnsupportedSchemeException;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String HOME_URL = "file:///android_asset/home.html";
    private static final String PREFS = "silverado_browser";
    private static final String PREF_MODE = "compat_mode";
    private static final UUID WIDEVINE_UUID = UUID.fromString("edef8ba9-79d6-4ace-a3c8-27dcd51d21ed");
    private static final String[] MODE_LABELS = {"Native WebView", "Chrome Android", "Chrome Desktop"};

    private FrameLayout root;
    private LinearLayout browserLayout;
    private WebView webView;
    private EditText address;
    private TextView status;
    private Spinner modeSpinner;
    private SharedPreferences prefs;
    private String defaultUserAgent;
    private boolean selectingMode;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        buildUi();
        configureWebView();

        int savedMode = clampMode(prefs.getInt(PREF_MODE, 0));
        selectingMode = true;
        modeSpinner.setSelection(savedMode, false);
        selectingMode = false;
        applyCompatibilityMode(savedMode, false);

        String initial = initialUrlFromIntent(getIntent());
        if (state == null) {
            loadUrl(initial == null ? HOME_URL : initial);
        } else {
            webView.restoreState(state);
        }
    }

    private void buildUi() {
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(6, 16, 29));
        browserLayout = new LinearLayout(this);
        browserLayout.setOrientation(LinearLayout.VERTICAL);
        browserLayout.setBackgroundColor(Color.rgb(6, 16, 29));

        LinearLayout addressRow = new LinearLayout(this);
        addressRow.setOrientation(LinearLayout.HORIZONTAL);
        addressRow.setGravity(Gravity.CENTER_VERTICAL);
        addressRow.setPadding(dp(8), dp(6), dp(8), dp(3));

        address = new EditText(this);
        address.setSingleLine(true);
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.rgb(130, 156, 181));
        address.setHint("Search or enter website URL");
        address.setTextSize(15);
        address.setBackgroundColor(Color.rgb(16, 37, 60));
        address.setPadding(dp(12), 0, dp(12), 0);
        LinearLayout.LayoutParams addressParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
        addressRow.addView(address, addressParams);

        Button go = button("Go");
        go.setOnClickListener(v -> navigateFromAddress());
        addressRow.addView(go, buttonParams());

        Button reload = button("Reload");
        reload.setOnClickListener(v -> webView.reload());
        addressRow.addView(reload, buttonParams());

        LinearLayout navRow = new LinearLayout(this);
        navRow.setOrientation(LinearLayout.HORIZONTAL);
        navRow.setGravity(Gravity.CENTER_VERTICAL);
        navRow.setPadding(dp(8), dp(3), dp(8), dp(6));

        Button back = button("Back");
        back.setOnClickListener(v -> { if (webView.canGoBack()) webView.goBack(); });
        navRow.addView(back, buttonParams());

        Button forward = button("Forward");
        forward.setOnClickListener(v -> { if (webView.canGoForward()) webView.goForward(); });
        navRow.addView(forward, buttonParams());

        Button home = button("Home");
        home.setOnClickListener(v -> loadUrl(HOME_URL));
        navRow.addView(home, buttonParams());

        modeSpinner = new Spinner(this, Spinner.MODE_DROPDOWN);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, MODE_LABELS);
        modeSpinner.setAdapter(adapter);
        LinearLayout.LayoutParams spinnerParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
        spinnerParams.setMargins(dp(5), 0, dp(5), 0);
        navRow.addView(modeSpinner, spinnerParams);

        Button diagnostics = button("Diagnostics");
        diagnostics.setOnClickListener(v -> showDiagnostics());
        navRow.addView(diagnostics, new LinearLayout.LayoutParams(dp(132), dp(48)));

        modeSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(android.widget.AdapterView<?> parent, View view, int position, long id) {
                if (selectingMode || webView == null) return;
                int mode = clampMode(position);
                if (prefs.getInt(PREF_MODE, 0) != mode) {
                    prefs.edit().putInt(PREF_MODE, mode).apply();
                    applyCompatibilityMode(mode, true);
                }
            }
            @Override public void onNothingSelected(android.widget.AdapterView<?> parent) { }
        });

        webView = new WebView(this);
        status = new TextView(this);
        status.setTextColor(Color.rgb(153, 190, 222));
        status.setTextSize(12);
        status.setPadding(dp(10), dp(4), dp(10), dp(7));
        status.setText("Ready");

        browserLayout.addView(addressRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        browserLayout.addView(navRow, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        browserLayout.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        browserLayout.addView(status, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(browserLayout, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        defaultUserAgent = WebSettings.getDefaultUserAgent(this);
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (android.os.Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme) || "file".equalsIgnoreCase(scheme)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    toast("No app can open this link.");
                }
                return true;
            }

            @Override public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                CookieManager.getInstance().flush();
                address.setText(displayUrl(url));
                status.setText("Loaded • " + MODE_LABELS[clampMode(prefs.getInt(PREF_MODE, 0))]);
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    status.setText("Page error " + error.getErrorCode() + " • " + error.getDescription());
                }
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) status.setText("HTTP " + response.getStatusCode() + " • " + request.getUrl().getHost());
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    Uri origin = request.getOrigin();
                    if (origin == null || !"https".equalsIgnoreCase(origin.getScheme())) {
                        request.deny();
                        return;
                    }
                    List<String> allowed = new ArrayList<>();
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(resource)) allowed.add(resource);
                    }
                    if (allowed.isEmpty()) request.deny();
                    else request.grant(allowed.toArray(new String[0]));
                });
            }

            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                browserLayout.setVisibility(View.GONE);
                root.addView(customView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            }

            @Override public void onHideCustomView() {
                hideCustomView();
            }
        });
    }

    private void applyCompatibilityMode(int mode, boolean reload) {
        mode = clampMode(mode);
        String ua;
        if (mode == 1) ua = chromeAndroidUserAgent(defaultUserAgent);
        else if (mode == 2) ua = chromeDesktopUserAgent(defaultUserAgent);
        else ua = defaultUserAgent;
        webView.getSettings().setUserAgentString(ua);
        status.setText("Compatibility mode: " + MODE_LABELS[mode]);
        if (reload && webView.getUrl() != null) webView.reload();
    }

    private String chromeAndroidUserAgent(String base) {
        if (base == null || base.isEmpty()) return "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
        return base.replace("; wv)", ")").replace(" Version/4.0", "");
    }

    private String chromeDesktopUserAgent(String base) {
        String version = "140.0.0.0";
        if (base != null) {
            Matcher m = Pattern.compile("Chrome/([0-9.]+)").matcher(base);
            if (m.find()) version = m.group(1);
        }
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + version + " Safari/537.36";
    }

    private void showDiagnostics() {
        String javaReport = buildJavaDiagnostics();
        String js = "(function(){try{return JSON.stringify({href:location.href,ua:navigator.userAgent,cookieEnabled:navigator.cookieEnabled,eme:(typeof navigator.requestMediaKeySystemAccess==='function'),secureContext:window.isSecureContext});}catch(e){return JSON.stringify({error:String(e)});}})();";
        webView.evaluateJavascript(js, raw -> {
            String pageReport = decodeJsResult(raw);
            showDiagnosticsDialog(javaReport + "\n\nPAGE / EME PROBE\n" + pageReport);
        });
    }

    private String buildJavaDiagnostics() {
        StringBuilder out = new StringBuilder();
        out.append("SILVERADO STREAM BROWSER v1.0.2\n\n");
        out.append("Engine: Android WebView (Chromium provider)\n");
        try {
            PackageInfo p = WebView.getCurrentWebViewPackage();
            if (p != null) out.append("Provider: ").append(p.packageName).append("\nProvider version: ").append(p.versionName).append("\n");
            else out.append("Provider: unavailable\n");
        } catch (Throwable t) {
            out.append("Provider: query failed\n");
        }

        int mode = clampMode(prefs.getInt(PREF_MODE, 0));
        out.append("Mode: ").append(MODE_LABELS[mode]).append("\n");
        out.append("Effective UA: ").append(webView.getSettings().getUserAgentString()).append("\n");
        out.append("Cookies accepted: ").append(CookieManager.getInstance().acceptCookie()).append("\n");

        String netflixCookies = CookieManager.getInstance().getCookie("https://www.netflix.com/");
        int cookieCount = 0;
        boolean sessionMarker = false;
        if (netflixCookies != null && !netflixCookies.trim().isEmpty()) {
            String[] entries = netflixCookies.split(";");
            cookieCount = entries.length;
            for (String entry : entries) {
                String name = entry.trim().split("=", 2)[0];
                if ("NetflixId".equalsIgnoreCase(name) || "SecureNetflixId".equalsIgnoreCase(name) || "nfvdid".equalsIgnoreCase(name)) sessionMarker = true;
            }
        }
        out.append("Netflix cookie count: ").append(cookieCount).append("\n");
        out.append("Netflix session markers present: ").append(sessionMarker).append("\n");

        boolean supported = MediaDrm.isCryptoSchemeSupported(WIDEVINE_UUID);
        out.append("Widevine scheme supported: ").append(supported).append("\n");
        if (supported) {
            try {
                MediaDrm drm = new MediaDrm(WIDEVINE_UUID);
                out.append("Widevine vendor: ").append(safeDrmProperty(drm, "vendor")).append("\n");
                out.append("Widevine version: ").append(safeDrmProperty(drm, "version")).append("\n");
                out.append("Widevine security level: ").append(safeDrmProperty(drm, "securityLevel")).append("\n");
                out.append("Widevine system ID: ").append(safeDrmProperty(drm, "systemId")).append("\n");
                drm.close();
            } catch (UnsupportedSchemeException | RuntimeException e) {
                out.append("Widevine open: failed (" + e.getClass().getSimpleName() + ")\n");
            }
        }
        return out.toString();
    }

    private String safeDrmProperty(MediaDrm drm, String name) {
        try {
            String value = drm.getPropertyString(name);
            return value == null || value.isEmpty() ? "unknown" : value;
        } catch (Throwable t) {
            return "unavailable";
        }
    }

    private void showDiagnosticsDialog(String report) {
        TextView text = new TextView(this);
        text.setText(report);
        text.setTextColor(Color.WHITE);
        text.setTextSize(13);
        text.setPadding(dp(18), dp(14), dp(18), dp(14));
        text.setTextIsSelectable(true);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.rgb(8, 22, 37));
        scroll.addView(text);
        new AlertDialog.Builder(this)
                .setTitle("Browser / DRM Diagnostics")
                .setView(scroll)
                .setPositiveButton("Close", null)
                .show();
    }

    private String decodeJsResult(String raw) {
        if (raw == null || "null".equals(raw)) return "No JavaScript result.";
        try {
            return new JSONArray("[" + raw + "]").getString(0);
        } catch (Exception ignored) {
            return raw;
        }
    }

    private void navigateFromAddress() {
        String value = address.getText().toString().trim();
        if (value.isEmpty()) return;
        if (!value.contains("://")) {
            if (value.contains(" ") || !value.contains(".")) value = "https://www.google.com/search?q=" + Uri.encode(value);
            else value = "https://" + value;
        }
        loadUrl(value);
    }

    private void loadUrl(String url) {
        address.setText(displayUrl(url));
        webView.loadUrl(url);
    }

    private String initialUrlFromIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return null;
        Uri uri = intent.getData();
        String scheme = uri.getScheme();
        if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) return uri.toString();
        return null;
    }

    private String displayUrl(String url) {
        return HOME_URL.equals(url) ? "Silverado Stream Browser Home" : (url == null ? "" : url);
    }

    private int clampMode(int mode) {
        return Math.max(0, Math.min(MODE_LABELS.length - 1, mode));
    }

    private Button button(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(12);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(Color.rgb(20, 58, 92));
        return b;
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(dp(88), dp(48));
        p.setMargins(dp(5), 0, 0, 0);
        return p;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private void hideCustomView() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        browserLayout.setVisibility(View.VISIBLE);
        if (customViewCallback != null) customViewCallback.onCustomViewHidden();
        customViewCallback = null;
    }

    @Override
    public void onBackPressed() {
        if (customView != null) hideCustomView();
        else if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String url = initialUrlFromIntent(intent);
        if (url != null) loadUrl(url);
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        CookieManager.getInstance().flush();
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }
}

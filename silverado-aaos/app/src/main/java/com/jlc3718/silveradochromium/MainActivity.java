package com.jlc3718.silveradochromium;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;

public class MainActivity extends Activity {
    private static final String HOME_URL = "https://www.netflix.com/";
    private static GeckoRuntime runtime;

    private GeckoSession session;
    private GeckoView geckoView;
    private EditText address;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(8, 8, 8, 8);
        bar.setBackgroundColor(Color.rgb(24, 24, 24));

        Button back = makeButton("‹");
        Button forward = makeButton("›");
        Button reload = makeButton("↻");
        Button netflix = makeButton("N");

        address = new EditText(this);
        address.setSingleLine(true);
        address.setText(HOME_URL);
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.LTGRAY);
        address.setBackgroundColor(Color.rgb(48, 48, 48));
        address.setPadding(14, 8, 14, 8);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);

        bar.addView(back, new LinearLayout.LayoutParams(dp(56), dp(48)));
        bar.addView(forward, new LinearLayout.LayoutParams(dp(56), dp(48)));
        bar.addView(reload, new LinearLayout.LayoutParams(dp(56), dp(48)));
        bar.addView(netflix, new LinearLayout.LayoutParams(dp(56), dp(48)));
        LinearLayout.LayoutParams addressParams = new LinearLayout.LayoutParams(0, dp(48), 1f);
        addressParams.setMargins(8, 0, 0, 0);
        bar.addView(address, addressParams);

        geckoView = new GeckoView(this);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(geckoView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        if (runtime == null) {
            runtime = GeckoRuntime.create(this);
        }

        GeckoSessionSettings settings = new GeckoSessionSettings.Builder()
                .userAgentMode(GeckoSessionSettings.USER_AGENT_MODE_DESKTOP)
                .viewportMode(GeckoSessionSettings.VIEWPORT_MODE_DESKTOP)
                .useTrackingProtection(false)
                .suspendMediaWhenInactive(false)
                .build();

        session = new GeckoSession(settings);
        session.setContentDelegate(new GeckoSession.ContentDelegate() {});
        session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
            @Override
            public GeckoResult<Integer> onContentPermissionRequest(
                    GeckoSession requestingSession,
                    GeckoSession.PermissionDelegate.ContentPermission permission) {
                switch (permission.permission) {
                    case GeckoSession.PermissionDelegate.PERMISSION_MEDIA_KEY_SYSTEM_ACCESS:
                    case GeckoSession.PermissionDelegate.PERMISSION_PERSISTENT_STORAGE:
                    case GeckoSession.PermissionDelegate.PERMISSION_STORAGE_ACCESS:
                    case GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_AUDIBLE:
                    case GeckoSession.PermissionDelegate.PERMISSION_AUTOPLAY_INAUDIBLE:
                        return GeckoResult.fromValue(
                                GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW);
                    default:
                        return GeckoResult.fromValue(
                                GeckoSession.PermissionDelegate.ContentPermission.VALUE_DENY);
                }
            }
        });

        session.open(runtime);
        geckoView.setSession(session);

        back.setOnClickListener(v -> session.goBack());
        forward.setOnClickListener(v -> session.goForward());
        reload.setOnClickListener(v -> session.reload());
        netflix.setOnClickListener(v -> load(HOME_URL));

        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                    (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                load(address.getText().toString());
                return true;
            }
            return false;
        });

        load(HOME_URL);
    }

    private Button makeButton(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(22f);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackgroundColor(Color.rgb(42, 42, 42));
        return b;
    }

    private void load(String raw) {
        String url = raw == null ? "" : raw.trim();
        if (url.isEmpty()) {
            url = HOME_URL;
        } else if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("about:")) {
            url = "https://" + url;
        }
        address.setText(url);
        session.loadUri(url);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (session != null) {
            session.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

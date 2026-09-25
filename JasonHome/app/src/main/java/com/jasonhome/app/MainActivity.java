package com.jasonhome.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity implements BleLightController.Listener {
    private static final int NAVY = Color.rgb(6, 13, 28);
    private static final int PANEL = Color.rgb(12, 25, 50);
    private static final int PANEL2 = Color.rgb(17, 30, 54);
    private static final int ACCENT = Color.rgb(69, 121, 240);
    private static final int LIGHT = Color.rgb(218, 229, 248);
    private static final int INK = Color.rgb(22, 43, 79);
    private static final int MUTED = Color.rgb(151, 171, 207);

    private LinearLayout root;
    private TextView statusView;
    private TextView progressView;
    private BleLightController ble;
    private DeviceStore store;
    private List<BleLightController.FoundLight> found = new ArrayList<>();
    private String page = "Home";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(NAVY);
        getWindow().setNavigationBarColor(NAVY);
        store = new DeviceStore(this);
        ble = new BleLightController(this, store, this);
        buildShell();
        requestBlePermissions();
    }

    private void buildShell() {
        statusView = null;
        progressView = null;
        FrameLayout frame = new FrameLayout(this);
        frame.setBackgroundColor(NAVY);

        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(10), dp(20), dp(98));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(root, new FrameLayout.LayoutParams(-1, -2));
        frame.addView(scroll, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setGravity(Gravity.CENTER);
        nav.setPadding(dp(6), dp(6), dp(6), dp(6));
        nav.setBackground(round(PANEL2, 20, Color.argb(70, 189, 213, 255)));
        String[][] tabs = {{"Home","⌂"}, {"Devices","◉"}, {"Scenes","✦"}, {"Settings","⚙"}};
        for (String[] tab : tabs) nav.addView(navButton(tab[0], tab[1]), new LinearLayout.LayoutParams(0, -1, 1f));
        FrameLayout.LayoutParams nlp = new FrameLayout.LayoutParams(-1, dp(72), Gravity.BOTTOM);
        nlp.setMargins(dp(15), 0, dp(15), dp(17));
        frame.addView(nav, nlp);
        nav.setElevation(dp(10));

        // Android 15 can draw app content behind the system navigation area.
        // Lift Jason Home's tab bar above whatever navigation mode the phone uses.
        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            int systemBottom = insets.getSystemWindowInsetBottom();
            FrameLayout.LayoutParams navParams = (FrameLayout.LayoutParams) nav.getLayoutParams();
            navParams.leftMargin = dp(15);
            navParams.rightMargin = dp(15);
            navParams.bottomMargin = dp(17) + systemBottom;
            nav.setLayoutParams(navParams);
            root.setPadding(dp(20), dp(10), dp(20), dp(98) + systemBottom);
            return insets;
        });

        setContentView(frame);
        frame.requestApplyInsets();
        renderPage();
    }

    private TextView navButton(String label, String icon) {
        TextView v = text(icon + "\n" + label, 11, page.equals(label) ? INK : MUTED, false);
        v.setGravity(Gravity.CENTER);
        v.setPadding(dp(4), dp(5), dp(4), dp(5));
        if (page.equals(label)) v.setBackground(round(Color.rgb(210, 226, 255), 14, null));
        v.setOnClickListener(x -> {
            page = label;
            buildShell();
        });
        return v;
    }

    private void renderPage() {
        root.removeAllViews();
        header();
        if ("Devices".equals(page)) renderDevices();
        else if ("Scenes".equals(page)) renderScenes();
        else if ("Settings".equals(page)) renderSettings();
        else renderHome();
    }

    private void header() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(14), 0, dp(20));

        TextView mark = text("⌂", 31, Color.rgb(169, 194, 255), false);
        mark.setGravity(Gravity.CENTER);
        row.addView(mark, new LinearLayout.LayoutParams(dp(50), dp(50)));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.addView(text("Jason Home", 20, Color.WHITE, true));
        TextView sub = text("EUFY LIGHTING CONTROL", 9, Color.rgb(143, 164, 201), false);
        sub.setLetterSpacing(.20f);
        brand.addView(sub);
        row.addView(brand, new LinearLayout.LayoutParams(0, -2, 1f));

        int ready = readyLights().size();
        TextView badge = text(ready > 0 ? "● READY" : "● BLE", 10, Color.rgb(189, 210, 248), true);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp(10), dp(6), dp(10), dp(6));
        badge.setBackground(round(Color.rgb(22, 37, 65), 99, Color.argb(50, 121, 153, 199)));
        row.addView(badge);
        root.addView(row);
    }

    private void renderHome() {
        LinearLayout hero = card(PANEL, 28);
        hero.setPadding(dp(24), dp(25), dp(24), dp(24));
        TextView over = text("LIVE LIGHTING", 10, Color.rgb(156, 182, 228), true);
        over.setLetterSpacing(.16f);
        hero.addView(over);
        TextView title = text("Jason\nHome", 52, Color.WHITE, false);
        title.setLineSpacing(0, .90f);
        hero.addView(title);
        TextView tagline = text("Your atmosphere, ready when you are", 13, Color.rgb(177, 198, 233), false);
        tagline.setPadding(0, dp(12), 0, dp(14));
        hero.addView(tagline);
        hero.addView(new HousePreviewView(), new LinearLayout.LayoutParams(-1, dp(185)));
        statusView = text(readyLights().size() + " light" + (readyLights().size() == 1 ? "" : "s") + " ready nearby", 12, Color.rgb(190, 211, 244), false);
        statusView.setGravity(Gravity.CENTER);
        statusView.setPadding(0, dp(8), 0, dp(4));
        hero.addView(statusView);
        root.addView(hero);

        LinearLayout master = card(LIGHT, 24);
        master.setPadding(dp(22), dp(22), dp(22), dp(22));
        TextView kicker = text("MASTER CONTROL", 9, Color.rgb(87, 113, 154), true);
        kicker.setLetterSpacing(.16f);
        master.addView(kicker);
        TextView atmosphere = text("Your atmosphere.", 29, INK, false);
        atmosphere.setPadding(0, dp(5), 0, dp(18));
        master.addView(atmosphere);

        LinearLayout dial = new LinearLayout(this);
        dial.setOrientation(LinearLayout.VERTICAL);
        dial.setGravity(Gravity.CENTER);
        dial.setBackground(round(Color.rgb(237, 243, 255), 100, Color.argb(50, 54, 108, 222)));
        dial.addView(text("POWER", 9, Color.rgb(97, 117, 153), true));
        dial.addView(text(readyLights().isEmpty() ? "—" : "READY", 43, INK, false));
        master.addView(dial, new LinearLayout.LayoutParams(-1, dp(145)));

        LinearLayout power = new LinearLayout(this);
        power.setOrientation(LinearLayout.HORIZONTAL);
        power.setPadding(0, dp(16), 0, 0);
        Button on = powerButton("TURN ON", true);
        Button off = powerButton("TURN OFF", false);
        LinearLayout.LayoutParams a = new LinearLayout.LayoutParams(0, dp(62), 1f);
        a.setMarginEnd(dp(5));
        LinearLayout.LayoutParams b = new LinearLayout.LayoutParams(0, dp(62), 1f);
        b.setMarginStart(dp(5));
        power.addView(on, a);
        power.addView(off, b);
        master.addView(power);
        TextView note = text("Sequential control: connect → handshake → command → disconnect → next light.", 11, Color.rgb(85, 105, 140), false);
        note.setPadding(0, dp(14), 0, 0);
        master.addView(note);
        root.addView(master, topMargin(16));

        LinearLayout op = card(PANEL2, 18);
        op.setPadding(dp(18), dp(17), dp(18), dp(17));
        op.addView(text("CONTROL STATUS", 9, Color.rgb(142, 169, 211), true));
        progressView = text("Idle", 14, Color.WHITE, true);
        progressView.setPadding(0, dp(8), 0, 0);
        op.addView(progressView);
        TextView info = text("E120 power uses the recovered encrypted 0x0201/A3 path. E22 uses the same session path; color/effects remain gated for later testing.", 11, MUTED, false);
        info.setPadding(0, dp(7), 0, 0);
        op.addView(info);
        root.addView(op, topMargin(16));
    }

    private Button powerButton(String label, boolean on) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setTextSize(13);
        button.setBackground(round(on ? ACCENT : Color.rgb(83, 107, 140), 14, null));
        button.setOnClickListener(v -> ble.setPower(readyLights(), on));
        return button;
    }

    private void renderDevices() {
        pageTitle("LIGHTS", "Nearby Eufy devices");
        Button scan = new Button(this);
        scan.setText("SCAN FOR LIGHTS");
        scan.setAllCaps(false);
        scan.setTextColor(Color.WHITE);
        scan.setBackground(round(ACCENT, 12, null));
        scan.setOnClickListener(v -> startScanWithPermissions());
        root.addView(scan, new LinearLayout.LayoutParams(-1, dp(52)));
        statusView = text("BLE scanning stays broad; only Eufy candidates are displayed.", 12, MUTED, false);
        statusView.setPadding(0, dp(12), 0, 0);
        root.addView(statusView);
        progressView = text(found.size() + " shown", 11, Color.rgb(166, 191, 231), true);
        progressView.setPadding(0, dp(8), 0, dp(5));
        root.addView(progressView);

        if (found.isEmpty()) {
            LinearLayout empty = card(PANEL2, 18);
            empty.setPadding(dp(18), dp(18), dp(18), dp(18));
            empty.addView(text("No scan results yet", 16, Color.WHITE, true));
            TextView t = text("Tap Scan for Lights. E120/T8L00 and E22/T8L02 advertising names are recognized automatically.", 12, MUTED, false);
            t.setPadding(0, dp(7), 0, 0);
            empty.addView(t);
            root.addView(empty, topMargin(12));
            return;
        }

        for (BleLightController.FoundLight item : found) {
            String address = safeAddress(item);
            String serial = store.serialFor(address, item.name);
            LinearLayout box = card(PANEL2, 18);
            box.setPadding(dp(18), dp(16), dp(18), dp(16));
            String title = item.model.isEmpty() ? item.name : item.model + " • " + item.name;
            box.addView(text(title, 17, Color.WHITE, true));
            TextView meta = text(item.rssi + " dBm • " + (serial.length() == 16 ? "READY" : "SERIAL NEEDED"), 11, serial.length() == 16 ? Color.rgb(164, 204, 255) : MUTED, false);
            meta.setPadding(0, dp(4), 0, dp(8));
            box.addView(meta);

            EditText serialInput = new EditText(this);
            serialInput.setText(serial);
            serialInput.setHint("16-character Eufy serial");
            serialInput.setSingleLine(true);
            serialInput.setTextColor(Color.WHITE);
            serialInput.setHintTextColor(Color.rgb(105, 126, 163));
            serialInput.setTextSize(13);
            serialInput.setPadding(dp(12), dp(8), dp(12), dp(8));
            serialInput.setBackground(round(Color.rgb(8, 15, 32), 10, Color.argb(45, 199, 217, 255)));
            box.addView(serialInput, new LinearLayout.LayoutParams(-1, dp(48)));

            Button save = new Button(this);
            save.setText(serial.length() == 16 ? "SERIAL SAVED" : "SAVE SERIAL");
            save.setAllCaps(false);
            save.setTextColor(Color.WHITE);
            save.setBackground(round(Color.rgb(42, 65, 105), 10, null));
            save.setOnClickListener(v -> {
                if (store.setSerial(address, serialInput.getText().toString())) renderPage();
                else statusView.setText("Serial must be exactly 16 printable ASCII characters.");
            });
            LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(-1, dp(45));
            slp.topMargin = dp(7);
            box.addView(save, slp);

            LinearLayout actions = new LinearLayout(this);
            actions.setOrientation(LinearLayout.HORIZONTAL);
            Button on = singlePower(item, "ON", true);
            Button off = singlePower(item, "OFF", false);
            boolean enabled = store.serialFor(address, item.name).length() == 16;
            on.setEnabled(enabled);
            off.setEnabled(enabled);
            LinearLayout.LayoutParams lp1 = new LinearLayout.LayoutParams(0, dp(46), 1f);
            lp1.setMarginEnd(dp(4));
            LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(0, dp(46), 1f);
            lp2.setMarginStart(dp(4));
            actions.addView(on, lp1);
            actions.addView(off, lp2);
            LinearLayout.LayoutParams alp = new LinearLayout.LayoutParams(-1, -2);
            alp.topMargin = dp(8);
            box.addView(actions, alp);
            root.addView(box, topMargin(10));
        }
    }

    private Button singlePower(BleLightController.FoundLight item, String label, boolean on) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setBackground(round(on ? ACCENT : Color.rgb(63, 82, 114), 10, null));
        b.setOnClickListener(v -> {
            ArrayList<BleLightController.FoundLight> one = new ArrayList<>();
            one.add(item);
            ble.setPower(one, on);
        });
        return b;
    }

    private void renderScenes() {
        pageTitle("SCENES", "Anderson-style light building");
        LinearLayout box = card(PANEL2, 18);
        box.setPadding(dp(18), dp(18), dp(18), dp(18));
        box.addView(text("Protocol staging", 18, Color.WHITE, true));
        TextView note = text("The dashboard is prepared for Solid, Jump, Breath and Strobe. Color/effect transmission stays disabled until E120 0x0206/0x020D is byte-exact and physically verified.", 12, MUTED, false);
        note.setPadding(0, dp(8), 0, dp(14));
        box.addView(note);
        String[] names = {"Solid / Static", "Jump", "Breath", "Strobe"};
        for (int i = 0; i < names.length; i += 2) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int j = i; j < Math.min(i + 2, names.length); j++) {
                TextView v = text(names[j], 12, Color.rgb(187, 205, 239), false);
                v.setGravity(Gravity.CENTER);
                v.setBackground(round(Color.rgb(20, 38, 68), 12, Color.argb(45, 199, 220, 255)));
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(66), 1f);
                lp.setMargins(dp(3), dp(3), dp(3), dp(3));
                row.addView(v, lp);
            }
            box.addView(row);
        }
        root.addView(box);
    }

    private void renderSettings() {
        pageTitle("SETTINGS", "Bluetooth & Eufy setup");
        LinearLayout box = card(PANEL2, 18);
        box.setPadding(dp(18), dp(18), dp(18), dp(18));
        box.addView(text("Eufy account ID", 17, Color.WHITE, true));
        TextView explain = text("Stored only in this app's private phone preferences. It is never printed in logs or committed to GitHub.", 11, MUTED, false);
        explain.setPadding(0, dp(5), 0, dp(12));
        box.addView(explain);

        EditText account = new EditText(this);
        account.setText(store.accountId());
        account.setHint("40 hexadecimal characters");
        account.setSingleLine(true);
        account.setTextColor(Color.WHITE);
        account.setHintTextColor(Color.rgb(105, 126, 163));
        account.setTextSize(14);
        account.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        account.setPadding(dp(13), dp(10), dp(13), dp(10));
        account.setBackground(round(Color.rgb(8, 15, 32), 10, Color.argb(50, 199, 217, 255)));
        box.addView(account, new LinearLayout.LayoutParams(-1, dp(52)));

        Button save = new Button(this);
        save.setText("Save on this phone");
        save.setAllCaps(false);
        save.setTextColor(Color.WHITE);
        save.setBackground(round(ACCENT, 11, null));
        save.setOnClickListener(v -> {
            if (store.setAccountId(account.getText().toString())) statusView.setText("Eufy ID saved privately on this phone.");
            else statusView.setText("ID must be exactly 40 hexadecimal characters.");
        });
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(-1, dp(50));
        sp.topMargin = dp(10);
        box.addView(save, sp);
        statusView = text(store.accountId().isEmpty() ? "Account ID is required before light commands can run." : "Account ID is present and kept local.", 11, MUTED, false);
        statusView.setPadding(0, dp(10), 0, 0);
        box.addView(statusView);
        progressView = text("", 1, Color.TRANSPARENT, false);
        box.addView(progressView);
        root.addView(box);

        LinearLayout diag = card(PANEL2, 18);
        diag.setPadding(dp(18), dp(18), dp(18), dp(18));
        diag.addView(text("Protocol status", 17, Color.WHITE, true));
        TextView d = text("✓ E120 encrypted session path recovered\n✓ E120 ON/OFF 0x0201 / A3 implemented\n✓ Sequential multi-light queue implemented\n✓ Four installed E120/E22 serials hard-coded\n○ E120 brightness A4 awaits physical verification\n○ Color/effects 0x0206 and 0x020D remain gated", 12, Color.rgb(183, 202, 234), false);
        d.setPadding(0, dp(8), 0, 0);
        d.setLineSpacing(dp(3), 1f);
        diag.addView(d);
        root.addView(diag, topMargin(12));
    }

    private void pageTitle(String overline, String title) {
        TextView o = text(overline, 9, Color.rgb(142, 171, 219), true);
        o.setLetterSpacing(.20f);
        o.setPadding(0, dp(10), 0, 0);
        root.addView(o);
        TextView t = text(title, 34, Color.WHITE, false);
        t.setPadding(0, dp(8), 0, dp(18));
        root.addView(t);
    }

    private List<BleLightController.FoundLight> readyLights() {
        ArrayList<BleLightController.FoundLight> ready = new ArrayList<>();
        for (BleLightController.FoundLight item : found) {
            if (store.serialFor(safeAddress(item), item.name).length() == 16) ready.add(item);
        }
        return ready;
    }

    private void requestBlePermissions() {
        ArrayList<String> needed = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 31) {
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.BLUETOOTH_SCAN);
            if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) needed.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            needed.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (needed.isEmpty()) startScanWithPermissions();
        else requestPermissions(needed.toArray(new String[0]), 71);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != 71) return;
        for (int r : results) if (r != PackageManager.PERMISSION_GRANTED) {
            if (statusView != null) statusView.setText("Bluetooth permission is required.");
            return;
        }
        startScanWithPermissions();
    }

    private void startScanWithPermissions() {
        try {
            ble.startScan();
        } catch (SecurityException e) {
            if (statusView != null) statusView.setText("Bluetooth permission is required.");
        }
    }

    @Override
    public void onScanChanged(List<BleLightController.FoundLight> items) {
        runOnUiThread(() -> {
            found = new ArrayList<>(items);
            if ("Home".equals(page) || "Devices".equals(page)) renderPage();
        });
    }

    @Override
    public void onStatus(String message) {
        runOnUiThread(() -> {
            if (statusView != null) statusView.setText(message);
        });
    }

    @Override
    public void onProgress(int done, int total) {
        runOnUiThread(() -> {
            if (progressView != null) progressView.setText(total > 0 ? done + " / " + total + " processed" : "Idle");
        });
    }

    @Override
    protected void onDestroy() {
        ble.close();
        super.onDestroy();
    }

    private LinearLayout card(int color, int radius) {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setBackground(round(color, radius, Color.argb(28, 195, 213, 255)));
        return v;
    }

    private GradientDrawable round(int color, int radius, Integer stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radius));
        if (stroke != null) d.setStroke(dp(1), stroke);
        return d;
    }

    private TextView text(String value, float size, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(size);
        v.setTextColor(color);
        if (bold) v.setTypeface(v.getTypeface(), android.graphics.Typeface.BOLD);
        return v;
    }

    private LinearLayout.LayoutParams topMargin(int top) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(top);
        return lp;
    }

    private int dp(int value) {
        return (int)(value * getResources().getDisplayMetrics().density + .5f);
    }

    private String safeAddress(BleLightController.FoundLight item) {
        try { return item.device.getAddress(); } catch (Throwable t) { return ""; }
    }

    private final class HousePreviewView extends View {
        private final Paint wall = paint(Color.rgb(28, 55, 84), Paint.Style.FILL);
        private final Paint roof = paint(Color.rgb(67, 91, 124), Paint.Style.FILL);
        private final Paint line = paint(Color.rgb(152, 184, 232), Paint.Style.STROKE);
        private final Paint glow = paint(Color.rgb(112, 150, 255), Paint.Style.FILL);

        HousePreviewView() {
            super(MainActivity.this);
            line.setStrokeWidth(dp(1));
            line.setAlpha(150);
        }

        @Override
        protected void onDraw(Canvas c) {
            super.onDraw(c);
            float w = getWidth(), h = getHeight();
            glow.setAlpha(28);
            c.drawOval(w * .10f, h * .68f, w * .90f, h * .96f, glow);
            RectF body = new RectF(w * .20f, h * .38f, w * .80f, h * .82f);
            c.drawRoundRect(body, dp(4), dp(4), wall);
            c.drawRoundRect(body, dp(4), dp(4), line);
            Path p = new Path();
            p.moveTo(w * .14f, h * .40f);
            p.lineTo(w * .50f, h * .10f);
            p.lineTo(w * .86f, h * .40f);
            p.close();
            c.drawPath(p, roof);
            c.drawPath(p, line);
            Paint led = paint(Color.rgb(183, 207, 255), Paint.Style.FILL);
            for (int i = 0; i <= 12; i++) {
                float x = w * .18f + i * (w * .64f / 12f);
                c.drawCircle(x, h * .43f, dp(2), led);
            }
            c.drawRect(w * .43f, h * .55f, w * .57f, h * .82f, line);
            c.drawRect(w * .26f, h * .55f, w * .36f, h * .67f, line);
            c.drawRect(w * .64f, h * .55f, w * .74f, h * .67f, line);
        }

        private Paint paint(int color, Paint.Style style) {
            Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
            p.setColor(color);
            p.setStyle(style);
            return p;
        }
    }
}

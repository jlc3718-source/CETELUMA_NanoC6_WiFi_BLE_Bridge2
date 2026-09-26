package com.jasonhome.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Durable Anderson scheduler runner. The service exists only while automatic
 * schedules are enabled. It keeps the exact Anderson calendar logic alive when
 * the WebView/activity is closed and sends scenes through the same Eufy BLE
 * controller used by manual control.
 */
public final class AndersonScheduleService extends Service implements BleLightController.Listener {
    private static final String CHANNEL = "jason_home_schedule";
    private static final int NOTIFICATION_ID = 5042;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private DeviceStore store;
    private AndersonSchedule schedule;
    private BleLightController ble;
    private android.content.SharedPreferences appPrefs;
    private String lastSceneKey = "";
    private String lastStatus = "Schedule ready";

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            try { evaluate(); }
            catch (Throwable t) { lastStatus = "Schedule error: " + t.getMessage(); updateNotification(); }
            handler.postDelayed(this, 30000L);
        }
    };

    static void update(Context context) {
        AndersonSchedule schedule = new AndersonSchedule(context);
        Intent intent = new Intent(context, AndersonScheduleService.class);
        if (schedule.enabled()) {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } else {
            context.stopService(intent);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        store = new DeviceStore(this);
        schedule = new AndersonSchedule(this);
        appPrefs = getSharedPreferences("anderson_android", MODE_PRIVATE);
        ble = new BleLightController(this, store, this);
        createChannel();
        startForeground(NOTIFICATION_ID, notification());
        handler.post(tick);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!schedule.enabled()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.removeCallbacks(tick);
        handler.post(tick);
        return START_STICKY;
    }

    private void evaluate() {
        if (!schedule.enabled()) {
            stopSelf();
            return;
        }
        if (appPrefs.getBoolean("manual_override", false)) {
            lastStatus = "Manual override active";
            updateNotification();
            return;
        }
        if (!hasBlePermission()) {
            lastStatus = "Bluetooth permission required";
            updateNotification();
            return;
        }
        if (ble.isBusy()) return;

        AndersonSchedule.Scene scene = schedule.resolveNow();
        String key;
        if (scene == null) key = "OFF";
        else key = scene.eventIndex + "|" + scene.effect + "|" + Arrays.toString(scene.colors) + "|" + scene.speed + "|" + scene.brightness + "|" + scene.schedule2;
        if (key.equals(lastSceneKey)) return;

        List<BleLightController.FoundLight> targets = installedLights();
        if (targets.isEmpty()) return;
        lastSceneKey = key;
        if (scene == null) {
            lastStatus = "Scheduled OFF";
            ble.setPower(targets, false);
        } else {
            lastStatus = scene.name + (scene.schedule2 ? " • Schedule 2" : " • Schedule 1");
            ble.setScene(targets, scene.effect, scene.colors, scene.speed, false, scene.brightness);
        }
        updateNotification();
    }

    @SuppressLint("MissingPermission")
    private List<BleLightController.FoundLight> installedLights() {
        ArrayList<BleLightController.FoundLight> out = new ArrayList<>();
        BluetoothManager bm = (BluetoothManager)getSystemService(BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = bm == null ? null : bm.getAdapter();
        if (adapter == null) return out;
        String[] addresses = DeviceStore.installedAddresses();
        for (String address : addresses) {
            try {
                BluetoothDevice d = adapter.getRemoteDevice(address);
                String serial = store.serialFor(address, "");
                String model = serial.startsWith("T8L00") ? "E120" : serial.startsWith("T8L02") ? "E22" : "Eufy";
                String name = DeviceStore.friendlyNameFor(address, model);
                out.add(new BleLightController.FoundLight(d, name, -100, model, serial));
            } catch (Throwable ignored) {}
        }
        return out;
    }

    private boolean hasBlePermission() {
        if (Build.VERSION.SDK_INT < 31) return true;
        return checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            && checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
    }

    @Override public void onScanChanged(List<BleLightController.FoundLight> items) {}

    @Override
    public void onStatus(String message) {
        lastStatus = message == null ? "Schedule active" : message;
        updateNotification();
    }

    @Override
    public void onProgress(int done, int total) {
        if (total > 0 && done >= total) updateNotification();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "Jason Home schedules", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Keeps Anderson Home lighting schedules active in the background.");
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
        }
    }

    private Notification notification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL)
            : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_menu_my_calendar)
         .setContentTitle("Jason Home schedule")
         .setContentText(lastStatus)
         .setOngoing(true)
         .setShowWhen(false);
        return b.build();
    }

    private void updateNotification() {
        try {
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification());
        } catch (Throwable ignored) {}
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        try { ble.close(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}

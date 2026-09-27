package com.jasonhome.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.util.Arrays;

/**
 * Durable Anderson scheduler runner for Craumer Home Wi-Fi mode.
 * Bluetooth is intentionally inactive. Schedule windows still drive power
 * through the same Eufy cloud MQTT transport used by manual control.
 */
public final class AndersonScheduleService extends Service implements EufyCloudController.Listener {
    private static final String CHANNEL = "jason_home_schedule";
    private static final int NOTIFICATION_ID = 5042;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private AndersonSchedule schedule;
    private EufyCloudController cloud;
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
            try {
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
                else context.startService(intent);
            } catch (Throwable ignored) {
                // Android can temporarily reject a background FGS launch.
                // The next app launch / schedule save / boot receiver retries.
            }
        } else {
            try { context.stopService(intent); } catch (Throwable ignored) {}
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        schedule = new AndersonSchedule(this);
        appPrefs = getSharedPreferences("anderson_android", MODE_PRIVATE);
        cloud = new EufyCloudController(this, this);
        createChannel();
        startForeground(NOTIFICATION_ID, notification());
        cloud.start();
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
        if (!cloud.isReady()) {
            lastSceneKey = "";
            lastStatus = cloud.status();
            cloud.start();
            updateNotification();
            return;
        }
        if (cloud.isBusy()) return;

        AndersonSchedule.Scene scene = schedule.resolveNow();
        String key;
        if (scene == null) key = "OFF";
        else key = scene.eventIndex + "|" + scene.effect + "|" + Arrays.toString(scene.colors) + "|" + scene.speed + "|" + scene.brightness + "|" + scene.schedule2;
        if (key.equals(lastSceneKey)) return;

        lastSceneKey = key;
        if (scene == null) {
            lastStatus = "Scheduled OFF • Wi-Fi";
            cloud.setPower(0, false);
        } else {
            lastStatus = scene.name + (scene.schedule2 ? " • Schedule 2" : " • Schedule 1") + " • Wi-Fi power";
            cloud.setPower(0, true);
        }
        updateNotification();
    }

    @Override
    public void onCloudStatus(String message) {
        lastStatus = message == null || message.isEmpty() ? "Schedule active • Wi-Fi" : message;
        updateNotification();
    }

    @Override
    public void onCloudLoginRequired(String reason) {
        lastSceneKey = "";
        lastStatus = reason == null ? "Open Jason Home once to sign in to Eufy" : reason;
        updateNotification();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel(CHANNEL, "Jason Home schedules", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("Keeps Craumer Home lighting schedules active in the background over Wi-Fi.");
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
        try { cloud.close(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}

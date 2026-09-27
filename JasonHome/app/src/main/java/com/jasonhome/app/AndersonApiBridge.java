package com.jasonhome.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Native Android implementation of the Anderson Home HTTP API contract.
 * The Anderson 3.1.58 web UI runs unchanged in a WebView and calls this bridge
 * instead of an ESP32 web server. Hardware writes are delegated to the proven
 * Jason Home Eufy E10 BLE transport.
 */
final class AndersonApiBridge {
    interface Host {
        void runOnUi(Runnable action);
        void onBridgeStatus(String message);
        void onBridgeResponse(String requestId, String responseJson);
    }

    private static final String[] ADDRESSES = {
        "10:2C:B1:0E:C4:01",
        "10:2C:B1:AD:CA:7F",
        "10:2C:B1:9D:F7:B5",
        "10:2C:B1:EB:27:96"
    };
    private static final String[] NAMES = {"Pool","House","Garage","Shed"};
    private static final String[] MODELS = {"E120","E120","E22","E22"};

    private final Context context;
    private final Host host;
    private final DeviceStore deviceStore;
    private final EufyCloudController cloud;
    private final CloudflareApiClient cloudApi;
    private final AndersonSchedule schedule;
    private final SharedPreferences prefs;
    private volatile String cloudStatus = "Wi-Fi cloud starting";
    private JSONObject cloudSnapshotCache;
    private long cloudSnapshotAt=0L;
    private volatile boolean cloudIdentityProvisioned=false;

    AndersonApiBridge(Context context, Host host, DeviceStore deviceStore,
                      EufyCloudController cloud, CloudflareApiClient cloudApi, AndersonSchedule schedule) {
        this.context = context.getApplicationContext();
        this.host = host;
        this.deviceStore = deviceStore;
        this.cloud = cloud;
        this.cloudApi = cloudApi;
        this.schedule = schedule;
        this.prefs = this.context.getSharedPreferences("anderson_android", Context.MODE_PRIVATE);
        ensureDefaults();
    }

    void updateCloudStatus(String message) {
        cloudStatus = message == null ? "" : message;
    }

    boolean usesDirectMode() {
        return !cloudApi.isCloudMode();
    }

    private String forwardCloud(String method, String path, String body) throws Exception {
        CloudflareApiClient.Result r=cloudApi.request(method,path,body==null?"":body);
        return response(r.status,r.body);
    }

    private synchronized void provisionCloudIdentity() throws Exception {
        if(cloudIdentityProvisioned)return;
        if(!cloudApi.configured())throw new IOException("Oracle API token is not configured");
        JSONObject payload=new JSONObject().put("installId",cloud.installId());
        CloudflareApiClient.Result r=cloudApi.request("POST","/api/provision-device",payload.toString());
        if(r.status<200||r.status>=300){
            String msg="Oracle identity provisioning HTTP "+r.status;
            try{msg=new JSONObject(r.body).optString("error",msg);}catch(Throwable ignored){}
            throw new IOException(msg);
        }
        cloudIdentityProvisioned=true;
        invalidateCloudSnapshot();
    }

    private String cloudConfig(JSONObject in, boolean write) throws Exception {
        CloudflareConfigStore store=cloudApi.store();
        if(write){
            if(in.has("token")){
                String token=in.optString("token","").trim();
                if(token.isEmpty())store.clearToken(); else store.saveToken(token);
                cloudIdentityProvisioned=false;
            }
            if(in.has("mode")){
                boolean cloudMode="cloud".equalsIgnoreCase(in.optString("mode","direct"));
                if(cloudMode&&!store.hasToken())return error(400,"Enter the Jason Home Oracle API token before enabling Oracle mode");
                store.setCloudMode(cloudMode);
                AndersonScheduleService.update(context);
                if(!cloudMode)cloud.start();
            }
        }
        if(write&&store.hasToken()){
            provisionCloudIdentity();
            syncCalendarToOracleAsync();
        }
        JSONObject out=cloudApi.configJson();
        out.put("directReady",cloud.isReady()).put("directStatus",cloud.status());
        return ok(out);
    }

    private JSONObject directStatusJson() throws Exception {
        JSONObject o=new JSONObject();
        o.put("ok",true).put("controller","Direct Android").put("architecture","Android → Eufy direct fallback");
        o.put("eufy",new JSONObject().put("ready",cloud.isReady()).put("status",cloud.status()).put("readyNames",directReadyNames()));
        o.put("devices",directDevices());
        LocalDate today=LocalDate.now();
        o.put("astronomy",new JSONObject().put("dawn",displayMinutes(schedule.civilDawnMinutes(today))).put("dusk",displayMinutes(schedule.civilDuskMinutes(today))).put("timeZone","America/New_York"));
        o.put("nextEvent",new JSONObject().put("label",schedule.nextEventLabel()));
        o.put("override",new JSONObject().put("active",prefs.getBoolean("manual_override",false)));
        return o;
    }

    private JSONArray directReadyNames() {
        JSONArray a=new JSONArray();for(String name:NAMES)if(cloud.isDeviceReady(name))a.put(name);return a;
    }

    private JSONArray directDevices() throws Exception {
        JSONArray a=new JSONArray();
        for(int i=0;i<NAMES.length;i++)a.put(new JSONObject().put("name",NAMES[i]).put("model",MODELS[i]).put("enabled",true).put("ready",cloud.isDeviceReady(NAMES[i])));
        return a;
    }

    @JavascriptInterface
    public void requestAsync(String requestId, String method, String url, String body, String token) {
        final String id=requestId==null?"":requestId;
        new Thread(() -> {
            String result;
            try{result=request(method,url,body,token);}
            catch(Throwable t){result=error(500,t.getMessage()==null?t.getClass().getSimpleName():t.getMessage());}
            final String out=result;
            host.onBridgeResponse(id,out);
        },"JasonHomeApi").start();
    }

    @JavascriptInterface
    public String request(String method, String url, String body, String token) {
        try {
            String m = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
            String raw = url == null ? "/" : url;
            Uri uri = Uri.parse(raw.startsWith("http") ? raw : "http://local" + raw);
            String path = uri.getPath() == null ? "/" : uri.getPath();
            JSONObject input = parseBody(body);
            String cloudPath=path+(uri.getEncodedQuery()==null?"":"?"+uri.getEncodedQuery());

            if ("/api/cloud/config".equals(path) && "GET".equals(m)) return cloudConfig(input,false);
            if ("/api/cloud/config".equals(path) && "POST".equals(m)) return cloudConfig(input,true);
            if ("/api/cloud/health".equals(path) && "GET".equals(m)) {
                CloudflareApiClient.Result r=cloudApi.health(); return response(r.status,r.body);
            }
            if ("/api/cloud/test".equals(path) && "GET".equals(m)) {
                if(!cloudApi.configured())return error(400,"Oracle API token is not configured");
                provisionCloudIdentity();
                syncCalendarToOracleAsync();
                return forwardCloud("GET","/api/status?refresh=1","");
            }

            if (cloudApi.isCloudMode()) {
                if ("/api/status".equals(path) || "/api/devices".equals(path) || "/api/schedules".equals(path)
                    || "/api/reconcile".equals(path) || "/api/reconnect".equals(path)
                    || path.startsWith("/api/eufy/factory-")) {
                    return forwardCloud(m,cloudPath,body);
                }
                if ("/api/control".equals(path) && "POST".equals(m)) return cloudControlCompat(input);
                if ("/api/resume".equals(path) && "POST".equals(m)) return cloudResumeCompat();
            } else {
                if (path.startsWith("/api/eufy/factory-"))
                    return error(409,"Factory Lab requires Oracle Internet Controller mode.");
                if ("/api/status".equals(path) && "GET".equals(m)) return ok(directStatusJson());
                if ("/api/devices".equals(path) && "GET".equals(m)) return ok(new JSONObject().put("ok",true).put("devices",directDevices()));
                if ("/api/schedules".equals(path) && "GET".equals(m)) return ok(new JSONObject().put("ok",true).put("schedules",new JSONArray()));
            }


            if ("/api/login-preview".equals(path)) return ok(loginPreview());
            if ("/api/state".equals(path)) return ok(stateJson());
            if ("/api/control".equals(path) && "POST".equals(m)) return control(input);
            if ("/api/resume".equals(path) && "POST".equals(m)) return resume();
            if ("/api/settings".equals(path) && "POST".equals(m)) return saveSettings(input);
            if ("/api/backup/status".equals(path) && "GET".equals(m)) return ok(backupStatus());
            if ("/api/backup/manual".equals(path) && "POST".equals(m)) return backupAll();
            if ("/api/backup/restore".equals(path) && "POST".equals(m)) return restoreBackup();

            if ("/api/events".equals(path)) return ok(eventsJson(intQuery(uri,"year",LocalDate.now().getYear()), intQuery(uri,"month",LocalDate.now().getMonthValue()), null));
            if ("/api/events/search".equals(path)) return ok(eventsJson(intQuery(uri,"year",LocalDate.now().getYear()), 0, uri.getQueryParameter("q")));
            if ("/api/event".equals(path) && "POST".equals(m)) return updateEvent(input);
            if ("/api/event-categories".equals(path) && "GET".equals(m)) return ok(eventCategories());
            if ("/api/event-categories".equals(path) && "POST".equals(m)) return updateEventCategory(input);
            if ("/api/event-color-theme".equals(path) && "GET".equals(m)) return ok(eventColorTheme());
            if ("/api/event-color-theme".equals(path) && "POST".equals(m)) return setEventColorTheme(input);
            if ("/api/favorites".equals(path)) return ok(favorites());

            if ("/api/presets".equals(path) && "GET".equals(m)) return ok(presetsJson());
            if ("/api/preset".equals(path) && "POST".equals(m)) return updatePreset(input);
            if ("/api/custom-schedules".equals(path) && "GET".equals(m)) return ok(customSchedules(uri));
            if ("/api/custom-schedules".equals(path) && "POST".equals(m)) return updateCustomSchedule(input);
            if ("/api/colors".equals(path) && "GET".equals(m)) return ok(colorsJson());
            if ("/api/colors".equals(path) && "POST".equals(m)) return updateColor(input);

            // The visible Eufy device controls retain their historical /api/ble path
            // names, but all transport is Wi-Fi/Oracle; no Android Bluetooth code runs.
            if ("/api/ble/scan".equals(path)) return ok(bleScan());
            if ("/api/ble/target".equals(path) && "POST".equals(m)) return bleTarget(input);


            return ok(new JSONObject().put("ok",true).put("android",true));
        } catch (Throwable t) {
            return error(500, t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
        }
    }

    private synchronized JSONObject cloudStatusSnapshot(boolean refresh) throws Exception {
        long now=System.currentTimeMillis();
        if(!refresh&&cloudSnapshotCache!=null&&now-cloudSnapshotAt<4000L)return new JSONObject(cloudSnapshotCache.toString());
        CloudflareApiClient.Result r=cloudApi.request("GET",refresh?"/api/status?refresh=1":"/api/status","");
        if(r.status<200||r.status>=300)throw new IOException("Oracle status HTTP "+r.status);
        JSONObject o=new JSONObject(r.body);
        if(!o.optBoolean("ok",false))throw new IOException(o.optString("error","Oracle status failed"));
        cloudSnapshotCache=o;cloudSnapshotAt=now;
        return new JSONObject(o.toString());
    }

    private void invalidateCloudSnapshot(){synchronized(this){cloudSnapshotCache=null;cloudSnapshotAt=0L;}}
    private void touchCloudSnapshot(){synchronized(this){if(cloudSnapshotCache!=null)cloudSnapshotAt=System.currentTimeMillis();}}
    private void refreshCloudSnapshotAsync(){
        if(!cloudApi.isCloudMode()||!cloudApi.configured())return;
        new Thread(() -> {
            try{cloudStatusSnapshot(true);}catch(Throwable ignored){}
        },"JasonHomeStatusRefresh").start();
    }

    private String targetName(int target){
        return target<=0?"All":NAMES[Math.max(0,Math.min(NAMES.length-1,target-1))];
    }

    private String cloudControlCompat(JSONObject in) throws Exception {
        provisionCloudIdentity();
        SharedPreferences.Editor e=prefs.edit().putBoolean("manual_override",true);
        boolean hadPower=in.has("power"),hadBrightness=in.has("brightness"),hadEffect=in.has("effect"),hadColors=in.has("colors"),hadSpeed=in.has("speed");
        if(hadPower)e.putBoolean("power",in.optBoolean("power",true));
        if(hadBrightness)e.putInt("brightness",clamp(in.optInt("brightness",75),1,100));
        if(hadSpeed)e.putInt("speed",clamp(in.optInt("speed",3),1,5));
        if(in.has("name"))e.putString("running_name",in.optString("name","Manual"));
        if(hadEffect)e.putString("effect",normalizeEffect(in.optString("effect","Jump")));
        if(hadColors)e.putString("colors",normalizeColors(in.optJSONArray("colors")).toString());
        e.apply();

        JSONObject payload=new JSONObject();
        payload.put("target",targetName(prefs.getInt("ble_target",0)));
        if(hadPower)payload.put("power",in.optBoolean("power",true));
        if(hadBrightness)payload.put("brightness",clamp(in.optInt("brightness",75),1,100));
        if(hadSpeed)payload.put("speed",clamp(in.optInt("speed",3),1,5));
        if(hadEffect)payload.put("effect",normalizeEffect(in.optString("effect","Jump")));
        if(hadColors)payload.put("colors",normalizeColors(in.optJSONArray("colors")));
        if(in.has("name"))payload.put("name",in.optString("name","Manual"));

        // Old UI often sends one changed field at a time. Supply the current full scene
        // when Oracle needs to turn on/apply a visual change.
        if(!payload.has("power")||payload.optBoolean("power",true)){
            if(!payload.has("brightness"))payload.put("brightness",prefs.getInt("brightness",75));
            if(!payload.has("speed"))payload.put("speed",prefs.getInt("speed",3));
            if(!payload.has("effect"))payload.put("effect",prefs.getString("effect","Jump"));
            if(!payload.has("colors"))payload.put("colors",new JSONArray(prefs.getString("colors","[\"#FF0D00\"]")));
        }

        CloudflareApiClient.Result r=cloudApi.request("POST","/api/control",payload.toString());
        if(r.status<200||r.status>=300){
            String msg="Oracle control HTTP "+r.status;
            try{msg=new JSONObject(r.body).optString("error",msg);}catch(Throwable ignored){}
            throw new IOException(msg);
        }
        // The control response already proves Oracle accepted the command. Keep
        // the last good status snapshot hot so the classic UI can repaint without
        // waiting on a second HTTPS round-trip, then refresh status in background.
        touchCloudSnapshot();
        refreshCloudSnapshotAsync();
        return ok(stateJson());
    }

    private String cloudResumeCompat() throws Exception {
        provisionCloudIdentity();
        prefs.edit().putBoolean("manual_override",false).apply();
        CloudflareApiClient.Result r=cloudApi.request("POST","/api/resume-schedule","{}");
        if(r.status<200||r.status>=300){
            String msg="Oracle resume HTTP "+r.status;
            try{msg=new JSONObject(r.body).optString("error",msg);}catch(Throwable ignored){}
            throw new IOException(msg);
        }
        touchCloudSnapshot();
        refreshCloudSnapshotAsync();
        return ok(stateJson());
    }

    private void ensureDefaults() {
        if (!prefs.contains("brightness")) prefs.edit()
            .putBoolean("power",false)
            .putInt("brightness",75)
            .putInt("speed",3)
            .putString("running_name","Craumer Home")
            .putString("effect","Jump")
            .putString("colors","[\"#FF0D00\",\"#FFFFFA\"]")
            .putBoolean("manual_override",false)
            .putInt("ble_target",0)
            .putString("event_theme","3.0.29")
            .putLong("category_mask",(1L<<15)-1L)
            .apply();
    }

    private JSONObject loginPreview() throws Exception {
        JSONObject o=new JSONObject();
        o.put("power",prefs.getBoolean("power",false));
        o.put("brightness",prefs.getInt("brightness",75));
        o.put("speed",prefs.getInt("speed",3));
        JSONObject running=new JSONObject();
        running.put("effect",prefs.getString("effect","Jump"));
        running.put("colors",new JSONArray(prefs.getString("colors","[\"#FF0D00\"]")));
        o.put("running",running);
        LocalDate today=LocalDate.now();
        o.put("dawn",displayMinutes(schedule.civilDawnMinutes(today)));
        o.put("dusk",displayMinutes(schedule.civilDuskMinutes(today)));
        return o;
    }

    private JSONObject stateJson() throws Exception {
        JSONObject d=new JSONObject();
        d.put("firmwareVersion","Craumer Home • 5.4.0 Oracle");
        d.put("power",prefs.getBoolean("power",false));
        d.put("brightness",prefs.getInt("brightness",75));
        d.put("speed",prefs.getInt("speed",3));

        JSONObject running=new JSONObject();
        running.put("name",prefs.getString("running_name","Craumer Home"));
        running.put("effect",prefs.getString("effect","Jump"));
        running.put("colors",new JSONArray(prefs.getString("colors","[\"#FF0D00\"]")));
        d.put("running",running);

        LocalDate today=LocalDate.now();
        int dawn=schedule.civilDawnMinutes(today), dusk=schedule.civilDuskMinutes(today);
        JSONObject settings=new JSONObject();
        settings.put("on",clockMinutes(schedule.onMinutes()));
        settings.put("off",clockMinutes(schedule.offMinutes()));
        settings.put("lead",schedule.leadDays());
        settings.put("trail",schedule.trailDays());
        settings.put("overlap",schedule.overlap());
        settings.put("tz",prefs.getString("tz","EST5EDT,M3.2.0,M11.1.0"));
        settings.put("scheduler",schedule.enabled());
        settings.put("scheduler2",schedule.schedule2Enabled());
        settings.put("schedule1StartAtDusk",schedule.startAtDusk());
        settings.put("schedule2End",clockMinutes(schedule.schedule2EndMinutes()));
        settings.put("schedule2EndAtDawn",schedule.schedule2EndAtDawn());
        settings.put("schedule2Brightness",schedule.schedule2Brightness());
        settings.put("dawn",displayMinutes(dawn));
        settings.put("dusk",displayMinutes(dusk));
        d.put("settings",settings);

        String s1=schedule.startAtDusk()?"dusk ("+displayMinutes(dusk)+")":displayMinutes(schedule.onMinutes());
        String s2=schedule.schedule2EndAtDawn()?"dawn ("+displayMinutes(dawn)+")":displayMinutes(schedule.schedule2EndMinutes());
        d.put("scheduleWindow","Schedule 1 "+s1+" - "+displayMinutes(schedule.offMinutes())+
            " • Schedule 2 "+displayMinutes(schedule.offMinutes())+" - "+s2+" at "+schedule.schedule2Brightness()+"%");
        d.put("nextEvent",schedule.nextEventLabel());

        AndersonSchedule.Scene scene=schedule.resolveNow();
        JSONObject scheduled=new JSONObject();
        if(scene!=null){
            scheduled.put("name",scene.name);
            scheduled.put("id",scene.eventIndex>=0&&scene.eventIndex<AndersonEventData.EVENTS.length?AndersonEventData.EVENTS[scene.eventIndex].id:"");
            scheduled.put("enabled",true).put("toggleable",scene.eventIndex>=0).put("custom",false).put("upcoming",false);
        }else{
            scheduled.put("name",schedule.enabled()?"No event active right now":"Schedule disabled").put("id","").put("enabled",schedule.enabled()).put("toggleable",false).put("custom",false).put("upcoming",false);
        }
        d.put("scheduledEvent",scheduled);

        JSONObject b=new JSONObject();
        boolean useServer=cloudApi.isCloudMode();
        JSONObject server=null;
        boolean cloudReady=false;
        int cloudCount=0;
        java.util.HashSet<String> readyNames=new java.util.HashSet<>();
        String statusText;
        String transportText;
        if(useServer){
            try{
                server=cloudStatusSnapshot(false);
                JSONObject eu=server.optJSONObject("eufy");
                cloudReady=eu!=null&&eu.optBoolean("ready",false);
                JSONArray rn=eu==null?null:eu.optJSONArray("readyNames");
                if(rn!=null)for(int i=0;i<rn.length();i++)readyNames.add(rn.optString(i));
                cloudCount=readyNames.size();
                statusText=eu==null?"Oracle online":eu.optString("status","Oracle online");
                transportText="Oracle Linux → Eufy MQTT";
                JSONObject astro=server.optJSONObject("astronomy");
                if(astro!=null){
                    String cloudDawn=astro.optString("dawn","");
                    String cloudDusk=astro.optString("dusk","");
                    if(!cloudDawn.isEmpty())settings.put("dawn",cloudDawn);
                    if(!cloudDusk.isEmpty())settings.put("dusk",cloudDusk);
                }
                JSONObject calendar=server.optJSONObject("calendar");
                JSONObject next=server.optJSONObject("nextEvent");
                if(calendar!=null){
                    boolean calendarEnabled=calendar.optBoolean("enabled",schedule.enabled());
                    settings.put("scheduler",calendarEnabled);
                    JSONObject current=calendar.optJSONObject("current");
                    if(current!=null&&current.optString("name","").length()>0){
                        String id=current.optString("id","");
                        scheduled.put("name",current.optString("name","Scheduled event"));
                        scheduled.put("id",id).put("enabled",true).put("toggleable",!id.isEmpty()).put("custom",false).put("upcoming",false);
                    }else if(next!=null&&"calendar".equals(next.optString("source"))&&next.optString("name","").length()>0){
                        String id=next.optString("id","");
                        scheduled.put("name",next.optString("name"));
                        scheduled.put("id",id).put("enabled",true).put("toggleable",!id.isEmpty()).put("custom",false).put("upcoming",true);
                    }else{
                        scheduled.put("name",calendarEnabled?"Schedule active • waiting for next event":"Schedule disabled");
                        scheduled.put("id","").put("enabled",calendarEnabled).put("toggleable",false).put("custom",false).put("upcoming",false);
                    }
                }
                if(next!=null&&next.optString("name","").length()>0)d.put("nextEvent",cloudNextEventLabel(next));
                JSONObject ov=server.optJSONObject("override");
                if(ov!=null)d.put("manualOverride",ov.optBoolean("active",prefs.getBoolean("manual_override",false)));
            }catch(Throwable t){
                statusText="Oracle unavailable";
                transportText=t.getMessage()==null?t.getClass().getSimpleName():t.getMessage();
            }
        }else{
            cloudReady=cloud.isReady();cloudCount=cloud.readyCount();
            for(String name:NAMES)if(cloud.isDeviceReady(name))readyNames.add(name);
            statusText=cloud.status();transportText=cloudStatus;
        }
        b.put("ready",cloudReady);
        b.put("busy",useServer?false:cloud.isBusy());
        b.put("connected",cloudReady);
        b.put("connectedCount",cloudCount);
        b.put("knownCount",NAMES.length);
        b.put("seenCount",cloudCount);
        b.put("name","Saved Eufy lights");
        b.put("address","");
        b.put("protocol",useServer?"Oracle + Eufy MQTT":"Eufy Cloud MQTT");
        b.put("connectionMode",useServer?"Oracle / Internet":"Wi-Fi / Internet");
        b.put("target",prefs.getInt("ble_target",0));
        JSONArray controllers=new JSONArray();
        for(int i=0;i<NAMES.length;i++){
            boolean seen=readyNames.contains(NAMES[i]);
            JSONObject x=new JSONObject();
            x.put("slot",i).put("name",NAMES[i]).put("address",ADDRESSES[i])
             .put("model",MODELS[i]).put("protocol",MODELS[i]+(useServer?" / Oracle":" / Cloud MQTT"))
             .put("seen",seen).put("connected",seen).put("saved",true);
            controllers.put(x);
        }
        b.put("controllers",controllers);
        b.put("status",statusText);
        b.put("transportStatus",transportText);
        d.put("ble",b);
        if(!d.has("manualOverride"))d.put("manualOverride",prefs.getBoolean("manual_override",false));
        return d;
    }

    private String control(JSONObject in) throws Exception {
        SharedPreferences.Editor e=prefs.edit().putBoolean("manual_override",true);
        boolean hadPower=in.has("power");
        boolean hadBrightness=in.has("brightness");
        boolean hadEffect=in.has("effect");
        boolean hadColors=in.has("colors");
        boolean hadSpeed=in.has("speed");
        if(hadPower)e.putBoolean("power",in.optBoolean("power",true));
        if(hadBrightness)e.putInt("brightness",clamp(in.optInt("brightness",75),1,100));
        if(hadSpeed)e.putInt("speed",clamp(in.optInt("speed",3),1,5));
        if(in.has("name"))e.putString("running_name",in.optString("name","Manual"));
        if(hadEffect)e.putString("effect",normalizeEffect(in.optString("effect","Jump")));
        if(hadColors)e.putString("colors",normalizeColors(in.optJSONArray("colors")).toString());
        e.apply();

        boolean power=prefs.getBoolean("power",false);
        int brightness=prefs.getInt("brightness",75);
        int speed=prefs.getInt("speed",3);
        String effect=prefs.getString("effect","Jump");
        int[] colors=rgbArray(new JSONArray(prefs.getString("colors","[\"#FF0D00\"]")));
        int target=prefs.getInt("ble_target",0);

        if(hadPower && !power){
            cloud.setPower(target,false);
        }else if(hadColors || hadEffect || (hadPower && power)){
            cloud.setScene(target,effect,colors,speed,false,brightness);
        }else if(hadBrightness){
            cloud.setBrightness(target,brightness);
        }else if(hadSpeed){
            cloud.setEffect(target,effect,colors,speed,false);
        }
        return ok(stateJson());
    }

    private String resume() throws Exception {
        prefs.edit().putBoolean("manual_override",false).apply();
        AndersonScheduleService.update(context);
        AndersonSchedule.Scene scene=schedule.resolveNow();
        if(scene==null) cloud.setPower(0,false);
        else cloud.setScene(0,scene.effect,scene.colors,scene.speed,false,scene.brightness);
        return ok(stateJson());
    }

    private String saveSettings(JSONObject in) throws Exception {
        if(in.has("on"))schedule.setOnMinutes(parseMinutes(in.optString("on"),schedule.onMinutes()));
        if(in.has("off"))schedule.setOffMinutes(parseMinutes(in.optString("off"),schedule.offMinutes()));
        if(in.has("lead"))schedule.setLeadDays(in.optInt("lead",schedule.leadDays()));
        if(in.has("trail"))schedule.setTrailDays(in.optInt("trail",schedule.trailDays()));
        if(in.has("scheduler"))schedule.setEnabled(in.optBoolean("scheduler",schedule.enabled()));
        if(in.has("scheduler2"))schedule.setSchedule2Enabled(in.optBoolean("scheduler2",schedule.schedule2Enabled()));
        if(in.has("schedule1Dusk"))schedule.setStartAtDusk(in.optBoolean("schedule1Dusk",schedule.startAtDusk()));
        if(in.has("schedule2Dawn"))schedule.setSchedule2EndAtDawn(in.optBoolean("schedule2Dawn",schedule.schedule2EndAtDawn()));
        if(in.has("schedule2End"))schedule.setSchedule2EndMinutes(parseMinutes(in.optString("schedule2End"),schedule.schedule2EndMinutes()));
        if(in.has("schedule2Brightness"))schedule.setSchedule2Brightness(in.optInt("schedule2Brightness",schedule.schedule2Brightness()));
        if(in.has("overlap"))schedule.setOverlap(parseOverlap(in.optString("overlap","rotate")));
        if(in.has("tz"))prefs.edit().putString("tz",in.optString("tz")).apply();
        AndersonScheduleService.update(context);
        if(cloudApi.isCloudMode()&&cloudApi.configured()){
            provisionCloudIdentity();
            syncCalendarToOracle();
            invalidateCloudSnapshot();
        }else syncCalendarToOracleAsync();
        return ok(stateJson());
    }

    private JSONObject eventsJson(int year,int month,String search) throws Exception {
        JSONObject out=new JSONObject();
        JSONArray arr=new JSONArray();
        String q=search==null?"":search.trim().toLowerCase(Locale.ROOT);
        long mask=prefs.getLong("category_mask",(1L<<15)-1L);
        for(int i=0;i<AndersonEventData.EVENTS.length;i++){
            if(!schedule.includedByMode(i))continue;
            int cat=(i<AndersonEventData.CATEGORY_INDEX.length)?AndersonEventData.CATEGORY_INDEX[i]:9;
            if((mask&(1L<<cat))==0)continue;
            if(month>0&&!schedule.eventOccursInMonth(i,year,month))continue;
            AndersonEventData.Event e=AndersonEventData.EVENTS[i];
            AndersonEventData.Category cd=AndersonEventData.CATEGORIES[Math.max(0,Math.min(cat,AndersonEventData.CATEGORIES.length-1))];
            String when=eventWhen(i,year);
            String hay=(e.name+" "+when+" "+e.kind+" "+cd.name).toLowerCase(Locale.ROOT);
            if(!q.isEmpty()&&!hay.contains(q))continue;
            JSONObject x=new JSONObject();
            x.put("id",e.id).put("name",e.name).put("kind",e.kind)
             .put("categoryId",cd.id).put("categoryName",cd.name).put("categoryColor",cd.color)
             .put("when",when).put("effect",eventEffect(i)).put("customized",eventCustomized(i))
             .put("speed",eventSpeed(i)).put("enabled",eventEnabled(i)).put("favorite",eventFavorite(i))
             .put("colors",jsonColors(eventColors(i)));
            arr.put(x);
            if(arr.length()>=96&&month==0)break;
        }
        out.put("events",arr);
        out.put("truncated",month==0&&arr.length()>=96);
        out.put("overlap","Craumer priority and overlap rules are active.");
        return out;
    }

    private String updateEvent(JSONObject in) throws Exception {
        int idx=eventIndex(in.optString("id",""));
        if(idx<0)return error(404,"Unknown event");
        String p="event_"+AndersonEventData.EVENTS[idx].id+"_";
        SharedPreferences.Editor ed=prefs.edit();
        if(in.optBoolean("reset",false)){
            ed.remove(p+"effect").remove(p+"speed").remove(p+"colors");
        }else{
            if(in.has("enabled"))ed.putBoolean(p+"enabled",in.optBoolean("enabled",true));
            if(in.has("favorite"))ed.putBoolean(p+"favorite",in.optBoolean("favorite",false));
            if(in.has("effect"))ed.putString(p+"effect",normalizeEffect(in.optString("effect")));
            if(in.has("speed"))ed.putInt(p+"speed",clamp(in.optInt("speed",1),1,5));
            if(in.has("colors"))ed.putString(p+"colors",normalizeColors(in.optJSONArray("colors")).toString());
        }
        ed.apply();
        syncCalendarToOracleAsync();
        return ok(new JSONObject().put("ok",true));
    }

    private JSONObject eventCategories() throws Exception {
        JSONObject out=new JSONObject();
        long mask=prefs.getLong("category_mask",(1L<<15)-1L);
        out.put("mask",mask).put("expanded",schedule.mode()!=AndersonSchedule.Mode.MAJOR_BASIC);
        JSONArray a=new JSONArray();
        for(int c=0;c<AndersonEventData.CATEGORIES.length;c++){
            int count=0;
            for(int v:AndersonEventData.CATEGORY_INDEX)if(v==c)count++;
            AndersonEventData.Category d=AndersonEventData.CATEGORIES[c];
            a.put(new JSONObject().put("index",c).put("id",d.id).put("name",d.name).put("color",d.color)
                .put("enabled",(mask&(1L<<c))!=0).put("count",count));
        }
        out.put("categories",a);
        return out;
    }

    private String updateEventCategory(JSONObject in) throws Exception {
        int idx=in.optInt("index",-1);
        if(idx<0||idx>=15)return error(400,"Choose a valid event category");
        long mask=prefs.getLong("category_mask",(1L<<15)-1L);
        long bit=1L<<idx;
        mask=in.optBoolean("enabled",true)?(mask|bit):(mask&~bit);
        prefs.edit().putLong("category_mask",mask).apply();
        AndersonEventData.Category d=AndersonEventData.CATEGORIES[idx];
        syncCalendarToOracleAsync();
        return ok(new JSONObject().put("ok",true).put("index",idx).put("id",d.id).put("name",d.name).put("color",d.color)
            .put("enabled",(mask&bit)!=0).put("mask",mask));
    }

    private JSONObject eventColorTheme() throws Exception {
        String t=prefs.getString("event_theme","3.0.29");
        return new JSONObject().put("theme",t).put("name",themeName(t));
    }

    private String setEventColorTheme(JSONObject in) throws Exception {
        String t=in.optString("theme","3.0.29");
        if("1".equals(t))schedule.setMode(AndersonSchedule.Mode.MAJOR_BASIC);
        else if("3.0.28".equals(t))schedule.setMode(AndersonSchedule.Mode.EXPANDED_BASIC);
        else {t="3.0.29";schedule.setMode(AndersonSchedule.Mode.EXPANDED_COLORS);}
        prefs.edit().putString("event_theme",t).apply();
        syncCalendarToOracleAsync();
        return ok(new JSONObject().put("theme",t).put("name",themeName(t)));
    }

    private JSONObject favorites() throws Exception {
        JSONArray a=new JSONArray();
        for(int i=0;i<AndersonEventData.EVENTS.length;i++){
            if(!eventFavorite(i))continue;
            AndersonEventData.Event e=AndersonEventData.EVENTS[i];
            a.put(new JSONObject().put("id",e.id).put("name",e.name).put("effect",eventEffect(i))
                .put("speed",eventSpeed(i)).put("favorite",true).put("custom",false).put("colors",jsonColors(eventColors(i))));
        }
        JSONArray p=readArray("presets");
        for(int i=0;i<p.length();i++){
            JSONObject x=p.optJSONObject(i);
            if(x!=null&&x.optBoolean("favorite",false)){
                JSONObject y=new JSONObject(x.toString());
                y.put("custom",true);
                a.put(y);
            }
        }
        return new JSONObject().put("events",a);
    }

    private JSONObject presetsJson() throws Exception {
        return new JSONObject().put("presets",readArray("presets"));
    }

    private String updatePreset(JSONObject in) throws Exception {
        JSONArray a=readArray("presets");
        String deleteId=in.optString("deleteId","");
        String id=in.optString("id","");
        if(!deleteId.isEmpty()){
            a=removeById(a,deleteId);
            writeArray("presets",a);
            return ok(new JSONObject().put("ok",true));
        }
        if(!id.isEmpty()&&(in.has("favorite")||in.has("enabled"))){
            JSONObject x=findById(a,id);
            if(x==null)return error(404,"Unknown custom light");
            if(in.has("favorite"))x.put("favorite",in.optBoolean("favorite"));
            if(in.has("enabled"))x.put("enabled",in.optBoolean("enabled"));
            writeArray("presets",a);
            return ok(new JSONObject().put("ok",true).put("id",id));
        }
        String name=in.optString("name","").trim();
        if(name.isEmpty())return error(400,"Give this custom light a name");
        if(id.isEmpty())id="custom-"+UUID.randomUUID().toString().substring(0,8);
        JSONObject x=findById(a,id);
        if(x==null){x=new JSONObject();a.put(x);}
        x.put("id",id).put("name",name).put("effect",normalizeEffect(in.optString("effect","Jump")))
         .put("brightness",clamp(in.optInt("brightness",100),1,100)).put("speed",clamp(in.optInt("speed",3),1,5))
         .put("enabled",in.has("enabled")?in.optBoolean("enabled"):true)
         .put("favorite",in.has("favorite")?in.optBoolean("favorite"):false)
         .put("colors",normalizeColors(in.optJSONArray("colors")));
        writeArray("presets",a);
        return ok(new JSONObject().put("ok",true).put("id",id).put("fileBytes",a.toString().getBytes(StandardCharsets.UTF_8).length));
    }

    private JSONObject customSchedules(Uri uri) throws Exception {
        int year=intQuery(uri,"year",LocalDate.now().getYear());
        int month=intQuery(uri,"month",LocalDate.now().getMonthValue());
        JSONArray all=readArray("custom_schedules"), out=new JSONArray();
        for(int i=0;i<all.length();i++){
            JSONObject s=all.optJSONObject(i);
            if(s==null)continue;
            if(s.optInt("month")==month&&(s.optBoolean("annual",true)||s.optInt("year")==year))out.put(s);
        }
        return new JSONObject().put("items",out);
    }

    private String updateCustomSchedule(JSONObject in) throws Exception {
        JSONArray a=readArray("custom_schedules");
        String id=in.optString("id","");
        if(!id.isEmpty()&&in.optBoolean("remove",false)){
            writeArray("custom_schedules",removeById(a,id));
            syncCalendarToOracleAsync();
            return ok(new JSONObject().put("ok",true));
        }
        if(!id.isEmpty()&&in.has("enabled")){
            JSONObject x=findById(a,id); if(x==null)return error(404,"Unknown custom schedule");
            x.put("enabled",in.optBoolean("enabled",true)); writeArray("custom_schedules",a);
            syncCalendarToOracleAsync();
            return ok(new JSONObject().put("ok",true));
        }
        String presetId=in.optString("presetId","");
        JSONObject preset=findById(readArray("presets"),presetId);
        if(preset==null)return error(404,"Custom light not found");
        JSONObject x=new JSONObject(preset.toString());
        x.put("id","schedule-"+UUID.randomUUID().toString().substring(0,8));
        x.put("presetId",presetId);
        x.put("year",in.optInt("year",LocalDate.now().getYear()));
        x.put("month",in.optInt("month",LocalDate.now().getMonthValue()));
        x.put("day",in.optInt("day",LocalDate.now().getDayOfMonth()));
        x.put("annual",in.optBoolean("annual",true));
        x.put("enabled",true);
        a.put(x); writeArray("custom_schedules",a);
        syncCalendarToOracleAsync();
        return ok(new JSONObject().put("ok",true).put("id",x.getString("id")));
    }

    private JSONObject colorsJson() throws Exception {
        JSONArray presets=new JSONArray();
        for(int i=0;i<LightPresetCatalog.ANDERSON.length;i++){
            LightPresetCatalog.NamedColor c=LightPresetCatalog.ANDERSON[i];
            String def=String.format(Locale.ROOT,"#%06X",c.rgb&0xffffff);
            String val=prefs.getString("color_"+i,def);
            presets.put(new JSONObject().put("index",i).put("name",c.name).put("color",val).put("default",def).put("customized",!def.equalsIgnoreCase(val)));
        }
        return new JSONObject().put("presets",presets);
    }

    private String updateColor(JSONObject in) throws Exception {
        int idx=in.optInt("index",-1);
        if(idx<0||idx>=LightPresetCatalog.ANDERSON.length)return error(400,"Select a valid color preset");
        if(in.optBoolean("reset",false))prefs.edit().remove("color_"+idx).apply();
        else{
            String v=normalizeHex(in.optString("color",""));
            if(v==null)return error(400,"Enter a valid six-digit color");
            prefs.edit().putString("color_"+idx,v).apply();
        }
        return ok(colorsJson());
    }

    private JSONObject bleScan() throws Exception {
        JSONArray devices=new JSONArray();
        if(cloudApi.isCloudMode()){
            JSONObject st=cloudStatusSnapshot(true);
            java.util.HashSet<String> ready=new java.util.HashSet<>();
            JSONObject eu=st.optJSONObject("eufy");JSONArray rn=eu==null?null:eu.optJSONArray("readyNames");
            if(rn!=null)for(int i=0;i<rn.length();i++)ready.add(rn.optString(i));
            for(int i=0;i<NAMES.length;i++)devices.put(new JSONObject().put("name",NAMES[i]).put("address",ADDRESSES[i]).put("rssi",0).put("model",MODELS[i]).put("serial",deviceStore.serialFor(ADDRESSES[i],"")).put("connected",ready.contains(NAMES[i])));
            return new JSONObject().put("scanning",false).put("transport","oracle").put("devices",devices);
        }
        cloud.refresh();
        for(int i=0;i<NAMES.length;i++){
            devices.put(new JSONObject()
                .put("name",NAMES[i])
                .put("address",ADDRESSES[i])
                .put("rssi",0)
                .put("model",MODELS[i])
                .put("serial",deviceStore.serialFor(ADDRESSES[i],""))
                .put("connected",cloud.isDeviceReady(NAMES[i])));
        }
        return new JSONObject().put("scanning",false).put("transport","wifi-cloud").put("devices",devices);
    }

    private String bleTarget(JSONObject in) throws Exception {
        int target=in.optInt("target",0);
        if(target<0||target>4)target=0;
        prefs.edit().putInt("ble_target",target).apply();
        return ok(stateJson());
    }

    private JSONObject backupStatus() throws Exception {
        SharedPreferences bp=context.getSharedPreferences("craumer_backup",Context.MODE_PRIVATE);
        String snapshot=bp.getString("snapshot","");
        long when=bp.getLong("last_backup",0L);
        return new JSONObject()
            .put("hasBackup",!snapshot.isEmpty())
            .put("lastBackup",when)
            .put("lastOk",!snapshot.isEmpty())
            .put("mode","complete");
    }

    private String backupAll() throws Exception {
        JSONObject root=new JSONObject();
        root.put("schema",1);
        root.put("createdAt",System.currentTimeMillis()/1000L);
        root.put("app",preferencesToJson(context.getSharedPreferences("anderson_android",Context.MODE_PRIVATE),true));
        root.put("schedule",preferencesToJson(context.getSharedPreferences("jason_schedule",Context.MODE_PRIVATE),false));
        // Device authentication/serial identity is intentionally not copied into a settings backup.
        SharedPreferences bp=context.getSharedPreferences("craumer_backup",Context.MODE_PRIVATE);
        long now=System.currentTimeMillis()/1000L;
        bp.edit().putString("snapshot",root.toString()).putLong("last_backup",now).apply();
        return ok(new JSONObject().put("ok",true).put("lastBackup",now).put("mode","complete"));
    }

    private String restoreBackup() throws Exception {
        SharedPreferences bp=context.getSharedPreferences("craumer_backup",Context.MODE_PRIVATE);
        String raw=bp.getString("snapshot","");
        if(raw.isEmpty())return error(404,"No Craumer Home backup is available");
        JSONObject root=new JSONObject(raw);
        restorePreferences(context.getSharedPreferences("anderson_android",Context.MODE_PRIVATE),root.optJSONObject("app"),true);
        restorePreferences(context.getSharedPreferences("jason_schedule",Context.MODE_PRIVATE),root.optJSONObject("schedule"),false);
        AndersonScheduleService.update(context);
        return ok(new JSONObject().put("ok",true).put("restoredAt",System.currentTimeMillis()/1000L));
    }

    private JSONObject preferencesToJson(SharedPreferences source,boolean appPrefs) throws Exception {
        JSONObject out=new JSONObject();
        for(Map.Entry<String,?> entry:source.getAll().entrySet()){
            String key=entry.getKey();
            if(appPrefs&&(key.startsWith("pin_")||"pin_enabled".equals(key)))continue;
            Object value=entry.getValue();
            JSONObject v=new JSONObject();
            if(value instanceof String){v.put("t","s").put("v",value);}
            else if(value instanceof Boolean){v.put("t","b").put("v",value);}
            else if(value instanceof Integer){v.put("t","i").put("v",value);}
            else if(value instanceof Long){v.put("t","l").put("v",value);}
            else if(value instanceof Float){v.put("t","f").put("v",((Float)value).doubleValue());}
            else if(value instanceof Set){
                JSONArray a=new JSONArray();
                for(Object x:(Set<?>)value)a.put(String.valueOf(x));
                v.put("t","ss").put("v",a);
            }else continue;
            out.put(key,v);
        }
        return out;
    }

    private void restorePreferences(SharedPreferences target,JSONObject data,boolean appPrefs) throws Exception {
        if(data==null)return;
        SharedPreferences.Editor ed=target.edit().clear();
        for(java.util.Iterator<String> it=data.keys();it.hasNext();){
            String key=it.next();
            if(appPrefs&&(key.startsWith("pin_")||"pin_enabled".equals(key)))continue;
            JSONObject v=data.optJSONObject(key);
            if(v==null)continue;
            String type=v.optString("t","");
            switch(type){
                case "s": ed.putString(key,v.optString("v","")); break;
                case "b": ed.putBoolean(key,v.optBoolean("v",false)); break;
                case "i": ed.putInt(key,v.optInt("v",0)); break;
                case "l": ed.putLong(key,v.optLong("v",0L)); break;
                case "f": ed.putFloat(key,(float)v.optDouble("v",0.0)); break;
                case "ss":
                    java.util.HashSet<String> set=new java.util.HashSet<>();
                    JSONArray a=v.optJSONArray("v");
                    if(a!=null)for(int i=0;i<a.length();i++)set.add(a.optString(i,""));
                    ed.putStringSet(key,set);
                    break;
            }
        }
        ed.apply();
    }

    private int[] eventColors(int i) throws Exception {
        String p="event_"+AndersonEventData.EVENTS[i].id+"_";
        if(prefs.contains(p+"colors"))return rgbArray(new JSONArray(prefs.getString(p+"colors","[]")));
        AndersonEventData.Event e=AndersonEventData.EVENTS[i];
        int[] src=schedule.mode()==AndersonSchedule.Mode.MAJOR_BASIC?e.majorColors:
            schedule.mode()==AndersonSchedule.Mode.EXPANDED_BASIC?e.basicColors:e.modernColors;
        return src.clone();
    }

    private String eventEffect(int i){return prefs.getString("event_"+AndersonEventData.EVENTS[i].id+"_effect",AndersonEventData.EVENTS[i].effect);}
    private int eventSpeed(int i){return prefs.getInt("event_"+AndersonEventData.EVENTS[i].id+"_speed",AndersonEventData.EVENTS[i].speed);}
    private boolean eventEnabled(int i){return prefs.getBoolean("event_"+AndersonEventData.EVENTS[i].id+"_enabled",true);}
    private boolean eventFavorite(int i){return prefs.getBoolean("event_"+AndersonEventData.EVENTS[i].id+"_favorite",false);}
    private boolean eventCustomized(int i){
        String p="event_"+AndersonEventData.EVENTS[i].id+"_";
        return prefs.contains(p+"effect")||prefs.contains(p+"speed")||prefs.contains(p+"colors");
    }

    private String eventWhen(int i,int year) {
        AndersonEventData.Event e=AndersonEventData.EVENTS[i];
        if("Month".equals(e.rule))return java.time.Month.of(e.month).getDisplayName(java.time.format.TextStyle.FULL,Locale.US)+" — all month";
        LocalDate d=schedule.eventStartDate(i,year);
        if(d==null)return "No scheduled date in "+year;
        DateTimeFormatter f=DateTimeFormatter.ofPattern("MMM d",Locale.US);
        if(e.durationDays>1)return f.format(d)+" – "+f.format(d.plusDays(e.durationDays-1L));
        return f.format(d);
    }

    private JSONArray jsonColors(int[] colors) {
        JSONArray a=new JSONArray();
        for(int c:colors)a.put(String.format(Locale.ROOT,"#%06X",c&0xffffff));
        return a;
    }

    private JSONArray normalizeColors(JSONArray in) {
        JSONArray out=new JSONArray();
        if(in!=null)for(int i=0;i<in.length()&&out.length()<8;i++){
            String h=normalizeHex(in.optString(i,""));
            if(h!=null)out.put(h);
        }
        if(out.length()==0)out.put("#E08700");
        return out;
    }

    private int[] rgbArray(JSONArray a) {
        int n=Math.max(1,Math.min(8,a==null?0:a.length()));
        int[] out=new int[n];
        if(a==null||a.length()==0){out[0]=0xE08700;return out;}
        for(int i=0;i<n;i++){
            String h=normalizeHex(a.optString(i,"#E08700"));
            out[i]=h==null?0xE08700:Integer.parseInt(h.substring(1),16);
        }
        return out;
    }

    private static String normalizeHex(String s) {
        if(s==null)return null;
        s=s.trim().toUpperCase(Locale.ROOT);
        if(!s.startsWith("#"))s="#"+s;
        return s.matches("#[0-9A-F]{6}")?s:null;
    }

    private static String normalizeEffect(String e) {
        if(e==null)return "Jump";
        if(e.startsWith("Solid"))return "Solid";
        if(e.startsWith("Breath"))return "Breath";
        if(e.startsWith("Strobe"))return "Strobe";
        return e;
    }

    void syncCalendarToOracleAsync() {
        if(!cloudApi.isCloudMode()||!cloudApi.configured())return;
        new Thread(() -> {
            try{
                provisionCloudIdentity();
                syncCalendarToOracle();
                invalidateCloudSnapshot();
                host.onBridgeStatus("Oracle holiday calendar synchronized");
            }catch(Throwable t){
                host.onBridgeStatus("Oracle calendar sync failed: "+(t.getMessage()==null?t.getClass().getSimpleName():t.getMessage()));
            }
        },"JasonHomeCalendarSync").start();
    }

    private void syncCalendarToOracle() throws Exception {
        JSONObject root=new JSONObject();
        root.put("version",1);

        JSONObject st=new JSONObject();
        st.put("enabled",schedule.enabled());
        st.put("mode",schedule.mode().ordinal());
        st.put("lead",schedule.leadDays());
        st.put("trail",schedule.trailDays());
        st.put("on",schedule.onMinutes());
        st.put("off",schedule.offMinutes());
        st.put("startAtDusk",schedule.startAtDusk());
        st.put("schedule2Enabled",schedule.schedule2Enabled());
        st.put("schedule2EndAtDawn",schedule.schedule2EndAtDawn());
        st.put("schedule2End",schedule.schedule2EndMinutes());
        st.put("schedule2Brightness",schedule.schedule2Brightness());
        st.put("overlap",schedule.overlap());
        st.put("categoryMask",prefs.getLong("category_mask",(1L<<15)-1L));
        root.put("settings",st);

        java.util.HashSet<Integer> major=new java.util.HashSet<>();
        for(int v:AndersonEventData.MAJOR)major.add(v);

        JSONArray events=new JSONArray();
        for(int i=0;i<AndersonEventData.EVENTS.length;i++){
            AndersonEventData.Event e=AndersonEventData.EVENTS[i];
            JSONObject x=new JSONObject();
            x.put("id",e.id).put("name",e.name).put("kind",e.kind).put("rule",e.rule)
             .put("month",e.month).put("day",e.day).put("weekday",e.weekday).put("nth",e.nth)
             .put("offsetDays",e.offsetDays).put("durationDays",e.durationDays)
             .put("effect",eventEffect(i)).put("speed",eventSpeed(i))
             .put("colors",jsonColorsAsInts(eventColors(i)))
             .put("enabled",eventEnabled(i)).put("favorite",eventFavorite(i))
             .put("categoryIndex",i<AndersonEventData.CATEGORY_INDEX.length?AndersonEventData.CATEGORY_INDEX[i]:9)
             .put("major",major.contains(i));
            events.put(x);
        }
        root.put("events",events);

        JSONArray special=new JSONArray();
        for(int[] v:AndersonEventData.SPECIAL){
            if(v.length<4||v[0]<0||v[0]>=AndersonEventData.EVENTS.length)continue;
            special.put(new JSONObject().put("id",AndersonEventData.EVENTS[v[0]].id)
                .put("year",v[1]).put("month",v[2]).put("day",v[3]));
        }
        root.put("special",special);
        root.put("customSchedules",readArray("custom_schedules"));

        CloudflareApiClient.Result r=cloudApi.request("POST","/api/calendar/sync",root.toString());
        if(r.status<200||r.status>=300){
            String msg="Oracle calendar sync HTTP "+r.status;
            try{msg=new JSONObject(r.body).optString("error",msg);}catch(Throwable ignored){}
            throw new IOException(msg);
        }
    }

    private JSONArray jsonColorsAsInts(int[] colors){
        JSONArray a=new JSONArray();
        if(colors!=null)for(int c:colors)a.put(c&0xffffff);
        return a;
    }

    private JSONObject parseBody(String body) {
        try{return body==null||body.trim().isEmpty()?new JSONObject():new JSONObject(body);}
        catch(Throwable t){return new JSONObject();}
    }

    private String ok(JSONObject body) {
        return response(200,body==null?"{}":body.toString());
    }

    private String error(int code,String message) {
        try{return response(code,new JSONObject().put("ok",false).put("error",message).toString());}
        catch(Throwable t){return response(code,"{\"ok\":false}");}
    }

    private String response(int status,String body) {
        try{return new JSONObject().put("status",status).put("statusText",status>=200&&status<300?"OK":"Error").put("body",body==null?"":body).toString();}
        catch(Throwable t){return "{\"status\":500,\"body\":\"{}\"}";}
    }

    private JSONArray readArray(String key) {
        try{return new JSONArray(prefs.getString(key,"[]"));}catch(Throwable t){return new JSONArray();}
    }

    private void writeArray(String key,JSONArray a){prefs.edit().putString(key,a.toString()).apply();}

    private static JSONObject findById(JSONArray a,String id) {
        for(int i=0;i<a.length();i++){JSONObject x=a.optJSONObject(i);if(x!=null&&id.equals(x.optString("id")))return x;}
        return null;
    }

    private static JSONArray removeById(JSONArray a,String id) {
        JSONArray out=new JSONArray();
        for(int i=0;i<a.length();i++){JSONObject x=a.optJSONObject(i);if(x!=null&&!id.equals(x.optString("id")))out.put(x);}
        return out;
    }

    private int eventIndex(String id) {
        for(int i=0;i<AndersonEventData.EVENTS.length;i++)if(AndersonEventData.EVENTS[i].id.equals(id))return i;
        return -1;
    }

    private static int intQuery(Uri u,String key,int def){try{String v=u.getQueryParameter(key);return v==null?def:Integer.parseInt(v);}catch(Throwable t){return def;}}
    private static int clamp(int v,int lo,int hi){return Math.max(lo,Math.min(hi,v));}
    private static int parseMinutes(String s,int def){try{String[] p=s.split(":");return clamp(Integer.parseInt(p[0])*60+Integer.parseInt(p[1]),0,1439);}catch(Throwable t){return def;}}
    private static String cloudNextEventLabel(JSONObject next){
        String name=next==null?"":next.optString("name","");
        String at=next==null?"":next.optString("at","");
        if(name.isEmpty())return "—";
        if(at.isEmpty())return name;
        try{
            ZonedDateTime z=java.time.Instant.parse(at).atZone(ZoneId.of("America/New_York"));
            return name+" • "+DateTimeFormatter.ofPattern("EEE MMM d • h:mm a",Locale.US).format(z);
        }catch(Throwable ignored){return name;}
    }

    private static String clockMinutes(int v){v=((v%1440)+1440)%1440;return String.format(Locale.ROOT,"%02d:%02d",v/60,v%60);}
    private static String displayMinutes(int v){v=((v%1440)+1440)%1440;int h=v/60,m=v%60;String ap=h>=12?"PM":"AM";h%=12;if(h==0)h=12;return String.format(Locale.ROOT,"%d:%02d %s",h,m,ap);}
    private static String overlapString(int v){return v==2?"combine":v==1?"rotate":"priority";}
    private static int parseOverlap(String v){return "combine".equals(v)?2:"rotate".equals(v)?1:0;}
    private static String themeName(String t){return "1".equals(t)?"Major U.S. Holidays — Basic Colors":"3.0.28".equals(t)?"Expanded Holidays — Basic Colors":"Expanded Holidays — Expanded Colors";}
    private static int indexOfAddress(String address){for(int i=0;i<ADDRESSES.length;i++)if(ADDRESSES[i].equalsIgnoreCase(address))return i;return -1;}

    private static String hashPin(String profile,String pin) {
        try{
            MessageDigest d=MessageDigest.getInstance("SHA-256");
            byte[] b=d.digest(("JasonHomeAnderson|"+profile+"|"+pin).getBytes(StandardCharsets.UTF_8));
            StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format(Locale.ROOT,"%02x",x&255));return s.toString();
        }catch(Throwable t){return profile+"|"+pin;}
    }
}

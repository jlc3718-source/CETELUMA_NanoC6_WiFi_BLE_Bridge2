package com.jasonhome.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
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
        void requestBlePermissionsAndScan();
        void onBridgeStatus(String message);
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
    private final BleLightController ble;
    private final AndersonSchedule schedule;
    private final SharedPreferences prefs;

    private final Object scanLock = new Object();
    private List<BleLightController.FoundLight> discovered = new ArrayList<>();
    private volatile long scanUntilMs = 0L;
    private volatile String bleStatus = "Ready";

    AndersonApiBridge(Context context, Host host, DeviceStore deviceStore,
                      BleLightController ble, AndersonSchedule schedule) {
        this.context = context.getApplicationContext();
        this.host = host;
        this.deviceStore = deviceStore;
        this.ble = ble;
        this.schedule = schedule;
        this.prefs = this.context.getSharedPreferences("anderson_android", Context.MODE_PRIVATE);
        ensureDefaults();
    }

    void updateDiscovered(List<BleLightController.FoundLight> items) {
        synchronized (scanLock) {
            discovered = items == null ? new ArrayList<>() : new ArrayList<>(items);
        }
    }

    void updateBleStatus(String message) {
        bleStatus = message == null ? "" : message;
    }

    @JavascriptInterface
    public String request(String method, String url, String body, String token) {
        try {
            String m = method == null ? "GET" : method.toUpperCase(Locale.ROOT);
            String raw = url == null ? "/" : url;
            Uri uri = Uri.parse(raw.startsWith("http") ? raw : "http://local" + raw);
            String path = uri.getPath() == null ? "/" : uri.getPath();
            JSONObject input = parseBody(body);

            if ("/api/auth/status".equals(path)) return ok(authStatus());
            if ("/api/auth/unlock".equals(path) && "POST".equals(m)) return authUnlock(input);
            if ("/api/auth/logout".equals(path)) return response(204, "");
            if ("/api/auth/config".equals(path) && "POST".equals(m)) return authConfig(input);
            if ("/api/auth/pin".equals(path) && "POST".equals(m)) return authPin(input);

            if ("/api/login-preview".equals(path)) return ok(loginPreview());
            if ("/api/state".equals(path)) return ok(stateJson());
            if ("/api/control".equals(path) && "POST".equals(m)) return control(input);
            if ("/api/resume".equals(path) && "POST".equals(m)) return resume();
            if ("/api/settings".equals(path) && "POST".equals(m)) return saveSettings(input);

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

            if ("/api/ble/scan".equals(path)) return ok(bleScan());
            if ("/api/ble/select".equals(path) && "POST".equals(m)) return bleSelect(input);
            if ("/api/ble/remove".equals(path) && "POST".equals(m)) return ok(new JSONObject().put("ok",true));
            if ("/api/ble/rename".equals(path) && "POST".equals(m)) return ok(new JSONObject().put("ok",true));
            if ("/api/ble/target".equals(path) && "POST".equals(m)) return bleTarget(input);

            if ("/api/system".equals(path)) return ok(systemJson());
            if ("/api/firmware".equals(path)) return ok(firmwareJson());
            if ("/api/remote-update".equals(path)) return ok(remoteUpdateJson());
            if ("/api/remote-update/check".equals(path) || "/api/remote-update/install".equals(path))
                return ok(new JSONObject().put("ok",true).put("operationId",1).put("operationComplete",true).put("message","Android app updates are installed as signed APK upgrades."));
            if ("/api/wifi/scan".equals(path)) return ok(new JSONObject().put("scanning",false).put("networks",new JSONArray()));
            if ("/api/wifi".equals(path) && "POST".equals(m)) return ok(new JSONObject().put("ok",true).put("message","Android manages Wi-Fi."));
            if ("/api/reboot".equals(path) || "/api/rollback".equals(path) || "/api/update".equals(path))
                return error(409,"This control belongs to the NanoC6 firmware and is not used by Jason Home Android.");

            // Keep the complete Anderson UI alive even for firmware-only panels.
            return ok(new JSONObject().put("ok",true).put("android",true));
        } catch (Throwable t) {
            return error(500, t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
        }
    }

    private void ensureDefaults() {
        if (!prefs.contains("brightness")) prefs.edit()
            .putBoolean("power",false)
            .putInt("brightness",75)
            .putInt("speed",3)
            .putString("running_name","Anderson Home")
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
        d.put("firmwareVersion","Jason Home • Anderson 3.1.58");
        d.put("power",prefs.getBoolean("power",false));
        d.put("brightness",prefs.getInt("brightness",75));
        d.put("speed",prefs.getInt("speed",3));

        JSONObject running=new JSONObject();
        running.put("name",prefs.getString("running_name","Anderson Home"));
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
            scheduled.put("name","No enabled scheduled event").put("id","").put("enabled",false).put("toggleable",false).put("custom",false).put("upcoming",false);
        }
        d.put("scheduledEvent",scheduled);

        JSONObject wifi=new JSONObject();
        wifi.put("ssid","Android device").put("rssi",0).put("ip","Local WebView");
        d.put("wifi",wifi);

        JSONObject b=new JSONObject();
        List<BleLightController.FoundLight> snap=snapshotDiscovered();
        b.put("connected",!snap.isEmpty());
        b.put("connectedCount",snap.size());
        b.put("name",snap.isEmpty()?"Eufy E10 BLE":"Installed Eufy lights");
        b.put("address","");
        b.put("protocol","Eufy E10");
        b.put("target",prefs.getInt("ble_target",0));
        JSONArray controllers=new JSONArray();
        for(int i=0;i<ADDRESSES.length;i++){
            JSONObject x=new JSONObject();
            x.put("slot",i).put("name",NAMES[i]).put("address",ADDRESSES[i]).put("protocol",MODELS[i]+" / E10").put("connected",isDiscovered(ADDRESSES[i]));
            controllers.put(x);
        }
        b.put("controllers",controllers);
        b.put("status",bleStatus);
        d.put("ble",b);
        d.put("manualOverride",prefs.getBoolean("manual_override",false));
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
        List<BleLightController.FoundLight> targets=targets();

        host.runOnUi(() -> {
            try {
                if(hadPower && !power){
                    ble.setPower(targets,false);
                }else if(hadColors || hadEffect || (hadPower && power)){
                    ble.setScene(targets,effect,colors,speed,false,brightness);
                }else if(hadBrightness){
                    ble.setBrightness(targets,brightness);
                }else if(hadSpeed){
                    ble.setEffect(targets,effect,colors,speed,false);
                }
            } catch(Throwable t) {
                host.onBridgeStatus("Eufy control failed: "+t.getMessage());
            }
        });
        return ok(stateJson());
    }

    private String resume() throws Exception {
        prefs.edit().putBoolean("manual_override",false).apply();
        AndersonScheduleService.update(context);
        AndersonSchedule.Scene scene=schedule.resolveNow();
        List<BleLightController.FoundLight> all=allInstalled();
        host.runOnUi(() -> {
            if(scene==null) ble.setPower(all,false);
            else ble.setScene(all,scene.effect,scene.colors,scene.speed,false,scene.brightness);
        });
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
        out.put("overlap","Anderson priority and overlap rules are active.");
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
            return ok(new JSONObject().put("ok",true));
        }
        if(!id.isEmpty()&&in.has("enabled")){
            JSONObject x=findById(a,id); if(x==null)return error(404,"Unknown custom schedule");
            x.put("enabled",in.optBoolean("enabled",true)); writeArray("custom_schedules",a);
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
        long now=System.currentTimeMillis();
        // First request starts a 12-second scan. Polls during the scan return
        // scanning=true; the first polls immediately after completion return false
        // rather than accidentally starting a second scan.
        if(scanUntilMs==0L || now>scanUntilMs+3000L){
            scanUntilMs=now+12000L;
            host.requestBlePermissionsAndScan();
        }
        JSONArray devices=new JSONArray();
        for(BleLightController.FoundLight f:snapshotDiscovered()){
            String address=safeAddress(f.device);
            if(!DeviceStore.isInstalledAddress(address))continue;
            devices.put(new JSONObject().put("name",f.name).put("address",address).put("rssi",f.rssi).put("model",f.model).put("serial",f.serial));
        }
        return new JSONObject().put("scanning",System.currentTimeMillis()<scanUntilMs).put("devices",devices);
    }

    private String bleSelect(JSONObject in) throws Exception {
        String address=in.optString("address","").toUpperCase(Locale.ROOT);
        int index=indexOfAddress(address);
        if(index<0)return error(400,"Only Pool, House, Garage and Shed are supported");
        prefs.edit().putInt("ble_target",index+1).apply();
        return ok(new JSONObject().put("ok",true).put("target",index+1));
    }

    private String bleTarget(JSONObject in) throws Exception {
        int target=in.optInt("target",0);
        if(target<0||target>4)target=0;
        prefs.edit().putInt("ble_target",target).apply();
        return ok(stateJson());
    }

    private JSONObject authStatus() throws Exception {
        boolean enabled=prefs.getBoolean("pin_enabled",false);
        boolean configured=hasPin("shirley")&&hasPin("kelly")&&hasPin("jason");
        return new JSONObject().put("pinEnabled",enabled).put("configured",configured).put("kellyConfigured",hasPin("kelly"));
    }

    private String authUnlock(JSONObject in) throws Exception {
        String profile=in.optString("profile","").toLowerCase(Locale.ROOT);
        String pin=in.optString("pin","");
        if(!prefs.getBoolean("pin_enabled",false)){
            return ok(new JSONObject().put("ok",true).put("pinEnabled",false).put("role","jason".equals(profile)?"admin":"user").put("name",displayProfile(profile)));
        }
        if(!hashPin(profile,pin).equals(prefs.getString("pin_"+profile,"")))return error(401,"Incorrect four-digit PIN");
        return ok(new JSONObject().put("ok",true).put("pinEnabled",true).put("token",UUID.randomUUID().toString())
            .put("role","jason".equals(profile)?"admin":"user").put("name",displayProfile(profile)).put("expiresIn",3600));
    }

    private String authConfig(JSONObject in) throws Exception {
        if(!in.optBoolean("enabled",true)){
            prefs.edit().putBoolean("pin_enabled",false).apply();
            return ok(new JSONObject().put("ok",true).put("pinEnabled",false));
        }
        String s=in.optString("shirleyPin",""),k=in.optString("kellyPin",""),j=in.optString("jasonPin","");
        if(!fourDigits(s)||!fourDigits(k)||!fourDigits(j)||s.equals(k)||s.equals(j)||k.equals(j))
            return error(400,"All three PINs must be different four-digit values");
        prefs.edit().putString("pin_shirley",hashPin("shirley",s)).putString("pin_kelly",hashPin("kelly",k))
            .putString("pin_jason",hashPin("jason",j)).putBoolean("pin_enabled",true).apply();
        return ok(new JSONObject().put("ok",true).put("pinEnabled",true).put("configured",true).put("kellyConfigured",true).put("token",UUID.randomUUID().toString()));
    }

    private String authPin(JSONObject in) throws Exception {
        String profile=in.optString("profile","").toLowerCase(Locale.ROOT);
        String pin=in.optString("pin","");
        if(!Arrays.asList("shirley","kelly","jason").contains(profile)||!fourDigits(pin))return error(400,"PIN must contain exactly four digits");
        prefs.edit().putString("pin_"+profile,hashPin(profile,pin)).apply();
        JSONObject o=new JSONObject().put("ok",true).put("pinEnabled",prefs.getBoolean("pin_enabled",false))
            .put("configured",hasPin("shirley")&&hasPin("kelly")&&hasPin("jason")).put("kellyConfigured",hasPin("kelly"));
        if("jason".equals(profile))o.put("token",UUID.randomUUID().toString());
        return ok(o);
    }

    private JSONObject systemJson() throws Exception {
        Runtime rt=Runtime.getRuntime();
        long free=rt.freeMemory(),total=rt.totalMemory();
        return new JSONObject()
            .put("cpuLoad",0).put("cpuMhz",0).put("wifiConnected",true).put("rssi",0)
            .put("heapFree",free).put("heapMin",free).put("heapLargest",free)
            .put("slotBytes",0).put("appBytes",0).put("appFreeBytes",0)
            .put("uptimeMs",android.os.SystemClock.elapsedRealtime()).put("version","5.0.0")
            .put("bleCount",snapshotDiscovered().size()).put("ssid","Android").put("ip","Local")
            .put("resetReason","Android app launch").put("loopWatchdog",true).put("networkRestarts",0)
            .put("nextReboot","—").put("nextRebootSeconds",-1)
            .put("rebootSchedule","Android managed");
    }

    private JSONObject firmwareJson() throws Exception {
        return new JSONObject().put("runningPartition","Android").put("nextPartition","Android")
            .put("version","Jason Home 5.0.0").put("buildCommit","Anderson 3.1.58 UI")
            .put("slotSize",0).put("previousAvailable",false);
    }

    private JSONObject remoteUpdateJson() throws Exception {
        return new JSONObject().put("autoCheckSecondsRemaining",0).put("autoCheckMinutes",0)
            .put("updateHold",false).put("operationId",0).put("operationComplete",true).put("phase","APK upgrades");
    }

    private List<BleLightController.FoundLight> targets() {
        int t=prefs.getInt("ble_target",0);
        if(t<=0)return allInstalled();
        int idx=t-1;
        ArrayList<BleLightController.FoundLight> a=new ArrayList<>();
        if(idx>=0&&idx<4)a.add(installed(idx));
        return a;
    }

    private List<BleLightController.FoundLight> allInstalled() {
        ArrayList<BleLightController.FoundLight> a=new ArrayList<>();
        for(int i=0;i<4;i++)a.add(installed(i));
        return a;
    }

    @SuppressLint("MissingPermission")
    private BleLightController.FoundLight installed(int i) {
        BluetoothManager bm=(BluetoothManager)context.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter=bm==null?null:bm.getAdapter();
        BluetoothDevice d=adapter==null?null:adapter.getRemoteDevice(ADDRESSES[i]);
        String serial=deviceStore.serialFor(ADDRESSES[i],"");
        return new BleLightController.FoundLight(d,NAMES[i],-100,MODELS[i],serial);
    }

    private List<BleLightController.FoundLight> snapshotDiscovered() {
        synchronized(scanLock){return new ArrayList<>(discovered);}
    }

    private boolean isDiscovered(String address) {
        for(BleLightController.FoundLight f:snapshotDiscovered())if(address.equalsIgnoreCase(safeAddress(f.device)))return true;
        return false;
    }

    @SuppressLint("MissingPermission")
    private static String safeAddress(BluetoothDevice d) {
        try{return d==null?"":d.getAddress();}catch(Throwable t){return "";}
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
    private static String clockMinutes(int v){v=((v%1440)+1440)%1440;return String.format(Locale.ROOT,"%02d:%02d",v/60,v%60);}
    private static String displayMinutes(int v){v=((v%1440)+1440)%1440;int h=v/60,m=v%60;String ap=h>=12?"PM":"AM";h%=12;if(h==0)h=12;return String.format(Locale.ROOT,"%d:%02d %s",h,m,ap);}
    private static String overlapString(int v){return v==2?"combine":v==1?"rotate":"priority";}
    private static int parseOverlap(String v){return "combine".equals(v)?2:"rotate".equals(v)?1:0;}
    private static String themeName(String t){return "1".equals(t)?"Major U.S. Holidays — Basic Colors":"3.0.28".equals(t)?"Expanded Holidays — Basic Colors":"Expanded Holidays — Expanded Colors";}
    private static int indexOfAddress(String address){for(int i=0;i<ADDRESSES.length;i++)if(ADDRESSES[i].equalsIgnoreCase(address))return i;return -1;}
    private static boolean fourDigits(String s){return s!=null&&s.matches("\\d{4}");}
    private boolean hasPin(String p){return !prefs.getString("pin_"+p,"").isEmpty();}
    private static String displayProfile(String p){return "shirley".equals(p)?"Shirley":"kelly".equals(p)?"Kelly":"Jason";}

    private static String hashPin(String profile,String pin) {
        try{
            MessageDigest d=MessageDigest.getInstance("SHA-256");
            byte[] b=d.digest(("JasonHomeAnderson|"+profile+"|"+pin).getBytes(StandardCharsets.UTF_8));
            StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format(Locale.ROOT,"%02x",x&255));return s.toString();
        }catch(Throwable t){return profile+"|"+pin;}
    }
}

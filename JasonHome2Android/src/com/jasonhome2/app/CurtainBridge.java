package com.jasonhome2.app;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Arrays;
import java.util.UUID;

/** Isolated SmartDawn DN5E58 native GATT transport. Never controls the Eufy strings. */
public final class CurtainBridge {
    public static final int PERMISSIONS_REQUEST = 74;
    private static final String DEVICE_NAME = "DN5E58";
    private static final String HOST = "150.136.245.51";
    private static final UUID SERVICE = UUID.fromString("00000074-1972-1925-3022-077119514e44");
    private static final UUID WRITE = UUID.fromString("01020074-1972-1925-3022-077119514e44");
    private static final UUID HEARTBEAT = UUID.fromString("02020074-1972-1925-3022-077119514e44");
    // Catalog ids 55–87 are *not* a continuous SmartDawn group sequence;
    // these exact identifiers were captured on 2026-10-11.
    private static final int[] CAPTURED_PATTERN_GROUPS = {
        15193,15194,15195,15196,15197,15198,15199,15200,15201,15202,15203,
        15204,15205,15206,15207,15208,15209,15210,15211,15212,15213,15214,
        15215,15216,15217,15218,15219,15220,15221,15222,15224,15225,83494
    };
    private static final int[] CAPTURED_PATTERN_INDEXES = {
        0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,
        17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,33
    };
    private static final int GATT_SUCCESS = 0;
    private final Activity activity;
    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writer;
    private BluetoothGattCharacteristic heartbeat;
    private BluetoothDevice candidate;
    private boolean ready;
    private boolean scanning;
    private int attempts;
    private int generation;
    private int seq = 1, tx = 1;
    private String connectId;
    private String permissionId;
    private boolean pendingManualScan;
    private boolean manualDiscovery;
    private String requestedAddress = "";
    private final LinkedHashMap<String,BluetoothDevice> discovered = new LinkedHashMap<>();
    private final LinkedHashMap<String,String> discoveredNames = new LinkedHashMap<>();
    private final LinkedHashMap<String,Integer> discoveredRssi = new LinkedHashMap<>();
    private final ArrayDeque<Frame> frames = new ArrayDeque<>();
    private Frame writing;
    private Runnable writeTimeout;
    private Runnable connectTimeout;
    private boolean sequenceRunning=false;
    private int[] sequenceEffects=new int[0];
    private int sequencePosition=0;
    private long sequenceIntervalMs=60000L;
    private Runnable sequenceTask;
    private void stopSequence() {
        sequenceRunning=false;
        if(sequenceTask!=null)main.removeCallbacks(sequenceTask);
        sequenceTask=null;
        sequenceEffects=new int[0];
        sequencePosition=0;
    }
    private void queueNativeEffect(int num,String callbackId) {
        int group=num<55?15924:CAPTURED_PATTERN_GROUPS[num-55];
        int index=num<55?num:CAPTURED_PATTERN_INDEXES[num-55];
        frames.add(new Frame(frame(0x096a,new byte[0]),false,null));
        byte[] groupBytes=varint(group),indexBytes=varint(index);
        byte[] payload=new byte[2+groupBytes.length+indexBytes.length];
        int n=0;payload[n++]=8;for(byte b:groupBytes)payload[n++]=b;
        payload[n++]=16;for(byte b:indexBytes)payload[n++]=b;
        frames.add(new Frame(frame(0x0a2e,payload),false,callbackId));
        writeNext();
    }
    private void sequenceStep(){
        if(!sequenceRunning||!ready||gatt==null){stopSequence();return;}
        if(writing!=null||!frames.isEmpty()){
            sequenceTask=this::sequenceStep;
            main.postDelayed(sequenceTask,250);
            return;
        }
        int effect=sequenceEffects[sequencePosition%sequenceEffects.length];
        sequencePosition=(sequencePosition+1)%sequenceEffects.length;
        queueNativeEffect(effect,null);
        sequenceTask=this::sequenceStep;
        main.postDelayed(sequenceTask,sequenceIntervalMs);
    }
    private final Runnable heartTask = new Runnable() {
        @Override public void run() {
            if (ready && heartbeat != null && frames.isEmpty() && writing == null) {
                frames.add(new Frame(new byte[4], true, null));
                writeNext();
            }
            main.postDelayed(this, 6000);
        }
    };

    private static final class Frame {
        final byte[] bytes;
        final boolean useHeartbeat;
        final String completionId;
        Frame(byte[] bytes, boolean hb, String id) { this.bytes=bytes; useHeartbeat=hb; completionId=id; }
    }

    public CurtainBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        main.postDelayed(heartTask,6000);
    }

    /** JavascriptInterface is exposed only in the trusted top-level Oracle-hosted WebView. */
    @JavascriptInterface public void call(String id, String action, String payload) {
        if (id == null || id.length()>48 || action == null || action.length()>30) return;
        main.post(() -> {
            android.net.Uri origin = android.net.Uri.parse(web.getUrl()==null?"":web.getUrl());
            if (!"https".equals(origin.getScheme()) || !HOST.equals(origin.getHost()) ||
                origin.getPath()==null || !origin.getPath().startsWith("/jason-home-2/")) {
                finish(id,false,"Unexpected page origin",false);return;
            }
            try { execute(id,action,new JSONObject(payload==null?"{}":payload)); }
            catch (Throwable t) { finish(id,false,"Curtain command error: "+t.getMessage(),ready); }
        });
    }

    private void finish(String id,boolean ok,String message,boolean connected) {
        if (id==null) return;
        JSONObject reply = new JSONObject();
        try { reply.put("ok",ok); reply.put("message",message); reply.put("error",ok?JSONObject.NULL:message); reply.put("connected",connected); reply.put("devices",discoveredJson()); reply.put("sequenceRunning",sequenceRunning); reply.put("sequenceIntervalSeconds",sequenceIntervalMs/1000); reply.put("sequenceCount",sequenceEffects.length); }
        catch(Exception ignored) { }
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__curtainNativeResult&&window.__curtainNativeResult(" +
                JSONObject.quote(id) + "," + reply.toString() + ");",null);
        });
    }

    private JSONArray discoveredJson() {
        JSONArray output = new JSONArray();
        int n = 0;
        for (Map.Entry<String,BluetoothDevice> entry: discovered.entrySet()) {
            if (n++ >= 40) break;
            JSONObject item = new JSONObject();
            try {
                String address=entry.getKey();
                item.put("address",address);
                item.put("name",discoveredNames.containsKey(address)?discoveredNames.get(address):"Unnamed BLE device");
                item.put("rssi",discoveredRssi.containsKey(address)?discoveredRssi.get(address):JSONObject.NULL);
            } catch(Exception ignored){}
            output.put(item);
        }
        return output;
    }
    private static boolean isSmartDawn(String name) {
        if(name==null)return false;
        String n=name.trim().toUpperCase(java.util.Locale.ROOT).replace(" ","");
        return n.contains(DEVICE_NAME) || n.contains("SMARTDAWN") || n.startsWith("DNX:");
    }
    private void remember(BluetoothDevice dev,String name,int rssi) {
        if(dev==null)return;
        try {
            String address=dev.getAddress();
            if(address==null||address.length()!=17)return;
            if(!discovered.containsKey(address)&&discovered.size()>=40)return;
            discovered.put(address,dev);
            if(name!=null&&!name.isEmpty())discoveredNames.put(address,name);
            discoveredRssi.put(address,rssi);
        } catch(SecurityException ignored){}
    }
    private BluetoothDevice matchingBonded(BluetoothAdapter adapter,String requested) {
        try {
            for(BluetoothDevice d:adapter.getBondedDevices()) {
                String name=d.getName();
                remember(d,name,-127);
                if(!requested.isEmpty()&&requested.equalsIgnoreCase(d.getAddress()))return d;
                if(requested.isEmpty()&&isSmartDawn(name))return d;
            }
        } catch(Throwable ignored){}
        return null;
    }
    private String knownAddress() {
        return activity.getPreferences(Context.MODE_PRIVATE).getString("smartdawn_validated_address","");
    }

    private String[] missingPermissions() {
        ArrayList<String> missing = new ArrayList<>();
        if (Build.VERSION.SDK_INT>=31) {
            if (activity.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)!=PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.BLUETOOTH_SCAN);
            if (activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.BLUETOOTH_CONNECT);
        } else if (Build.VERSION.SDK_INT>=23) {
            if (activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        return missing.toArray(new String[0]);
    }

    private void execute(String id,String action,JSONObject json) {
        if ("status".equals(action)) {finish(id,true,ready?"Connected to DN5E58":"Not connected",ready);return;}
        if ("scan".equals(action)) {
            if(ready){finish(id,true,"Already connected to the curtain",true);return;}
            String[] missing=missingPermissions();
            if(missing.length>0){permissionId=id;pendingManualScan=true;activity.requestPermissions(missing,PERMISSIONS_REQUEST);return;}
            beginConnect(id,"",true);return;
        }
        if ("disconnect".equals(action)) { disconnectInternal();finish(id,true,"Disconnected",false);return; }
        if ("connect".equals(action)) {
            if (ready) { finish(id,true,"Connected to DN5E58",true);return; }
            String address=json.optString("address","").trim().toUpperCase(java.util.Locale.ROOT);
            if(!address.isEmpty()&&!address.matches("(?i)[0-9A-F]{2}(:[0-9A-F]{2}){5}")) {
                finish(id,false,"Invalid Bluetooth address",false);return;
            }
            String[] missing = missingPermissions();
            if (missing.length>0) { permissionId=id;pendingManualScan=false;requestedAddress=address;activity.requestPermissions(missing,PERMISSIONS_REQUEST);return; }
            beginConnect(id,address,false);return;
        }
        if (!ready || writer==null || gatt==null) {finish(id,false,"Not connected: tap Connect first",false);return;}
        if("sequenceStop".equals(action)){
            stopSequence();
            finish(id,true,"Effect sequence stopped",ready);
            return;
        }
        if("sequenceStart".equals(action)){
            if(!ready){finish(id,false,"Connect to the curtain first",false);return;}
            JSONArray ids=json.optJSONArray("effects");
            int seconds=json.optInt("intervalSeconds",-1);
            if(ids==null||ids.length()<2||ids.length()>88||seconds<5||seconds>3600)
                throw new IllegalArgumentException("Select 2–88 captured effects, interval 5–3600 seconds");
            int[] chosen=new int[ids.length()];
            for(int i=0;i<chosen.length;i++){
                chosen[i]=ids.optInt(i,-1);
                if(chosen[i]<0||chosen[i]>87)
                    throw new IllegalArgumentException("Sequence effect must be E-0 through E-87");
                for(int j=0;j<i;j++)if(chosen[j]==chosen[i])
                    throw new IllegalArgumentException("Sequence effect repeated: E-"+chosen[i]);
            }
            stopSequence();
            sequenceEffects=chosen;sequenceIntervalMs=seconds*1000L;sequenceRunning=true;
            sequenceStep();
            finish(id,true,"Playing "+chosen.length+" effects, "+seconds+" seconds each",true);
            return;
        }
        switch(action) {
            case "power": addCommand(json.optBoolean("value")?0x09d2:0x09d3,new byte[0],id); break;
            case "brightness": {
                int percent = validatePct(json.optInt("value",-1));
                addCommand(0x09cd,field(Math.round(percent*255f/100f)),id);break;
            }
            case "speed": {int level=validatePct(json.optInt("value",-1));addCommand(0x09db,field(nativeSpeedFromUi(level)),id);break;}
            case "layout": {
                int v=json.optInt("value",-1);
                if (v!=0 && v!=4 && v!=5 && v!=6) throw new IllegalArgumentException("Unknown layout value");
                addCommand(0x09c6,field(v),id);break;
            }
            case "effect": {
                int num=json.optInt("id",-1);if(num<0||num>87)throw new IllegalArgumentException("Effect must be E-0 to E-87");
                stopSequence(); // A manually chosen effect cancels automatic sequence.
                queueNativeEffect(num,id);break;
            }
            default: finish(id,false,"Unknown curtain command: "+action,ready);break;
        }
    }

    /** Curtain controller values 1–3 extinguish LEDs; UI 1 maps to safe raw 4. */
    static int nativeSpeedFromUi(int ui) {
        if(ui<1||ui>100)throw new IllegalArgumentException("Curtain speed must be 1–100");
        return Math.max(4,Math.min(100,4+Math.round((ui-1)*96f/99f)));
    }
    private static int validatePct(int v) { if(v<1||v>100)throw new IllegalArgumentException("Setting must be 1–100%");return v; }
    private static byte[] varint(int v) {
        byte[] out = new byte[5];int i=0;
        do {int next=v>>>7;out[i++]=(byte)((v&127)|(next!=0?128:0));v=next;}while(v!=0&&i<5);
        return Arrays.copyOf(out,i);
    }
    private static byte[] field(int value) {byte[] n=varint(value);byte[] p=new byte[1+n.length];p[0]=8;System.arraycopy(n,0,p,1,n.length);return p;}
    private byte[] frame(int opcode,byte[] payload) {
        byte[] out=new byte[24+payload.length];
        out[0]=(byte)seq;out[1]=1;out[4]=(byte)0xf0;out[5]=4;
        out[6]=(byte)(tx>>>8);out[7]=(byte)tx;
        out[10]=(byte)(opcode>>>8);out[11]=(byte)opcode;
        System.arraycopy(payload,0,out,24,payload.length);
        seq=(seq+1)&255;tx=(tx+1)&65535;return out;
    }
    private void addCommand(int opcode,byte[] payload,String id) {frames.add(new Frame(frame(opcode,payload),false,id));writeNext();}

    public void onPermissionsResult(int code,String[] names,int[] results) {
        if(code!=PERMISSIONS_REQUEST)return;
        main.post(() -> {
            String id=permissionId;permissionId=null;
            if (id==null) return;
            for(int grant:results)if(grant!=PackageManager.PERMISSION_GRANTED) {finish(id,false,"Bluetooth permissions denied. Allow Nearby devices in Android Settings.",false);return;}
            if(missingPermissions().length>0){finish(id,false,"Bluetooth permissions still missing",false);return;}
            beginConnect(id,requestedAddress,pendingManualScan);
            pendingManualScan=false;requestedAddress="";
        });
    }

    private void beginConnect(String id,String address,boolean scanOnly) {
        // Explicit selection is allowed only from a prior discovery, or a bonded device.
        BluetoothDevice selected=null;
        if(!address.isEmpty()){
            selected=discovered.get(address);
            if(selected==null){
                BluetoothManager manager=(BluetoothManager)activity.getSystemService(Context.BLUETOOTH_SERVICE);
                BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
                if(adapter!=null)selected=matchingBonded(adapter,address);
            }
            if(selected==null){finish(id,false,"Device not found in recent scan. Tap Scan devices and select it.",false);return;}
        }
        disconnectInternal();
        if(scanOnly||address.isEmpty())discovered.clear();
        connectId=id;attempts=0;seq=1;tx=1;manualDiscovery=scanOnly;requestedAddress=address;
        if(selected!=null){final int gen=++generation;candidate=selected;connectDevice(gen,selected);}
        else scanFresh();
    }
    private void scanFresh() {
        final int gen=++generation;
        final BluetoothManager manager=(BluetoothManager)activity.getSystemService(Context.BLUETOOTH_SERVICE);
        final BluetoothAdapter adapter=manager==null?null:manager.getAdapter();
        if(adapter==null||!adapter.isEnabled()) {failConnection("Turn on Bluetooth, then try Connect.");return;}
        if(missingPermissions().length>0){failConnection("Nearby devices permission required");return;}
        stopScan();closeGatt();ready=false;writer=null;heartbeat=null;candidate=null;
        // Android Settings may show a bonded/cached name when the current BLE
        // advertisement has no local name. Check that trusted Android cache first.
        BluetoothDevice bonded=matchingBonded(adapter,requestedAddress);
        if(!manualDiscovery&&bonded!=null){candidate=bonded;connectDevice(gen,bonded);return;}
        scanner=adapter.getBluetoothLeScanner();
        if(scanner==null){failConnection("Android Bluetooth scanner unavailable");return;}
        scanning=true;
        scanCallback=new ScanCallback() {
            @Override public void onScanResult(int type,ScanResult result) {
                main.post(()->{
                    if(gen!=generation||!scanning||result==null)return;
                    BluetoothDevice dev=result.getDevice();
                    String name=result.getScanRecord()==null?null:result.getScanRecord().getDeviceName();
                    if((name==null||name.isEmpty())&&dev!=null){try{name=dev.getName();}catch(SecurityException ignored){}}
                    remember(dev,name,result.getRssi());
                    String address=dev==null?"":dev.getAddress();
                    boolean known=!knownAddress().isEmpty()&&knownAddress().equalsIgnoreCase(address);
                    boolean chosen=!requestedAddress.isEmpty()&&requestedAddress.equalsIgnoreCase(address);
                    if(!manualDiscovery && dev!=null && (chosen||known||isSmartDawn(name))) {
                        candidate=dev;stopScan();connectDevice(gen,dev);
                    }
                });
            }
            @Override public void onScanFailed(int errorCode) {
                main.post(()->{if(gen==generation)failConnection("Bluetooth scan failed: "+errorCode);});
            }
        };
        try {
            scanner.startScan(null,new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),scanCallback);
        } catch(Throwable e) {failConnection("Scan could not start: "+e.getMessage());return;}
        scheduleConnectTimeout(18000,()->{
            if(gen!=generation||!scanning)return;
            stopScan();
            if(manualDiscovery){
                String id=connectId;connectId=null;
                finish(id,true,discovered.isEmpty()?
                    "No BLE devices advertised. Check Nearby devices permission and close SmartDawn.":
                    discovered.size()+" BLE devices found. Select DN5E58 from the list.",false);
            }else{
                failConnection("DN5E58 not in the BLE scan ("+discovered.size()+" devices detected). Tap Scan devices to choose the curtain or a paired device.");
            }
        });
    }
    private void connectDevice(int gen,BluetoothDevice device) {
        attempts++;
        scheduleConnectTimeout(14000,()->{if(gen==generation)retryOrFail("Bluetooth connection timed out");});
        try {
            // autoConnect=false + TRANSPORT_LE, after a fresh scan, avoids a stale cached GATT route.
            gatt=device.connectGatt(activity,false,new BluetoothGattCallback(){
                @Override public void onConnectionStateChange(BluetoothGatt which,int status,int newState) {
                    main.post(()->{
                        if(gen!=generation||which!=gatt)return;
                        if(status==GATT_SUCCESS&&newState==android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                            try {if(!which.discoverServices())retryOrFail("Service discovery could not start");}
                            catch(Throwable t){retryOrFail("Service discovery: "+t.getMessage());}
                        } else if(status!=GATT_SUCCESS || newState==android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
                            retryOrFail("Android Bluetooth GATT "+status+(status==200?" (connection lost)":""));
                        }
                    });
                }
                @Override public void onServicesDiscovered(BluetoothGatt which,int status) {
                    main.post(()->{
                        if(gen!=generation||which!=gatt)return;
                        if(status!=GATT_SUCCESS){retryOrFail("GATT service discovery "+status);return;}
                        BluetoothGattService svc=which.getService(SERVICE);
                        writer=svc==null?null:svc.getCharacteristic(WRITE);
                        heartbeat=svc==null?null:svc.getCharacteristic(HEARTBEAT);
                        if(writer==null){retryOrFail("SmartDawn write characteristic unavailable");return;}
                        cancelConnectTimeout();ready=true;
                        try{activity.getPreferences(Context.MODE_PRIVATE).edit().putString("smartdawn_validated_address",which.getDevice().getAddress()).apply();}catch(Throwable ignored){}
                        String id=connectId;connectId=null;
                        finish(id,true,"Connected to DN5E58",true);
                        // Read-only discovery first; do not send surprise power/effect commands on connect.
                    });
                }
                @Override public void onCharacteristicWrite(BluetoothGatt which,BluetoothGattCharacteristic ch,int status) {
                    main.post(()->{
                        if(gen!=generation||which!=gatt||writing==null)return;
                        Frame completed=writing;writing=null;
                        clearWriteTimeout();
                        if(status!=GATT_SUCCESS){
                            failPending("Curtain write failed (GATT "+status+")",completed.completionId);
                        } else { finish(completed.completionId,true,"Command delivered over Bluetooth",ready);writeNext(); }
                    });
                }
            }, BluetoothDevice.TRANSPORT_LE);
            if(gatt==null)retryOrFail("connectGatt returned no connection");
        } catch(Throwable t) {retryOrFail("Bluetooth connect failed: "+t.getMessage());}
    }
    private void scheduleConnectTimeout(long ms,Runnable action) {
        cancelConnectTimeout();connectTimeout=action;main.postDelayed(action,ms);
    }
    private void cancelConnectTimeout(){if(connectTimeout!=null)main.removeCallbacks(connectTimeout);connectTimeout=null;}
    private void retryOrFail(String reason) {
        if(connectId==null) {disconnectInternal();return;}
        cancelConnectTimeout();stopScan();closeGatt();ready=false;
        // One fresh scan/GATT retry for Android statuses 133, 62 and 200, never autoConnect.
        if(attempts<2)main.postDelayed(this::scanFresh,900);
        else failConnection(reason+" after retry. Close SmartDawn and toggle Bluetooth before retrying.");
    }
    private void failConnection(String reason) {
        String id=connectId;connectId=null;
        disconnectInternal();finish(id,false,reason,false);
    }
    private void writeNext() {
        if(writing!=null||frames.isEmpty()||gatt==null||!ready)return;
        Frame f=frames.poll();BluetoothGattCharacteristic target=f.useHeartbeat?heartbeat:writer;
        if(target==null){finish(f.completionId,false,"Bluetooth write characteristic missing",ready);return;}
        writing=f;
        try {
            target.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            target.setValue(f.bytes);
            if(!gatt.writeCharacteristic(target)) {
                writing=null;failPending("Bluetooth write rejected by Android",f.completionId);return;
            }
            writeTimeout=()->{if(writing==f){writing=null;failPending("Bluetooth write timed out",f.completionId);}};
            main.postDelayed(writeTimeout,6500);
        }catch(Throwable t){writing=null;failPending("Bluetooth write exception: "+t.getMessage(),f.completionId);}
    }
    private void failPending(String reason,String firstId) {
        finish(firstId,false,reason,ready);
        for(Frame f:frames)finish(f.completionId,false,reason,ready);
        frames.clear();
    }
    private void clearWriteTimeout(){if(writeTimeout!=null)main.removeCallbacks(writeTimeout);writeTimeout=null;}
    private void stopScan() {
        if(scanner!=null&&scanCallback!=null)try{scanner.stopScan(scanCallback);}catch(Throwable ignored){}
        scanner=null;scanCallback=null;scanning=false;
    }
    private void closeGatt(){
        BluetoothGatt old=gatt;gatt=null;
        if(old!=null){try{old.disconnect();}catch(Throwable ignored){}try{old.close();}catch(Throwable ignored){}}
    }
    private void disconnectInternal(){
        stopSequence();
        generation++;cancelConnectTimeout();clearWriteTimeout();stopScan();closeGatt();
        ready=false;writer=null;heartbeat=null;candidate=null;connectId=null;
        if(writing!=null)finish(writing.completionId,false,"Bluetooth disconnected",false);
        for(Frame f:frames)finish(f.completionId,false,"Bluetooth disconnected",false);
        writing=null;frames.clear();
    }
    public void close(){main.removeCallbacks(heartTask);disconnectInternal();}
}
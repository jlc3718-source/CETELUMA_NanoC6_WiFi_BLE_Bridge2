package com.jasonhome.app;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.BluetoothStatusCodes;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

final class BleLightController {
    interface Listener {
        void onScanChanged(List<FoundLight> items);
        void onStatus(String message);
        void onProgress(int done, int total);
    }

    static final class FoundLight {
        final BluetoothDevice device;
        final String name;
        final int rssi;
        final String model;
        final String serial;

        FoundLight(BluetoothDevice device, String name, int rssi, String model, String serial) {
            this.device = device;
            this.name = name;
            this.rssi = rssi;
            this.model = model;
            this.serial = serial;
        }

        boolean controllable() {
            return serial != null && serial.length() == 16;
        }
    }

    private enum Kind { POWER, BRIGHTNESS, COLOR, WHITE, EFFECT, SCENE, DIAGNOSTIC }

    private static final class Job {
        final FoundLight light;
        final Kind kind;
        final boolean on;
        final int value;
        final int rgb;
        final String effect;
        final int[] colors;
        final int speed;
        final boolean reverse;

        private Job(FoundLight light, Kind kind, boolean on, int value, int rgb,
                    String effect, int[] colors, int speed, boolean reverse) {
            this.light=light; this.kind=kind; this.on=on; this.value=value; this.rgb=rgb;
            this.effect=effect; this.colors=colors; this.speed=speed; this.reverse=reverse;
        }
        static Job power(FoundLight l, boolean on){ return new Job(l,Kind.POWER,on,0,0,null,null,0,false); }
        static Job brightness(FoundLight l,int v){ return new Job(l,Kind.BRIGHTNESS,false,v,0,null,null,0,false); }
        static Job color(FoundLight l,int rgb){ return new Job(l,Kind.COLOR,false,0,rgb,null,null,0,false); }
        static Job white(FoundLight l,int kelvin){ return new Job(l,Kind.WHITE,false,kelvin,0,null,null,0,false); }
        static Job effect(FoundLight l,String e,int[] colors,int speed,boolean reverse){
            return new Job(l,Kind.EFFECT,false,0,0,e,colors,speed,reverse);
        }
        static Job scene(FoundLight l,String e,int[] colors,int speed,boolean reverse,int brightness){
            return new Job(l,Kind.SCENE,false,brightness,0,e,colors,speed,reverse);
        }
        static Job diagnostic(FoundLight l){
            return new Job(l,Kind.DIAGNOSTIC,false,0,0,null,null,0,false);
        }
    }

    private static final UUID SERVICE_ID = UUID.fromString("8c850001-0302-41c5-b46e-cf057c562025");
    private static final UUID WRITE_ID = UUID.fromString("8c850002-0302-41c5-b46e-cf057c562025");
    private static final UUID NOTIFY_ID = UUID.fromString("8c850003-0302-41c5-b46e-cf057c562025");
    private static final UUID CCCD_ID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    private final Context context;
    private final DeviceStore store;
    private final Listener listener;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final BluetoothManager manager;
    private final Map<String, FoundLight> found = new LinkedHashMap<>();
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private final Map<String, ParallelWorker> workers = new LinkedHashMap<>();
    private long parallelToken = 0;

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private E10Probe probe;
    private Job active;
    private Runnable timeout;
    private int totalJobs;
    private int processedJobs;
    private int successfulJobs;
    private boolean commandSent;
    private String legacyStage = "idle";
    private String lastFailure = "";
    private int connectionRetryCount = 0;
    private int handshakeResponseRetryCount = 0;

    BleLightController(Context context, DeviceStore store, Listener listener) {
        this.context = context;
        this.store = store;
        this.listener = listener;
        this.manager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
    }

    @SuppressLint("MissingPermission")
    void startScan() {
        found.clear();
        listener.onScanChanged(Collections.emptyList());
        if (manager == null || manager.getAdapter() == null || manager.getAdapter().getBluetoothLeScanner() == null) {
            listener.onStatus("Bluetooth LE is unavailable.");
            return;
        }
        listener.onStatus("Scanning only Pool, House, Garage and Shed");
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        ArrayList<ScanFilter> filters = new ArrayList<>();
        for (String mac : DeviceStore.installedAddresses()) {
            filters.add(new ScanFilter.Builder().setDeviceAddress(mac).build());
        }
        manager.getAdapter().getBluetoothLeScanner().startScan(filters, settings, scanCallback);
        handler.postDelayed(this::stopScan, 12000L);
    }

    @SuppressLint("MissingPermission")
    void stopScan() {
        try {
            if (manager != null && manager.getAdapter() != null && manager.getAdapter().getBluetoothLeScanner() != null) {
                manager.getAdapter().getBluetoothLeScanner().stopScan(scanCallback);
            }
        } catch (Throwable ignored) {}
        listener.onStatus("Scan complete - " + found.size() + "/4 installed Eufy lights found");
    }

    List<FoundLight> discovered() {
        return new ArrayList<>(found.values());
    }

    void setPower(List<FoundLight> targets, boolean on) {
        enqueue(targets, item -> Job.power(item,on));
    }

    void setBrightness(List<FoundLight> targets, int percent) {
        int v=Math.max(0,Math.min(100,percent));
        enqueue(targets, item -> Job.brightness(item,v));
    }

    void setColor(List<FoundLight> targets, int rgb) {
        int v=rgb & 0xFFFFFF;
        enqueue(targets, item -> Job.color(item,v));
    }

    void setWhite(List<FoundLight> targets, int kelvin) {
        int v=Math.max(1500,Math.min(9000,kelvin));
        enqueue(targets, item -> Job.white(item,v));
    }

    void setEffect(List<FoundLight> targets, String effect, int[] colors, int speed, boolean reverse) {
        int[] safe = colors == null || colors.length == 0 ? new int[]{0xFFFFFF} : colors.clone();
        enqueue(targets, item -> Job.effect(item,effect,safe,speed,reverse));
    }

    void setScene(List<FoundLight> targets, String effect, int[] colors, int speed, boolean reverse, int brightness) {
        int[] safe = colors == null || colors.length == 0 ? new int[]{0xFFFFFF} : colors.clone();
        int bright = Math.max(1, Math.min(100, brightness));
        enqueue(targets, item -> Job.scene(item,effect,safe,speed,reverse,bright));
    }

    void diagnoseSingle(FoundLight target) {
        if (target == null || target.device == null) {
            listener.onStatus("Diagnostic: no light selected.");
            return;
        }
        ArrayList<FoundLight> one = new ArrayList<>();
        one.add(target);
        listener.onStatus("Diagnostic: isolating " + displayName(target) + " only");
        startParallel(one, Job::diagnostic);
    }

    private interface Factory { Job make(FoundLight item); }

    private void enqueue(List<FoundLight> targets, Factory factory) {
        beginNewRequest();
        String account = store.accountId();
        if (account.length() != 40) {
            listener.onStatus("The 40-character Eufy account ID is unavailable.");
            return;
        }
        for (FoundLight item : targets) {
            String addr = address(item.device);
            if (!DeviceStore.isInstalledAddress(addr)) continue;
            String serial = store.serialFor(addr, item.name);
            if (serial.length() == 16) {
                FoundLight ready = new FoundLight(item.device,item.name,item.rssi,item.model,serial);
                queue.addLast(factory.make(ready));
            }
        }
        startQueuedRequest();
    }

    boolean isBusy() {
        synchronized (workers) {
            return !workers.isEmpty() || active != null || !queue.isEmpty();
        }
    }

    private void startParallel(List<FoundLight> targets, Factory factory) {
        cancelAllWork();
        if (store.accountId().length() != 40) {
            listener.onStatus("The 40-character Eufy account ID is unavailable.");
            return;
        }

        LinkedHashMap<String, Job> jobs = new LinkedHashMap<>();
        for (FoundLight item : targets) {
            if (item == null || item.device == null) continue;
            String addr = address(item.device);
            if (!DeviceStore.isInstalledAddress(addr)) continue;
            String serial = store.serialFor(addr, item.name);
            if (serial.length() != 16) continue;
            String model = item.model;
            if ((model == null || model.isEmpty()) && serial.startsWith("T8L00")) model = "E120";
            if ((model == null || model.isEmpty()) && serial.startsWith("T8L02")) model = "E22";
            FoundLight ready = new FoundLight(item.device,item.name,item.rssi,model,serial);
            String key = addr.isEmpty() ? serial : addr;
            jobs.put(key, factory.make(ready));
        }

        if (jobs.isEmpty()) {
            listener.onStatus("No Eufy lights with a usable 16-character serial are ready.");
            return;
        }

        try {
            if (manager != null && manager.getAdapter() != null && manager.getAdapter().getBluetoothLeScanner() != null) {
                manager.getAdapter().getBluetoothLeScanner().stopScan(scanCallback);
            }
        } catch (Throwable ignored) {}

        long token = ++parallelToken;
        totalJobs = jobs.size();
        processedJobs = 0;
        successfulJobs = 0;
        listener.onProgress(0,totalJobs);
        boolean diagnostic = jobs.size() == 1 && jobs.values().iterator().next().kind == Kind.DIAGNOSTIC;
        listener.onStatus(diagnostic
            ? "Diagnostic: connecting only to " + displayName(jobs.values().iterator().next().light)
            : "Broadcasting to " + totalJobs + " Eufy light" + (totalJobs == 1 ? "" : "s") + " in parallel");

        ArrayList<ParallelWorker> launch = new ArrayList<>();
        synchronized (workers) {
            for (Map.Entry<String, Job> entry : jobs.entrySet()) {
                ParallelWorker worker = new ParallelWorker(entry.getKey(), entry.getValue(), token);
                workers.put(entry.getKey(), worker);
                launch.add(worker);
            }
        }
        for (ParallelWorker worker : launch) worker.start();
    }

    private void cancelAllWork() {
        ++parallelToken;
        ArrayList<ParallelWorker> old;
        synchronized (workers) {
            old = new ArrayList<>(workers.values());
            workers.clear();
        }
        for (ParallelWorker worker : old) worker.cancel();
        if (timeout != null) handler.removeCallbacks(timeout);
        timeout = null;
        queue.clear();
        active = null;
        cleanupGatt();
    }

    private void beginNewRequest() {
        ++parallelToken;
        ArrayList<ParallelWorker> old;
        synchronized (workers) {
            old = new ArrayList<>(workers.values());
            workers.clear();
        }
        for (ParallelWorker worker : old) worker.cancel();
        if (timeout != null) handler.removeCallbacks(timeout);
        timeout = null;
        queue.clear();
        active = null;
        cleanupGatt();
    }

    private void startQueuedRequest() {
        if (queue.isEmpty()) {
            listener.onStatus("No Eufy lights with a usable 16-character serial are ready.");
            return;
        }
        stopScan();
        totalJobs=queue.size();
        processedJobs=0;
        successfulJobs=0;
        lastFailure="";
        listener.onProgress(0,totalJobs);
        runNext();
    }

    private void runNext() {
        cleanupGatt();
        Job job=queue.pollFirst();
        if(job==null){
            active=null;
            listener.onProgress(totalJobs,totalJobs);
            if(successfulJobs==totalJobs){
                listener.onStatus("PASS - "+successfulJobs+"/"+totalJobs+" light commands written");
            }else{
                listener.onStatus("FAIL - "+successfulJobs+"/"+totalJobs+" written • "+(lastFailure.isEmpty()?"unknown BLE failure":lastFailure));
            }
            return;
        }
        active=job;
        commandSent=false;
        legacyStage="connecting";
        connectionRetryCount=0;
        handshakeResponseRetryCount=0;
        connectActive(0L);
    }

    @SuppressLint("MissingPermission")
    private void connectActive(long delayMs) {
        Job job=active;
        if(job==null)return;
        if(timeout!=null)handler.removeCallbacks(timeout);
        timeout=null;
        cleanupGatt();
        try {
            probe=new E10Probe(job.light.serial,store.accountId());
        } catch(Throwable t) {
            finishActive(false,"Could not prepare "+displayName(job.light));
            return;
        }
        Runnable connect=()->{
            if(active!=job)return;
            legacyStage="connecting";
            listener.onStatus(actionText(job)+" "+displayName(job.light)+" - connecting"+
                (connectionRetryCount>0?" • retry "+connectionRetryCount:""));
            timeout=()->retryOrFailConnection(displayName(job.light)+": timed out at "+legacyStage);
            handler.postDelayed(timeout,12000L);
            try {
                if(Build.VERSION.SDK_INT>=23) gatt=job.light.device.connectGatt(context,false,callback,BluetoothDevice.TRANSPORT_LE);
                else gatt=job.light.device.connectGatt(context,false,callback);
            } catch(Throwable t) {
                retryOrFailConnection("Could not connect to "+displayName(job.light));
            }
        };
        if(delayMs>0)handler.postDelayed(connect,delayMs); else connect.run();
    }

    private void retryOrFailConnection(String reason) {
        Job job=active;
        if(job==null)return;
        if(connectionRetryCount<2){
            connectionRetryCount++;
            if(timeout!=null)handler.removeCallbacks(timeout);
            timeout=null;
            legacyStage="retrying connection";
            listener.onStatus(displayName(job.light)+": transient BLE failure • retrying connection "+connectionRetryCount+"/2");
            connectActive(700L);
        }else{
            finishActive(false,reason);
        }
    }

    private final ScanCallback scanCallback=new ScanCallback(){
        @Override @SuppressLint("MissingPermission")
        public void onScanResult(int callbackType, ScanResult result){
            BluetoothDevice d=result.getDevice();
            if(d==null)return;
            String address=address(d);
            if (!DeviceStore.isInstalledAddress(address)) return;
            String name="";
            ScanRecord record=result.getScanRecord();
            if(record!=null&&record.getDeviceName()!=null)name=record.getDeviceName();
            if(name.isEmpty()){
                try{String n=d.getName();if(n!=null)name=n;}catch(Throwable ignored){}
            }
            boolean serviceMatch=false;
            if(record!=null&&record.getServiceUuids()!=null){
                for(ParcelUuid p:record.getServiceUuids()){
                    if(p!=null&&SERVICE_ID.equals(p.getUuid())){serviceMatch=true;break;}
                }
            }
            String model=DeviceStore.modelFromName(name);
            String serial=store.serialFor(address,name);
            if(model.isEmpty()&&!serviceMatch&&serial.isEmpty())return;
            if(model.isEmpty() && serial.startsWith("T8L00")) model="E120";
            if(model.isEmpty() && serial.startsWith("T8L02")) model="E22";
            String rawShown=name.isEmpty()?(model.isEmpty()?"Eufy light":model):name;
            String shown=DeviceStore.friendlyNameFor(address,rawShown);
            found.put(address,new FoundLight(d,shown,result.getRssi(),model,serial));
            ArrayList<FoundLight> list=new ArrayList<>(found.values());
            list.sort(Comparator.comparingInt((FoundLight x)->x.rssi).reversed());
            listener.onScanChanged(list);
        }
    };

    private final BluetoothGattCallback callback=new BluetoothGattCallback(){
        @Override @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt g,int status,int newState){
            if(g!=gatt)return;
            if(newState==BluetoothProfile.STATE_CONNECTED){
                legacyStage="service discovery";
                listener.onStatus(displayName(active.light)+": CONNECTED • discovering Eufy service");
                if(!g.discoverServices())finishActive(false,"Service discovery could not start");
            } else if(newState==BluetoothProfile.STATE_DISCONNECTED&&active!=null){
                if(status==133 || legacyStage.startsWith("connecting")){
                    retryOrFailConnection("Disconnected before command completed (GATT "+status+")");
                }else{
                    finishActive(false,"Disconnected before command completed (GATT "+status+")");
                }
            }
        }

        @Override @SuppressLint("MissingPermission")
        public void onServicesDiscovered(BluetoothGatt g,int status){
            if(g!=gatt)return;
            if(status!=BluetoothGatt.GATT_SUCCESS){finishActive(false,"Service discovery failed ("+status+")");return;}
            if(g.getService(SERVICE_ID)==null){finishActive(false,"Eufy BLE service was not found");return;}
            writeChar=g.getService(SERVICE_ID).getCharacteristic(WRITE_ID);
            BluetoothGattCharacteristic notify=g.getService(SERVICE_ID).getCharacteristic(NOTIFY_ID);
            BluetoothGattDescriptor descriptor=notify==null?null:notify.getDescriptor(CCCD_ID);
            if(writeChar==null||notify==null||descriptor==null){finishActive(false,"Required Eufy BLE characteristics were not found");return;}
            legacyStage="notification setup";
            listener.onStatus(displayName(active.light)+": SERVICE FOUND • enabling notifications");
            if(!g.setCharacteristicNotification(notify,true)){finishActive(false,"Could not enable Eufy notifications");return;}
            if(Build.VERSION.SDK_INT>=33){
                int result=g.writeDescriptor(descriptor,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if(result!=BluetoothStatusCodes.SUCCESS)finishActive(false,"Notification descriptor write failed ("+result+")");
            } else {
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if(!g.writeDescriptor(descriptor))finishActive(false,"Notification descriptor write failed");
            }
        }

        @Override @SuppressLint("MissingPermission")
        public void onDescriptorWrite(BluetoothGatt g,BluetoothGattDescriptor descriptor,int status){
            if(g!=gatt||!CCCD_ID.equals(descriptor.getUuid()))return;
            if(status!=BluetoothGatt.GATT_SUCCESS){finishActive(false,"Notification setup failed ("+status+")");return;}
            legacyStage="MTU negotiation";
            listener.onStatus(displayName(active.light)+": NOTIFICATIONS READY • requesting MTU 247");
            if(!g.requestMtu(247))finishActive(false,"Could not request BLE packet size");
        }

        @Override
        public void onMtuChanged(BluetoothGatt g,int mtu,int status){
            if(g!=gatt)return;
            if(status!=BluetoothGatt.GATT_SUCCESS||mtu<93){finishActive(false,"BLE packet size too small ("+mtu+")");return;}
            legacyStage="MTU ready; handshake queued";
            listener.onStatus(displayName(active.light)+": MTU "+mtu+" READY • queueing E10 handshake");
            E10Probe p=probe;
            handler.postDelayed(() -> {
                if(g==gatt && p==probe && active!=null){
                    legacyStage="handshake 1/5";
                    sendHandshakeStep(0);
                }
            },350L);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic characteristic,byte[] value){
            if(g!=gatt||!NOTIFY_ID.equals(characteristic.getUuid())||commandSent)return;
            E10Probe p=probe;
            if(p==null)return;
            String summary=p.notificationSummary(value);
            legacyStage="notification received";
            if(p.acceptNotification(value)){
                commandSent=true;
                if(timeout!=null)handler.removeCallbacks(timeout);
                timeout=null;
                legacyStage="session established";
                listener.onStatus(displayName(active.light)+": SESSION RESPONSE ACCEPTED • "+summary+" • sending "+commandName(active));
                handler.post(this::sendActiveCommandFromCallback);
            }else{
                legacyStage="notification rejected: "+summary;
                listener.onStatus(displayName(active.light)+": NOTIFICATION RECEIVED BUT REJECTED • "+summary);
            }
        }

        private void sendActiveCommandFromCallback(){
            if(active!=null && probe!=null && probe.sessionEstablished()) sendActiveCommand();
        }

        @Override @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic characteristic){
            byte[] value=characteristic.getValue();
            if(value!=null)onCharacteristicChanged(g,characteristic,value);
        }
    };

    @SuppressLint("MissingPermission")
    private void sendHandshakeStep(int step){
        sendHandshakeStepAttempt(step,0);
    }

    @SuppressLint("MissingPermission")
    private void sendHandshakeStepAttempt(int step,int busyAttempt){
        E10Probe p=probe; BluetoothGatt g=gatt; BluetoothGattCharacteristic c=writeChar; Job job=active;
        if(p==null||g==null||c==null||job==null)return;
        if(step>=5){
            legacyStage="waiting for encrypted response";
            listener.onStatus(displayName(job.light)+": HANDSHAKE 5/5 SENT • waiting for encrypted response");
            if(timeout!=null)handler.removeCallbacks(timeout);
            timeout=()->{
                if(active!=job || probe!=p || commandSent)return;
                if(handshakeResponseRetryCount<1){
                    handshakeResponseRetryCount++;
                    connectionRetryCount=0;
                    legacyStage="retrying handshake after no response";
                    listener.onStatus(displayName(job.light)+": no encrypted response • reconnecting for one clean handshake retry");
                    connectActive(800L);
                }else{
                    finishActive(false,displayName(job.light)+": no encrypted response after handshake retry");
                }
            };
            handler.postDelayed(timeout,5000L);
            return;
        }
        byte[] data;
        try{data=p.step(step);}catch(Throwable t){finishActive(false,"Handshake frame could not be built");return;}
        int result=write(g,c,data);
        if(Build.VERSION.SDK_INT>=33 && result==BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY){
            if(busyAttempt<6){
                legacyStage="handshake "+(step+1)+"/5 busy retry "+(busyAttempt+1);
                listener.onStatus(displayName(job.light)+": GATT busy on handshake "+(step+1)+"/5 • retrying");
                handler.postDelayed(()->{
                    if(g==gatt&&p==probe&&active==job)sendHandshakeStepAttempt(step,busyAttempt+1);
                },120L);
            }else{
                retryOrFailConnection("Handshake write "+(step+1)+" stayed busy (201)");
            }
            return;
        }
        if(Build.VERSION.SDK_INT>=33&&result!=BluetoothStatusCodes.SUCCESS){
            retryOrFailConnection("Handshake write "+(step+1)+" failed ("+result+")");
            return;
        }
        legacyStage="handshake "+(step+1)+"/5";
        listener.onStatus(displayName(job.light)+": E10 handshake "+(step+1)+"/5");
        handler.postDelayed(()->{
            if(g==gatt&&p==probe&&active==job)sendHandshakeStep(step+1);
        },170L);
    }

    @SuppressLint("MissingPermission")
    private void sendActiveCommand(){
        Job job=active; BluetoothGatt g=gatt; BluetoothGattCharacteristic c=writeChar; E10Probe p=probe;
        if(job==null||g==null||c==null||p==null||!p.sessionEstablished())return;
        byte[] frame;
        try{
            switch(job.kind){
                case POWER:
                    frame=p.powerCommand(job.on);
                    break;
                case BRIGHTNESS:
                    frame=p.command(EufyLightCommands.OP_SETUP,EufyLightCommands.brightness(job.value));
                    break;
                case COLOR:
                    frame=p.command(EufyLightCommands.OP_COLOR,
                        EufyLightCommands.color(job.light.model,job.rgb,EufyLightCommands.defaultLampCount(job.light.model)));
                    break;
                case WHITE:
                    frame=p.command(EufyLightCommands.OP_COLOR,
                        EufyLightCommands.white(job.light.model,job.value,EufyLightCommands.defaultLampCount(job.light.model)));
                    break;
                case EFFECT:
                    frame=p.command(EufyLightCommands.OP_SHOW,
                        EufyLightCommands.show(job.light.model,job.effect,job.colors,job.speed,job.reverse));
                    break;
                case SCENE:
                    sendSceneSequence(job,g,c,p);
                    return;
                default:
                    throw new IllegalStateException("Unknown command");
            }
        }catch(Throwable t){
            finishActive(false,commandName(job)+" command could not be built");
            return;
        }
        int result=write(g,c,frame);
        if(Build.VERSION.SDK_INT>=33&&result!=BluetoothStatusCodes.SUCCESS){
            finishActive(false,commandName(job)+" write failed ("+result+")");
            return;
        }
        listener.onStatus(displayName(job.light)+": "+commandName(job)+" command written");
        handler.postDelayed(()->finishActive(true,null),650L);
    }

    @SuppressLint("MissingPermission")
    private void sendSceneSequence(Job job, BluetoothGatt g, BluetoothGattCharacteristic c, E10Probe p) {
        try {
            byte[] on = p.powerCommand(true);
            int r1 = write(g,c,on);
            if (Build.VERSION.SDK_INT >= 33 && r1 != BluetoothStatusCodes.SUCCESS) {
                finishActive(false,"Scene power write failed ("+r1+")");
                return;
            }
            handler.postDelayed(() -> {
                if (active != job || gatt != g || probe != p) return;
                try {
                    byte[] bright = p.command(EufyLightCommands.OP_SETUP,EufyLightCommands.brightness(job.value));
                    int r2 = write(g,c,bright);
                    if (Build.VERSION.SDK_INT >= 33 && r2 != BluetoothStatusCodes.SUCCESS) {
                        finishActive(false,"Scene brightness write failed ("+r2+")");
                        return;
                    }
                    handler.postDelayed(() -> {
                        if (active != job || gatt != g || probe != p) return;
                        try {
                            byte[] finalFrame;
                            if (("Solid".equals(job.effect) || "Solid / Static".equals(job.effect)) && job.colors.length == 1) {
                                finalFrame = p.command(EufyLightCommands.OP_COLOR,
                                    EufyLightCommands.color(job.light.model,job.colors[0],EufyLightCommands.defaultLampCount(job.light.model)));
                            } else {
                                finalFrame = p.command(EufyLightCommands.OP_SHOW,
                                    EufyLightCommands.show(job.light.model,job.effect,job.colors,job.speed,job.reverse));
                            }
                            int r3 = write(g,c,finalFrame);
                            if (Build.VERSION.SDK_INT >= 33 && r3 != BluetoothStatusCodes.SUCCESS) {
                                finishActive(false,"Scene effect write failed ("+r3+")");
                                return;
                            }
                            listener.onStatus(displayName(job.light)+": scene written");
                            handler.postDelayed(() -> {
                                if (active == job) finishActive(true,null);
                            },550L);
                        } catch (Throwable t) {
                            finishActive(false,"Scene effect command could not be built");
                        }
                    },220L);
                } catch (Throwable t) {
                    finishActive(false,"Scene brightness command could not be built");
                }
            },220L);
        } catch (Throwable t) {
            finishActive(false,"Scene power command could not be built");
        }
    }

    private final class ParallelWorker extends BluetoothGattCallback {
        final String key;
        final Job job;
        final long token;
        BluetoothGatt localGatt;
        BluetoothGattCharacteristic localWrite;
        E10Probe localProbe;
        Runnable localTimeout;
        boolean commandSentLocal;
        boolean finished;

        ParallelWorker(String key, Job job, long token) {
            this.key=key; this.job=job; this.token=token;
        }

        @SuppressLint("MissingPermission")
        void start() {
            try {
                localProbe = new E10Probe(job.light.serial,store.accountId());
            } catch (Throwable t) {
                finish(false,displayName(job.light)+": could not prepare handshake");
                return;
            }
            localTimeout = () -> finish(false,displayName(job.light)+": connection/handshake timed out");
            handler.postDelayed(localTimeout,20000L);
            try {
                if (Build.VERSION.SDK_INT >= 23) {
                    localGatt = job.light.device.connectGatt(context,false,this,BluetoothDevice.TRANSPORT_LE);
                } else {
                    localGatt = job.light.device.connectGatt(context,false,this);
                }
            } catch (Throwable t) {
                finish(false,displayName(job.light)+": could not connect");
            }
        }

        private boolean current(BluetoothGatt g) {
            return !finished && token == parallelToken && localGatt == g;
        }

        @Override @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt g,int status,int newState) {
            if (!current(g)) return;
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (job.kind == Kind.DIAGNOSTIC) listener.onStatus("Diagnostic " + displayName(job.light) + ": CONNECTED → discovering services");
                if (!g.discoverServices()) finish(false,displayName(job.light)+": service discovery could not start");
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                finish(false,displayName(job.light)+": disconnected before command completed");
            }
        }

        @Override @SuppressLint("MissingPermission")
        public void onServicesDiscovered(BluetoothGatt g,int status) {
            if (!current(g)) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                finish(false,displayName(job.light)+": service discovery failed ("+status+")");
                return;
            }
            if (g.getService(SERVICE_ID) == null) {
                finish(false,displayName(job.light)+": Eufy BLE service not found");
                return;
            }
            if (job.kind == Kind.DIAGNOSTIC) listener.onStatus("Diagnostic " + displayName(job.light) + ": service found → enabling notifications");
            localWrite=g.getService(SERVICE_ID).getCharacteristic(WRITE_ID);
            BluetoothGattCharacteristic notify=g.getService(SERVICE_ID).getCharacteristic(NOTIFY_ID);
            BluetoothGattDescriptor descriptor=notify==null?null:notify.getDescriptor(CCCD_ID);
            if (localWrite==null||notify==null||descriptor==null) {
                finish(false,displayName(job.light)+": required BLE characteristics not found");
                return;
            }
            if (!g.setCharacteristicNotification(notify,true)) {
                finish(false,displayName(job.light)+": could not enable notifications");
                return;
            }
            if (Build.VERSION.SDK_INT>=33) {
                int r=g.writeDescriptor(descriptor,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if (r!=BluetoothStatusCodes.SUCCESS) finish(false,displayName(job.light)+": notification descriptor write failed ("+r+")");
            } else {
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if (!g.writeDescriptor(descriptor)) finish(false,displayName(job.light)+": notification descriptor write failed");
            }
        }

        @Override @SuppressLint("MissingPermission")
        public void onDescriptorWrite(BluetoothGatt g,BluetoothGattDescriptor descriptor,int status) {
            if (!current(g)||!CCCD_ID.equals(descriptor.getUuid())) return;
            if (status!=BluetoothGatt.GATT_SUCCESS) {
                finish(false,displayName(job.light)+": notification setup failed ("+status+")");
                return;
            }
            if (job.kind == Kind.DIAGNOSTIC) listener.onStatus("Diagnostic " + displayName(job.light) + ": notifications enabled → MTU 247");
            if (!g.requestMtu(247)) finish(false,displayName(job.light)+": could not request BLE packet size");
        }

        @Override
        public void onMtuChanged(BluetoothGatt g,int mtu,int status) {
            if (!current(g)) return;
            if (status!=BluetoothGatt.GATT_SUCCESS||mtu<100) {
                finish(false,displayName(job.light)+": BLE packet size too small ("+mtu+")");
                return;
            }
            if (job.kind == Kind.DIAGNOSTIC) listener.onStatus("Diagnostic " + displayName(job.light) + ": MTU " + mtu + " → starting handshake");
            sendHandshakeStepLocal(0);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic characteristic,byte[] value) {
            if (!current(g)||!NOTIFY_ID.equals(characteristic.getUuid())||commandSentLocal) return;
            if (localProbe!=null&&localProbe.acceptNotification(value)) {
                commandSentLocal=true;
                if (job.kind == Kind.DIAGNOSTIC) {
                    listener.onStatus("Diagnostic " + displayName(job.light) + ": PASS — encrypted session established");
                    finish(true,null);
                } else {
                    sendLocalCommand();
                }
            }
        }

        @Override @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic characteristic) {
            byte[] value=characteristic.getValue();
            if (value!=null) onCharacteristicChanged(g,characteristic,value);
        }

        @SuppressLint("MissingPermission")
        private void sendHandshakeStepLocal(int step) {
            if (finished||token!=parallelToken||localGatt==null||localWrite==null||localProbe==null) return;
            if (step>=5) return;
            byte[] data;
            try {
                data=localProbe.step(step);
            } catch (Throwable t) {
                finish(false,displayName(job.light)+": handshake frame could not be built");
                return;
            }
            if (job.kind == Kind.DIAGNOSTIC) listener.onStatus("Diagnostic " + displayName(job.light) + ": handshake " + (step+1) + "/5");
            int result=write(localGatt,localWrite,data);
            if (Build.VERSION.SDK_INT>=33&&result!=BluetoothStatusCodes.SUCCESS) {
                finish(false,displayName(job.light)+": handshake write "+(step+1)+" failed ("+result+")");
                return;
            }
            handler.postDelayed(() -> {
                if (!finished&&token==parallelToken) sendHandshakeStepLocal(step+1);
            },170L);
        }

        @SuppressLint("MissingPermission")
        private void sendLocalCommand() {
            if (finished||token!=parallelToken||localGatt==null||localWrite==null||localProbe==null||!localProbe.sessionEstablished()) return;
            if (job.kind==Kind.SCENE) {
                sendLocalScene();
                return;
            }
            byte[] frame;
            try {
                switch(job.kind) {
                    case POWER:
                        frame=localProbe.powerCommand(job.on);
                        break;
                    case BRIGHTNESS:
                        frame=localProbe.command(EufyLightCommands.OP_SETUP,EufyLightCommands.brightness(job.value));
                        break;
                    case COLOR:
                        frame=localProbe.command(EufyLightCommands.OP_COLOR,
                            EufyLightCommands.color(job.light.model,job.rgb,EufyLightCommands.defaultLampCount(job.light.model)));
                        break;
                    case WHITE:
                        frame=localProbe.command(EufyLightCommands.OP_COLOR,
                            EufyLightCommands.white(job.light.model,job.value,EufyLightCommands.defaultLampCount(job.light.model)));
                        break;
                    case EFFECT:
                        frame=localProbe.command(EufyLightCommands.OP_SHOW,
                            EufyLightCommands.show(job.light.model,job.effect,job.colors,job.speed,job.reverse));
                        break;
                    case DIAGNOSTIC:
                        finish(true,null);
                        return;
                    default:
                        throw new IllegalStateException("Unknown command");
                }
            } catch(Throwable t) {
                finish(false,displayName(job.light)+": "+commandName(job)+" could not be built");
                return;
            }
            int result=write(localGatt,localWrite,frame);
            if (Build.VERSION.SDK_INT>=33&&result!=BluetoothStatusCodes.SUCCESS) {
                finish(false,displayName(job.light)+": "+commandName(job)+" write failed ("+result+")");
                return;
            }
            handler.postDelayed(() -> finish(true,null),550L);
        }

        @SuppressLint("MissingPermission")
        private void sendLocalScene() {
            try {
                int r1=write(localGatt,localWrite,localProbe.powerCommand(true));
                if (Build.VERSION.SDK_INT>=33&&r1!=BluetoothStatusCodes.SUCCESS) {
                    finish(false,displayName(job.light)+": scene power write failed ("+r1+")");
                    return;
                }
                handler.postDelayed(() -> {
                    if (finished||token!=parallelToken) return;
                    try {
                        int r2=write(localGatt,localWrite,
                            localProbe.command(EufyLightCommands.OP_SETUP,EufyLightCommands.brightness(job.value)));
                        if (Build.VERSION.SDK_INT>=33&&r2!=BluetoothStatusCodes.SUCCESS) {
                            finish(false,displayName(job.light)+": scene brightness write failed ("+r2+")");
                            return;
                        }
                        handler.postDelayed(() -> {
                            if (finished||token!=parallelToken) return;
                            try {
                                byte[] frame;
                                if (("Solid".equals(job.effect)||"Solid / Static".equals(job.effect))&&job.colors.length==1) {
                                    frame=localProbe.command(EufyLightCommands.OP_COLOR,
                                        EufyLightCommands.color(job.light.model,job.colors[0],EufyLightCommands.defaultLampCount(job.light.model)));
                                } else {
                                    frame=localProbe.command(EufyLightCommands.OP_SHOW,
                                        EufyLightCommands.show(job.light.model,job.effect,job.colors,job.speed,job.reverse));
                                }
                                int r3=write(localGatt,localWrite,frame);
                                if (Build.VERSION.SDK_INT>=33&&r3!=BluetoothStatusCodes.SUCCESS) {
                                    finish(false,displayName(job.light)+": scene effect write failed ("+r3+")");
                                    return;
                                }
                                handler.postDelayed(() -> finish(true,null),550L);
                            } catch(Throwable t) {
                                finish(false,displayName(job.light)+": scene effect command could not be built");
                            }
                        },220L);
                    } catch(Throwable t) {
                        finish(false,displayName(job.light)+": scene brightness command could not be built");
                    }
                },220L);
            } catch(Throwable t) {
                finish(false,displayName(job.light)+": scene power command could not be built");
            }
        }

        void finish(boolean success,String error) {
            handler.post(() -> finishOnMain(success,error));
        }

        private void finishOnMain(boolean success,String error) {
            if (finished) return;
            finished=true;
            if (localTimeout!=null) handler.removeCallbacks(localTimeout);
            localTimeout=null;
            cleanupLocal();

            if (token!=parallelToken) return;
            synchronized(workers) {
                ParallelWorker current=workers.get(key);
                if (current==this) workers.remove(key);
            }

            processedJobs++;
            if (success) successfulJobs++;
            listener.onProgress(processedJobs,totalJobs);
            if (processedJobs>=totalJobs) {
                if (successfulJobs==totalJobs) {
                    listener.onStatus("Broadcast finished - "+successfulJobs+"/"+totalJobs+" lights updated");
                } else {
                    listener.onStatus("Broadcast finished - "+successfulJobs+"/"+totalJobs+" lights updated"+(error==null?"":". "+error));
                }
            }
        }

        @SuppressLint("MissingPermission")
        void cancel() {
            if (finished) return;
            finished=true;
            if (localTimeout!=null) handler.removeCallbacks(localTimeout);
            localTimeout=null;
            cleanupLocal();
        }

        @SuppressLint("MissingPermission")
        private void cleanupLocal() {
            BluetoothGatt old=localGatt;
            localGatt=null;
            localWrite=null;
            localProbe=null;
            try { if (old!=null) old.disconnect(); } catch(Throwable ignored) {}
            try { if (old!=null) old.close(); } catch(Throwable ignored) {}
        }
    }

    @SuppressLint("MissingPermission")
    private int write(BluetoothGatt g,BluetoothGattCharacteristic c,byte[] data){
        if(Build.VERSION.SDK_INT>=33)return g.writeCharacteristic(c,data,BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        c.setValue(data);
        c.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        return g.writeCharacteristic(c)?0:-1;
    }

    private void finishActive(boolean success,String error){
        if(active==null)return;
        if(timeout!=null)handler.removeCallbacks(timeout);
        timeout=null;
        processedJobs++;
        if(success)successfulJobs++;
        listener.onProgress(processedJobs,totalJobs);
        if(error!=null){
            lastFailure=error+" • stage="+legacyStage;
            listener.onStatus("FAIL • "+lastFailure);
        }
        active=null;
        legacyStage="idle";
        cleanupGatt();
        handler.postDelayed(this::runNext,450L);
    }

    @SuppressLint("MissingPermission")
    private void cleanupGatt(){
        BluetoothGatt old=gatt;
        gatt=null; writeChar=null; probe=null; commandSent=false;
        try{if(old!=null)old.disconnect();}catch(Throwable ignored){}
        try{if(old!=null)old.close();}catch(Throwable ignored){}
    }

    @SuppressLint("MissingPermission")
    void close(){
        try{
            if(manager!=null&&manager.getAdapter()!=null&&manager.getAdapter().getBluetoothLeScanner()!=null)
                manager.getAdapter().getBluetoothLeScanner().stopScan(scanCallback);
        }catch(Throwable ignored){}
        cancelAllWork();
    }

    private static String address(BluetoothDevice d){
        try{return d.getAddress();}catch(Throwable t){return "";}
    }

    private static String displayName(FoundLight light){
        if(light.name!=null&&!light.name.isEmpty())return light.name;
        if(light.model!=null&&!light.model.isEmpty())return light.model;
        return "Eufy light";
    }

    private static String actionText(Job job){
        switch(job.kind){
            case POWER:return job.on?"Turning on":"Turning off";
            case BRIGHTNESS:return "Setting brightness";
            case COLOR:return "Setting color";
            case WHITE:return "Setting white";
            case EFFECT:return "Starting "+job.effect;
            case SCENE:return "Applying "+job.effect;
            default:return "Controlling";
        }
    }

    private static String commandName(Job job){
        if(job==null)return "command";
        switch(job.kind){
            case POWER:return job.on?"ON":"OFF";
            case BRIGHTNESS:return "brightness "+job.value+"%";
            case COLOR:return String.format("color #%06X",job.rgb&0xFFFFFF);
            case WHITE:return job.value+" K white";
            case EFFECT:return job.effect;
            case SCENE:return "scene "+job.effect;
            case DIAGNOSTIC:return "diagnostic handshake";
            default:return "command";
        }
    }
}

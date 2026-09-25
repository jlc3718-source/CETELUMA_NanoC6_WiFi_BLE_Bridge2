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

    private enum Kind { POWER, BRIGHTNESS, COLOR, WHITE, EFFECT, SCENE }

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

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private E10Probe probe;
    private Job active;
    private Runnable timeout;
    private int totalJobs;
    private int processedJobs;
    private int successfulJobs;
    private boolean commandSent;

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
        listener.onStatus("Scanning nearby BLE devices - showing Eufy lights only");
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        manager.getAdapter().getBluetoothLeScanner().startScan(null, settings, scanCallback);
        handler.postDelayed(this::stopScan, 12000L);
    }

    @SuppressLint("MissingPermission")
    void stopScan() {
        try {
            if (manager != null && manager.getAdapter() != null && manager.getAdapter().getBluetoothLeScanner() != null) {
                manager.getAdapter().getBluetoothLeScanner().stopScan(scanCallback);
            }
        } catch (Throwable ignored) {}
        listener.onStatus("Scan complete - " + found.size() + " Eufy light" + (found.size() == 1 ? "" : "s") + " shown");
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
        int[] safe = colors == null ? new int[]{0xFFFFFF} : colors.clone();
        enqueue(targets, item -> Job.effect(item,effect,safe,speed,reverse));
    }

    void setScene(List<FoundLight> targets, String effect, int[] colors, int speed, boolean reverse, int brightness) {
        beginNewRequest();
        if (store.accountId().length() != 40) {
            listener.onStatus("The 40-character Eufy account ID is unavailable.");
            return;
        }
        int[] safe = colors == null || colors.length == 0 ? new int[]{0xFFFFFF} : colors.clone();
        int bright = Math.max(1, Math.min(100, brightness));
        for (FoundLight item : targets) {
            String serial = store.serialFor(address(item.device), item.name);
            if (serial.length() != 16) continue;
            FoundLight ready = new FoundLight(item.device,item.name,item.rssi,item.model,serial);
            queue.addLast(Job.scene(ready,effect,safe,speed,reverse,bright));
        }
        startQueuedRequest();
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
            String serial = store.serialFor(address(item.device), item.name);
            if (serial.length() == 16) {
                FoundLight ready = new FoundLight(item.device,item.name,item.rssi,item.model,serial);
                queue.addLast(factory.make(ready));
            }
        }
        startQueuedRequest();
    }

    boolean isBusy() {
        return active != null || !queue.isEmpty();
    }

    private void beginNewRequest() {
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
        listener.onProgress(0,totalJobs);
        runNext();
    }

    private void runNext() {
        cleanupGatt();
        Job job=queue.pollFirst();
        if(job==null){
            active=null;
            listener.onProgress(totalJobs,totalJobs);
            listener.onStatus("Finished - "+successfulJobs+"/"+totalJobs+" light commands written");
            return;
        }
        active=job;
        commandSent=false;
        try {
            probe=new E10Probe(job.light.serial,store.accountId());
        } catch(Throwable t) {
            finishActive(false,"Could not prepare "+displayName(job.light));
            return;
        }
        listener.onStatus(actionText(job)+" "+displayName(job.light)+" - connecting");
        timeout=()->finishActive(false,displayName(job.light)+": connection/handshake timed out");
        handler.postDelayed(timeout,20000L);
        try {
            if(Build.VERSION.SDK_INT>=23) gatt=job.light.device.connectGatt(context,false,callback,BluetoothDevice.TRANSPORT_LE);
            else gatt=job.light.device.connectGatt(context,false,callback);
        } catch(Throwable t) {
            finishActive(false,"Could not connect to "+displayName(job.light));
        }
    }

    private final ScanCallback scanCallback=new ScanCallback(){
        @Override @SuppressLint("MissingPermission")
        public void onScanResult(int callbackType, ScanResult result){
            BluetoothDevice d=result.getDevice();
            if(d==null)return;
            String address=address(d);
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
            String shown=name.isEmpty()?(model.isEmpty()?"Eufy light":model):name;
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
                listener.onStatus("Connected - discovering Eufy service");
                if(!g.discoverServices())finishActive(false,"Service discovery could not start");
            } else if(newState==BluetoothProfile.STATE_DISCONNECTED&&active!=null){
                finishActive(false,"Disconnected before command completed");
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
            listener.onStatus("Notifications ready - requesting BLE packet size");
            if(!g.requestMtu(247))finishActive(false,"Could not request BLE packet size");
        }

        @Override
        public void onMtuChanged(BluetoothGatt g,int mtu,int status){
            if(g!=gatt)return;
            if(status!=BluetoothGatt.GATT_SUCCESS||mtu<100){finishActive(false,"BLE packet size too small ("+mtu+")");return;}
            listener.onStatus("BLE ready - starting encrypted E10 handshake");
            sendHandshakeStep(0);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic characteristic,byte[] value){
            if(g!=gatt||!NOTIFY_ID.equals(characteristic.getUuid())||commandSent)return;
            if(probe!=null&&probe.acceptNotification(value)){
                commandSent=true;
                listener.onStatus("Handshake accepted - sending "+commandName(active));
                sendActiveCommand();
            }
        }

        @Override @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g,BluetoothGattCharacteristic characteristic){
            byte[] value=characteristic.getValue();
            if(value!=null)onCharacteristicChanged(g,characteristic,value);
        }
    };

    @SuppressLint("MissingPermission")
    private void sendHandshakeStep(int step){
        E10Probe p=probe; BluetoothGatt g=gatt; BluetoothGattCharacteristic c=writeChar;
        if(p==null||g==null||c==null)return;
        if(step>=5){listener.onStatus("Handshake sent - waiting for encrypted Eufy response");return;}
        byte[] data;
        try{data=p.step(step);}catch(Throwable t){finishActive(false,"Handshake frame could not be built");return;}
        int result=write(g,c,data);
        if(Build.VERSION.SDK_INT>=33&&result!=BluetoothStatusCodes.SUCCESS){finishActive(false,"Handshake write "+(step+1)+" failed ("+result+")");return;}
        listener.onStatus("Sending E10 handshake "+(step+1)+"/5");
        handler.postDelayed(()->{if(g==gatt&&p==probe)sendHandshakeStep(step+1);},170L);
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
        if(error!=null)listener.onStatus(error+" - moving to next light");
        active=null;
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
        queue.clear(); active=null; cleanupGatt();
    }

    private static String address(BluetoothDevice d){
        try{return d.getAddress();}catch(Throwable t){return "";}
    }

    private static String displayName(FoundLight light){
        if(light.model!=null&&!light.model.isEmpty())return light.model;
        if(light.name!=null&&!light.name.isEmpty())return light.name;
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
            default:return "command";
        }
    }
}

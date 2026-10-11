package com.jasonhome.app;

import android.Manifest;
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
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

final class SmartDawnCurtainController {
    private static final String DEVICE_NAME="DN5E58";
    private static final UUID SERVICE=UUID.fromString("00000074-1972-1925-3022-077119514e44");
    private static final UUID WRITE=UUID.fromString("01020074-1972-1925-3022-077119514e44");
    private static final UUID NOTIFY=UUID.fromString("01010074-1972-1925-3022-077119514e44");
    private static final int OP_INFO=0x00cd, OP_CAP=0x00a7, OP_ON=0x09d2, OP_OFF=0x09d3, OP_BRIGHTNESS=0x09cd, OP_EFFECT_MODE=0x096a, OP_EFFECT=0x0a2e, OP_SPEED=0x09db, OP_LAYOUT=0x09c6;
    private final Context context;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writer;
    private int seq=1, tx=1;
    private String status="Offline";

    SmartDawnCurtainController(Context context){this.context=context.getApplicationContext();}

    synchronized JSONObject statusJson() throws Exception{
        return new JSONObject().put("ok",true).put("name",DEVICE_NAME).put("connected",gatt!=null&&writer!=null).put("status",status);
    }

    synchronized JSONObject connect() throws Exception{
        if(gatt!=null&&writer!=null)return statusJson();
        requirePermissions();
        BluetoothManager bm=(BluetoothManager)context.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter=bm==null?null:bm.getAdapter();
        if(adapter==null||!adapter.isEnabled())throw new IOException("Bluetooth is off");
        BluetoothDevice device=findDevice(adapter);
        if(device==null)throw new IOException("DN5E58 not found. Keep the curtain powered on and nearby.");
        CountDownLatch servicesReady=new CountDownLatch(1);
        final IOException[] error=new IOException[1];
        BluetoothGattCallback cb=new BluetoothGattCallback(){
            @Override public void onConnectionStateChange(BluetoothGatt g,int s,int newState){
                if(s!=BluetoothGatt.GATT_SUCCESS){error[0]=new IOException("Bluetooth connect failed: "+s);servicesReady.countDown();return;}
                if(newState==android.bluetooth.BluetoothProfile.STATE_CONNECTED){status="Discovering services";g.discoverServices();}
                else if(newState==android.bluetooth.BluetoothProfile.STATE_DISCONNECTED){status="Disconnected";writer=null;servicesReady.countDown();}
            }
            @Override public void onServicesDiscovered(BluetoothGatt g,int s){
                if(s!=BluetoothGatt.GATT_SUCCESS){error[0]=new IOException("Service discovery failed: "+s);servicesReady.countDown();return;}
                BluetoothGattService service=g.getService(SERVICE);
                if(service==null){error[0]=new IOException("SmartDawn service not found");servicesReady.countDown();return;}
                writer=service.getCharacteristic(WRITE);
                BluetoothGattCharacteristic notify=service.getCharacteristic(NOTIFY);
                if(notify!=null)g.setCharacteristicNotification(notify,true);
                if(writer==null)error[0]=new IOException("SmartDawn write characteristic not found");
                else status="Connected";
                servicesReady.countDown();
            }
        };
        status="Connecting";seq=1;tx=1;
        gatt=device.connectGatt(context,false,cb,BluetoothDevice.TRANSPORT_LE);
        if(!servicesReady.await(15,TimeUnit.SECONDS))throw new IOException("Bluetooth connect timed out");
        if(error[0]!=null){disconnect();throw error[0];}
        send(OP_INFO,new byte[0]);
        send(OP_CAP,new byte[0]);
        return statusJson();
    }

    synchronized JSONObject disconnect() throws Exception{
        if(gatt!=null){try{gatt.disconnect();}catch(Throwable ignored){} try{gatt.close();}catch(Throwable ignored){}}
        gatt=null;writer=null;status="Offline";return statusJson();
    }

    synchronized JSONObject control(JSONObject in) throws Exception{
        if(gatt==null||writer==null)connect();
        String action=in.optString("action","");
        if("power".equals(action))send(in.optBoolean("value",true)?OP_ON:OP_OFF,new byte[0]);
        else if("brightness".equals(action))send(OP_BRIGHTNESS,payload1(Math.round((float)(clamp(in.optInt("value",100),0,100)*255.0/100.0))));
        else if("speed".equals(action))send(OP_SPEED,payload1(clamp(in.optInt("value",88),1,100)));
        else if("layout".equals(action))send(OP_LAYOUT,payload1(clamp(in.optInt("value",0),0,6)));
        else if("refresh".equals(action))send(OP_INFO,new byte[0]);
        else if("effect".equals(action)){send(OP_EFFECT_MODE,new byte[0]);send(OP_EFFECT,effectPayload(in.optInt("group",15924),in.optInt("index",0)));}
        else throw new IOException("Unknown curtain action: "+action);
        return statusJson().put("sent",action);
    }

    private BluetoothDevice findDevice(BluetoothAdapter adapter) throws Exception{
        if(Build.VERSION.SDK_INT>=31&&context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)!=PackageManager.PERMISSION_GRANTED)throw new IOException("Bluetooth scan permission is not granted");
        BluetoothLeScanner scanner=adapter.getBluetoothLeScanner();
        if(scanner==null)throw new IOException("Bluetooth scanner unavailable");
        final BluetoothDevice[] found=new BluetoothDevice[1];
        CountDownLatch latch=new CountDownLatch(1);
        ScanCallback cb=new ScanCallback(){@Override public void onScanResult(int callbackType,ScanResult result){BluetoothDevice d=result==null?null:result.getDevice();String name=null;try{name=d==null?null:d.getName();}catch(Throwable ignored){} if(DEVICE_NAME.equals(name)){found[0]=d;latch.countDown();}}};
        scanner.startScan(cb);
        latch.await(10,TimeUnit.SECONDS);
        try{scanner.stopScan(cb);}catch(Throwable ignored){}
        return found[0];
    }

    private void requirePermissions() throws IOException{
        if(Build.VERSION.SDK_INT>=31){
            if(context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED||context.checkSelfPermission(Manifest.permission.BLUETOOTH_SCAN)!=PackageManager.PERMISSION_GRANTED)throw new IOException("Bluetooth permission is not granted. Reopen Jason Home 2 and allow Nearby devices.");
        }else if(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED)throw new IOException("Location permission is required for Bluetooth scan on this Android version.");
    }

    private void send(int opcode,byte[] payload) throws Exception{
        if(writer==null)throw new IOException("Curtain Bluetooth is not connected");
        byte[] frame=frame(opcode,payload);
        boolean ok;
        if(Build.VERSION.SDK_INT>=33)ok=gatt.writeCharacteristic(writer,frame,BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT)==BluetoothGatt.GATT_SUCCESS;
        else{writer.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);writer.setValue(frame);ok=gatt.writeCharacteristic(writer);}
        if(!ok)throw new IOException("Bluetooth write failed");
        Thread.sleep(80);
    }
    private byte[] frame(int opcode,byte[] payload){byte[] b=new byte[24+payload.length];b[0]=(byte)seq;b[1]=1;b[4]=(byte)0xf0;b[5]=4;b[6]=(byte)(tx>>8);b[7]=(byte)tx;b[10]=(byte)(opcode>>8);b[11]=(byte)opcode;System.arraycopy(payload,0,b,24,payload.length);seq=(seq+1)&255;tx=(tx+1)&65535;return b;}
    private static byte[] payload1(int v){ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(8);writeVarint(out,v);return out.toByteArray();}
    private static byte[] effectPayload(int group,int index){ByteArrayOutputStream out=new ByteArrayOutputStream();out.write(8);writeVarint(out,group);out.write(16);writeVarint(out,index);return out.toByteArray();}
    private static void writeVarint(ByteArrayOutputStream out,int n){do{int b=n&0x7f;n>>>=7;out.write(b|(n!=0?0x80:0));}while(n!=0);}
    private static int clamp(int v,int lo,int hi){return Math.max(lo,Math.min(hi,v));}
}

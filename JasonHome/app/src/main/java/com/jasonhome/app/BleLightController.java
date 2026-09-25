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
    private final ArrayDeque<PowerJob> queue = new ArrayDeque<>();

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeChar;
    private E10Probe probe;
    private PowerJob active;
    private Runnable timeout;
    private int totalJobs;
    private int processedJobs;
    private int successfulJobs;
    private boolean powerSent;

    private static final class PowerJob {
        final FoundLight light;
        final boolean on;
        PowerJob(FoundLight light, boolean on) {
            this.light = light;
            this.on = on;
        }
    }

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
        } catch (Throwable ignored) {
        }
        listener.onStatus("Scan complete - " + found.size() + " Eufy light" + (found.size() == 1 ? "" : "s") + " shown");
    }

    List<FoundLight> discovered() {
        return new ArrayList<>(found.values());
    }

    void setPower(List<FoundLight> targets, boolean on) {
        if (active != null || !queue.isEmpty()) {
            listener.onStatus("A light command is already running.");
            return;
        }
        String account = store.accountId();
        if (account.length() != 40) {
            listener.onStatus("Save the 40-character Eufy account ID in Settings first.");
            return;
        }
        for (FoundLight item : targets) {
            String serial = store.serialFor(address(item.device), item.name);
            if (serial.length() == 16) {
                queue.addLast(new PowerJob(new FoundLight(item.device, item.name, item.rssi, item.model, serial), on));
            }
        }
        if (queue.isEmpty()) {
            listener.onStatus("No Eufy lights with a usable 16-character serial are ready.");
            return;
        }
        stopScan();
        totalJobs = queue.size();
        processedJobs = 0;
        successfulJobs = 0;
        listener.onProgress(0, totalJobs);
        runNext();
    }

    private void runNext() {
        cleanupGatt();
        PowerJob job = queue.pollFirst();
        if (job == null) {
            active = null;
            listener.onProgress(totalJobs, totalJobs);
            listener.onStatus("Finished - " + successfulJobs + "/" + totalJobs + " light commands written");
            return;
        }
        active = job;
        powerSent = false;
        try {
            probe = new E10Probe(job.light.serial, store.accountId());
        } catch (Throwable t) {
            finishActive(false, "Could not prepare " + displayName(job.light));
            return;
        }
        listener.onStatus((job.on ? "Turning on " : "Turning off ") + displayName(job.light) + " - connecting");
        timeout = () -> finishActive(false, displayName(job.light) + ": connection/handshake timed out");
        handler.postDelayed(timeout, 20000L);
        try {
            if (Build.VERSION.SDK_INT >= 23) {
                gatt = job.light.device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE);
            } else {
                gatt = job.light.device.connectGatt(context, false, callback);
            }
        } catch (Throwable t) {
            finishActive(false, "Could not connect to " + displayName(job.light));
        }
    }

    private final ScanCallback scanCallback = new ScanCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice d = result.getDevice();
            if (d == null) return;
            String address = address(d);
            String name = "";
            ScanRecord record = result.getScanRecord();
            if (record != null && record.getDeviceName() != null) name = record.getDeviceName();
            if (name.isEmpty()) {
                try {
                    String n = d.getName();
                    if (n != null) name = n;
                } catch (Throwable ignored) {
                }
            }
            boolean serviceMatch = false;
            if (record != null && record.getServiceUuids() != null) {
                for (ParcelUuid p : record.getServiceUuids()) {
                    if (p != null && SERVICE_ID.equals(p.getUuid())) {
                        serviceMatch = true;
                        break;
                    }
                }
            }
            String model = DeviceStore.modelFromName(name);
            String serial = store.serialFor(address, name);
            if (model.isEmpty() && !serviceMatch && serial.isEmpty()) return;
            String shown = name.isEmpty() ? (model.isEmpty() ? "Eufy light" : model) : name;
            found.put(address, new FoundLight(d, shown, result.getRssi(), model, serial));
            ArrayList<FoundLight> list = new ArrayList<>(found.values());
            list.sort(Comparator.comparingInt((FoundLight x) -> x.rssi).reversed());
            listener.onScanChanged(list);
        }
    };

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (g != gatt) return;
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                listener.onStatus("Connected - discovering Eufy service");
                if (!g.discoverServices()) finishActive(false, "Service discovery could not start");
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED && active != null) {
                finishActive(false, "Disconnected before command completed");
            }
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onServicesDiscovered(BluetoothGatt g, int status) {
            if (g != gatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                finishActive(false, "Service discovery failed (" + status + ")");
                return;
            }
            if (g.getService(SERVICE_ID) == null) {
                finishActive(false, "Eufy BLE service was not found");
                return;
            }
            writeChar = g.getService(SERVICE_ID).getCharacteristic(WRITE_ID);
            BluetoothGattCharacteristic notify = g.getService(SERVICE_ID).getCharacteristic(NOTIFY_ID);
            BluetoothGattDescriptor descriptor = notify == null ? null : notify.getDescriptor(CCCD_ID);
            if (writeChar == null || notify == null || descriptor == null) {
                finishActive(false, "Required Eufy BLE characteristics were not found");
                return;
            }
            if (!g.setCharacteristicNotification(notify, true)) {
                finishActive(false, "Could not enable Eufy notifications");
                return;
            }
            if (Build.VERSION.SDK_INT >= 33) {
                int result = g.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if (result != BluetoothStatusCodes.SUCCESS) finishActive(false, "Notification descriptor write failed (" + result + ")");
            } else {
                descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                if (!g.writeDescriptor(descriptor)) finishActive(false, "Notification descriptor write failed");
            }
        }

        @Override
        @SuppressLint("MissingPermission")
        public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor descriptor, int status) {
            if (g != gatt || !CCCD_ID.equals(descriptor.getUuid())) return;
            if (status != BluetoothGatt.GATT_SUCCESS) {
                finishActive(false, "Notification setup failed (" + status + ")");
                return;
            }
            listener.onStatus("Notifications ready - requesting BLE packet size");
            if (!g.requestMtu(247)) finishActive(false, "Could not request BLE packet size");
        }

        @Override
        public void onMtuChanged(BluetoothGatt g, int mtu, int status) {
            if (g != gatt) return;
            if (status != BluetoothGatt.GATT_SUCCESS || mtu < 100) {
                finishActive(false, "BLE packet size too small (" + mtu + ")");
                return;
            }
            listener.onStatus("BLE ready - starting encrypted E10 handshake");
            sendHandshakeStep(0);
        }

        @Override
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic, byte[] value) {
            if (g != gatt || !NOTIFY_ID.equals(characteristic.getUuid()) || powerSent) return;
            if (probe != null && probe.acceptNotification(value)) {
                powerSent = true;
                listener.onStatus("Handshake accepted - sending power command");
                sendPower();
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic characteristic) {
            byte[] value = characteristic.getValue();
            if (value != null) onCharacteristicChanged(g, characteristic, value);
        }
    };

    @SuppressLint("MissingPermission")
    private void sendHandshakeStep(int step) {
        E10Probe p = probe;
        BluetoothGatt g = gatt;
        BluetoothGattCharacteristic c = writeChar;
        if (p == null || g == null || c == null) return;
        if (step >= 5) {
            listener.onStatus("Handshake sent - waiting for encrypted Eufy response");
            return;
        }
        byte[] data;
        try {
            data = p.step(step);
        } catch (Throwable t) {
            finishActive(false, "Handshake frame could not be built");
            return;
        }
        int result = write(g, c, data);
        if (Build.VERSION.SDK_INT >= 33 && result != BluetoothStatusCodes.SUCCESS) {
            finishActive(false, "Handshake write " + (step + 1) + " failed (" + result + ")");
            return;
        }
        listener.onStatus("Sending E10 handshake " + (step + 1) + "/5");
        handler.postDelayed(() -> {
            if (g == gatt && p == probe) sendHandshakeStep(step + 1);
        }, 170L);
    }

    @SuppressLint("MissingPermission")
    private void sendPower() {
        PowerJob job = active;
        BluetoothGatt g = gatt;
        BluetoothGattCharacteristic c = writeChar;
        E10Probe p = probe;
        if (job == null || g == null || c == null || p == null || !p.sessionEstablished()) return;
        byte[] data;
        try {
            data = p.powerCommand(job.on);
        } catch (Throwable t) {
            finishActive(false, "Power command could not be built");
            return;
        }
        int result = write(g, c, data);
        if (Build.VERSION.SDK_INT >= 33 && result != BluetoothStatusCodes.SUCCESS) {
            finishActive(false, "Power write failed (" + result + ")");
            return;
        }
        listener.onStatus(displayName(job.light) + ": " + (job.on ? "ON" : "OFF") + " command written");
        handler.postDelayed(() -> finishActive(true, null), 550L);
    }

    @SuppressLint("MissingPermission")
    private int write(BluetoothGatt g, BluetoothGattCharacteristic c, byte[] data) {
        if (Build.VERSION.SDK_INT >= 33) {
            return g.writeCharacteristic(c, data, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        }
        c.setValue(data);
        c.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        return g.writeCharacteristic(c) ? 0 : -1;
    }

    private void finishActive(boolean success, String error) {
        if (active == null) return;
        if (timeout != null) handler.removeCallbacks(timeout);
        timeout = null;
        processedJobs++;
        if (success) successfulJobs++;
        listener.onProgress(processedJobs, totalJobs);
        if (error != null) listener.onStatus(error + " - moving to next light");
        active = null;
        cleanupGatt();
        handler.postDelayed(this::runNext, 450L);
    }

    @SuppressLint("MissingPermission")
    private void cleanupGatt() {
        BluetoothGatt old = gatt;
        gatt = null;
        writeChar = null;
        probe = null;
        powerSent = false;
        try { if (old != null) old.disconnect(); } catch (Throwable ignored) {}
        try { if (old != null) old.close(); } catch (Throwable ignored) {}
    }

    @SuppressLint("MissingPermission")
    void close() {
        try {
            if (manager != null && manager.getAdapter() != null && manager.getAdapter().getBluetoothLeScanner() != null) {
                manager.getAdapter().getBluetoothLeScanner().stopScan(scanCallback);
            }
        } catch (Throwable ignored) {
        }
        queue.clear();
        active = null;
        cleanupGatt();
    }

    private static String address(BluetoothDevice d) {
        try { return d.getAddress(); } catch (Throwable t) { return ""; }
    }

    private static String displayName(FoundLight light) {
        if (light.model != null && !light.model.isEmpty()) return light.model;
        if (light.name != null && !light.name.isEmpty()) return light.name;
        return "Eufy light";
    }
}

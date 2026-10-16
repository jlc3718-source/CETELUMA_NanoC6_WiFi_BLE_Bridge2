package com.jasonhome.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Minimal persistence for the four installed Eufy light serials used by direct fallback. */
final class DeviceStore {
    private final SharedPreferences prefs;

    DeviceStore(Context context) {
        prefs=context.getApplicationContext().getSharedPreferences("jason_home",Context.MODE_PRIVATE);
    }

    String serialFor(String address,String advertisedName) {
        String hardcoded=hardcodedSerial(address,advertisedName);
        if(validSerial(hardcoded))return hardcoded;

        String saved=prefs.getString(serialKey(address),"");
        if(validSerial(saved))return saved;

        String derived=serialFromName(advertisedName);
        if(!derived.isEmpty()){
            prefs.edit().putString(serialKey(address),derived).apply();
            return derived;
        }
        return "";
    }

    private static String hardcodedSerial(String address,String advertisedName) {
        String a=address==null?"":address.trim().toUpperCase(Locale.ROOT);
        switch(a){
            case "10:2C:B1:0E:C4:01": return "T8L006102353014B";
            case "10:2C:B1:AD:CA:7F": return "T8L00610243503A2";
            case "10:2C:B1:9D:F7:B5": return "T8L028102427474A";
            case "10:2C:B1:EB:27:96": return "T8L0291024470193";
            default: break;
        }

        String n=advertisedName==null?"":advertisedName.trim().toUpperCase(Locale.ROOT);
        switch(n){
            case "T8L00_C401": return "T8L006102353014B";
            case "T8L00_CA7F": return "T8L00610243503A2";
            case "T8L02_F7B5": return "T8L028102427474A";
            case "T8L02_2796": return "T8L0291024470193";
            default: return "";
        }
    }

    private static String serialFromName(String name) {
        if(name==null)return "";
        String n=name.trim(),upper=n.toUpperCase(Locale.ROOT);
        if(!(upper.startsWith("T8L00_")||upper.startsWith("T8L02_")))return "";
        String s=n.substring(0,5)+n.substring(6);
        return validSerial(s)?s:"";
    }

    private static boolean validSerial(String serial) {
        if(serial==null||serial.length()!=16)return false;
        byte[] b=serial.getBytes(StandardCharsets.US_ASCII);
        if(b.length!=16)return false;
        for(byte x:b){int u=x&0xff;if(u<33||u>126)return false;}
        return true;
    }

    private static String serialKey(String address) {
        return "serial_"+(address==null?"":address.replace(':','_'));
    }
}

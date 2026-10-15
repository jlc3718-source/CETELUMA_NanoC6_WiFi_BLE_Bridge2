package com.jasonhome.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-private encrypted persistence for the Eufy cloud session and remembered sign-in. */
final class CloudSessionStore {
    static final class Credentials {
        final String email;
        final String password;
        Credentials(String email,String password){this.email=email;this.password=password;}
    }

    private static final String PREF="jason_home_eufy_cloud";
    private static final String ALIAS="jason_home_eufy_cloud_key_v1";
    private final SharedPreferences prefs;

    CloudSessionStore(Context context){
        prefs=context.getApplicationContext().getSharedPreferences(PREF,Context.MODE_PRIVATE);
    }

    synchronized void saveSession(JSONObject session)throws Exception{
        prefs.edit().putString("session",encrypt(session.toString())).apply();
    }

    synchronized JSONObject loadSession(){
        try{
            String v=prefs.getString("session","");
            return v.isEmpty()?null:new JSONObject(decrypt(v));
        }catch(Throwable t){
            prefs.edit().remove("session").apply();
            return null;
        }
    }

    synchronized void saveCredentials(String email,String password)throws Exception{
        JSONObject o=new JSONObject().put("email",email).put("password",password);
        prefs.edit().putString("credentials",encrypt(o.toString())).apply();
    }

    synchronized Credentials loadCredentials(){
        try{
            String v=prefs.getString("credentials","");
            if(v.isEmpty())return null;
            JSONObject o=new JSONObject(decrypt(v));
            String email=o.optString("email",""),pass=o.optString("password","");
            return email.isEmpty()||pass.isEmpty()?null:new Credentials(email,pass);
        }catch(Throwable t){
            prefs.edit().remove("credentials").apply();
            return null;
        }
    }

    synchronized boolean hasSavedAuth(){
        return !prefs.getString("session","").isEmpty()||!prefs.getString("credentials","").isEmpty();
    }

    synchronized void clearSession(){prefs.edit().remove("session").apply();}
    synchronized void clearAll(){prefs.edit().clear().apply();}

    private SecretKey key()throws Exception{
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        java.security.Key existing=ks.getKey(ALIAS,null);
        if(existing instanceof SecretKey)return(SecretKey)existing;
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return gen.generateKey();
    }

    private String encrypt(String plain)throws Exception{
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE,key());
        byte[] iv=c.getIV();
        byte[] data=c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] both=new byte[iv.length+data.length];
        System.arraycopy(iv,0,both,0,iv.length);
        System.arraycopy(data,0,both,iv.length,data.length);
        return Base64.encodeToString(both,Base64.NO_WRAP);
    }

    private String decrypt(String encoded)throws Exception{
        byte[] both=Base64.decode(encoded,Base64.NO_WRAP);
        if(both.length<13)throw new IllegalArgumentException("Invalid encrypted value");
        byte[] iv=new byte[12];
        System.arraycopy(both,0,iv,0,12);
        byte[] data=new byte[both.length-12];
        System.arraycopy(both,12,data,0,data.length);
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
        return new String(c.doFinal(data),StandardCharsets.UTF_8);
    }
}

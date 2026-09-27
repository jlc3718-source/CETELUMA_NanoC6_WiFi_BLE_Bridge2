package com.jasonhome.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class CloudflareConfigStore {
    static final String ENDPOINT="https://jason-home-cloud.jlc3718.workers.dev";
    private static final String PREF="jason_home_cloudflare";
    private static final String ALIAS="jason_home_cloudflare_key_v1";
    private final SharedPreferences prefs;

    CloudflareConfigStore(Context context){prefs=context.getApplicationContext().getSharedPreferences(PREF,Context.MODE_PRIVATE);}
    boolean isCloudMode(){return "cloud".equals(prefs.getString("mode","direct"));}
    void setCloudMode(boolean cloud){prefs.edit().putString("mode",cloud?"cloud":"direct").apply();}
    boolean hasToken(){return !prefs.getString("token","").isEmpty();}
    void saveToken(String token)throws Exception{prefs.edit().putString("token",encrypt(token==null?"":token.trim())).apply();}
    String token(){
        try{String v=prefs.getString("token","");return v.isEmpty()?"":decrypt(v);}
        catch(Throwable t){prefs.edit().remove("token").apply();return "";}
    }
    void clearToken(){prefs.edit().remove("token").apply();}

    private SecretKey key()throws Exception{
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        java.security.Key existing=ks.getKey(ALIAS,null);if(existing instanceof SecretKey)return(SecretKey)existing;
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return gen.generateKey();
    }
    private String encrypt(String plain)throws Exception{
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());
        byte[] iv=c.getIV(),data=c.doFinal(plain.getBytes(StandardCharsets.UTF_8)),all=new byte[iv.length+data.length];
        System.arraycopy(iv,0,all,0,iv.length);System.arraycopy(data,0,all,iv.length,data.length);
        return Base64.encodeToString(all,Base64.NO_WRAP);
    }
    private String decrypt(String encoded)throws Exception{
        byte[] all=Base64.decode(encoded,Base64.NO_WRAP);if(all.length<13)throw new IllegalArgumentException("Invalid encrypted token");
        byte[] iv=new byte[12],data=new byte[all.length-12];System.arraycopy(all,0,iv,0,12);System.arraycopy(all,12,data,0,data.length);
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
        return new String(c.doFinal(data),StandardCharsets.UTF_8);
    }
}

package com.jasonhome.app;

import java.io.*;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.ECPublicKey;
import java.security.spec.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Wire primitives ported from the validated Home Wi-Fi Test cloud transport. */
public final class CloudWire {
    static final String LOCAL="2500a7d5617812f9d52515b2c8f20a3d";
    static final String SERVER="04c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a3868d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076";
    static final SecureRandom RAND=new SecureRandom();

    static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
    static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte v:b)s.append(String.format(Locale.US,"%02x",v&255));return s.toString();}
    static byte[] unhex(String s){if(s==null||!s.matches("(?:[0-9a-fA-F]{2})*"))throw new IllegalArgumentException("Invalid hex");byte[] b=new byte[s.length()/2];for(int i=0;i<b.length;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);return b;}
    static String id(){byte[] b=new byte[16];RAND.nextBytes(b);return hex(b);}
    static byte[] concat(byte[]... parts)throws IOException{ByteArrayOutputStream b=new ByteArrayOutputStream();for(byte[] p:parts)b.write(p);return b.toByteArray();}
    static String encrypt(String plain,String key)throws Exception{byte[] iv=new byte[16];RAND.nextBytes(iv);Cipher c=Cipher.getInstance("AES/CBC/PKCS5Padding");c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(unhex(key),"AES"),new IvParameterSpec(iv));return Base64.getEncoder().encodeToString(concat(iv,c.doFinal(bytes(plain))));}
    static String decrypt(String input,String key)throws Exception{byte[] b=Base64.getDecoder().decode(input);if(b.length<32||(b.length%16)!=0)throw new IOException("Invalid encrypted body length");Cipher c=Cipher.getInstance("AES/CBC/PKCS5Padding");c.init(Cipher.DECRYPT_MODE,new SecretKeySpec(unhex(key),"AES"),new IvParameterSpec(b,0,16));return new String(c.doFinal(b,16,b.length-16),StandardCharsets.UTF_8);}
    static String signature(String key,String ts,String once,String body)throws Exception{Mac m=Mac.getInstance("HmacSHA256");m.init(new SecretKeySpec(bytes(key.substring(0,32)),"HmacSHA256"));return hex(m.doFinal(bytes(ts+"+"+once+"+"+body)));}
    static String md5(String s)throws Exception{return hex(MessageDigest.getInstance("MD5").digest(bytes(s)));}
    static KeyPair pair()throws Exception{KeyPairGenerator k=KeyPairGenerator.getInstance("EC");k.initialize(new ECGenParameterSpec("secp256r1"));return k.generateKeyPair();}
    static byte[] fixed(BigInteger n){byte[] a=n.toByteArray(),b=new byte[32];int length=Math.min(a.length,32);System.arraycopy(a,a.length-length,b,32-length,length);return b;}
    static String publicHex(KeyPair k)throws Exception{ECPublicKey p=(ECPublicKey)k.getPublic();return hex(concat(new byte[]{4},fixed(p.getW().getAffineX()),fixed(p.getW().getAffineY())));}
    static byte[] secret(KeyPair k,String server)throws Exception{byte[] p=unhex(server);if(p.length!=65||p[0]!=4)throw new IOException("Invalid server EC point");ECParameterSpec params=((ECPublicKey)k.getPublic()).getParams();PublicKey pub=KeyFactory.getInstance("EC").generatePublic(new ECPublicKeySpec(new ECPoint(new BigInteger(1,Arrays.copyOfRange(p,1,33)),new BigInteger(1,Arrays.copyOfRange(p,33,65))),params));KeyAgreement agreement=KeyAgreement.getInstance("ECDH");agreement.init(k.getPrivate());agreement.doPhase(pub,true);return agreement.generateSecret();}
    static String[] password(String password)throws Exception{KeyPair k=pair();byte[] s=secret(k,SERVER);Cipher c=Cipher.getInstance("AES/CBC/PKCS5Padding");c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(s,"AES"),new IvParameterSpec(s,0,16));return new String[]{publicHex(k),Base64.getEncoder().encodeToString(c.doFinal(bytes(password)))};}
    static void tlv(ByteArrayOutputStream b,int tag,byte[] v)throws Exception{if(v.length>255)throw new IOException("TLV too long");b.write(tag);b.write(v.length);b.write(v);}
    static byte[] dp(int subtype,String account,int tag,byte[] value,long timestamp)throws Exception{
        ByteArrayOutputStream payload=new ByteArrayOutputStream();
        tlv(payload,tag,value);
        return dpCommand(0x0200|(subtype&0xff),account,payload.toByteArray(),timestamp);
    }
    static byte[] dpCommand(int opcode,String account,byte[] commandFields,long timestamp)throws Exception{
        if(account==null||account.isEmpty())throw new IOException("Account identity missing");
        if((opcode&0xff00)!=0x0200)throw new IOException("Unsupported lighting opcode");
        ByteArrayOutputStream fields=new ByteArrayOutputStream();
        tlv(fields,0xa1,new byte[]{(byte)timestamp,(byte)(timestamp>>8),(byte)(timestamp>>16),(byte)(timestamp>>24)});
        tlv(fields,0xa2,bytes(account));
        if(commandFields!=null&&commandFields.length>0)fields.write(commandFields);
        byte[] f=fields.toByteArray();
        int size=10+f.length;
        ByteArrayOutputStream b=new ByteArrayOutputStream();
        b.write(new byte[]{(byte)0xff,9,(byte)size,(byte)(size>>8),3,0,2,(byte)(opcode>>8),(byte)opcode});
        b.write(f);
        int xor=0;for(byte v:b.toByteArray())xor^=v&255;
        b.write(xor);
        return b.toByteArray();
    }
    static void utf(DataOutputStream d,String s)throws IOException{byte[] b=bytes(s);if(b.length>65535)throw new IOException("MQTT string too long");d.writeShort(b.length);d.write(b);}
    static void packet(OutputStream out,int header,byte[] body)throws IOException{if(body.length>1048576)throw new IOException("MQTT packet too large");out.write(header);int n=body.length;do{int x=n%128;n/=128;out.write(n>0?x|128:x);}while(n>0);out.write(body);out.flush();}
    static final class Packet{final int header;final byte[] data;Packet(int h,byte[] b){header=h;data=b;}int type(){return header>>4;}}
    static Packet read(InputStream in)throws IOException{return readAfterHeader(in.read(),in);}
    static Packet readAfterHeader(int h,InputStream in)throws IOException{if(h<0)throw new EOFException("MQTT broker closed connection");int len=0,m=1;for(int i=0;i<4;i++){int x=in.read();if(x<0)throw new EOFException();len+=(x&127)*m;if(len>1048576)throw new IOException("MQTT incoming packet exceeds limit");if((x&128)==0){byte[] b=new byte[len];new DataInputStream(in).readFully(b);return new Packet(h,b);}m*=128;}throw new IOException("Malformed MQTT remaining length");}
}

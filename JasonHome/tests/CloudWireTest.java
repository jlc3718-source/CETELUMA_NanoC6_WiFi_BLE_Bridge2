package com.jasonhome.app;
import java.io.*;import java.util.*;import java.security.*;
public class CloudWireTest{
 static void eq(Object a,Object b){if(!a.equals(b))throw new AssertionError("Mismatch: "+a+" vs "+b);}
 public static void main(String[] args)throws Exception{
  eq(CloudWire.decrypt("Dw4NDAsKCQgHBgUEAwIBAON7nAdtN7DzIooLLHfGyy/gYJMK1jWa/qbASxRBJcl6Hw62mx/9J0Bw1nLTUhsURA==","0123456789abcdef0123456789abcdef"),"{\"example\":\"synthetic-test-vector\",\"n\":42}");
  eq(CloudWire.signature("0123456789abcdef0123456789abcdef","1700000000","00112233445566778899aabbccddeeff","Dw4NDAsKCQgHBgUEAwIBAON7nAdtN7DzIooLLHfGyy/gYJMK1jWa/qbASxRBJcl6Hw62mx/9J0Bw1nLTUhsURA=="),"9860cd44b02b7b68e7feb1ea128e87c8304982b3de1250a5b49c0fda96f0ba10");
  eq(CloudWire.hex(CloudWire.dp(0,"0000000000000000000000000000000000000000",0xa3,CloudWire.unhex("ff1f"),1700000000L)),"ff093e000300020200a10400f15365a22830303030303030303030303030303030303030303030303030303030303030303030303030303030a302ff1f62");
  eq(CloudWire.hex(CloudWire.dp(1,"0000000000000000000000000000000000000000",0xa3,CloudWire.unhex("01"),1700000000L)),"ff093d000300020201a10400f15365a22830303030303030303030303030303030303030303030303030303030303030303030303030303030a3010182");
  eq(CloudWire.hex(CloudWire.dp(1,"0000000000000000000000000000000000000000",0xa3,CloudWire.unhex("00"),1700000000L)),"ff093d000300020201a10400f15365a22830303030303030303030303030303030303030303030303030303030303030303030303030303030a3010083");
  eq(CloudWire.md5("abc"),"900150983cd24fb0d6963f7d28e17f72");
  KeyPair a=CloudWire.pair(),b=CloudWire.pair();eq(CloudWire.hex(CloudWire.secret(a,CloudWire.publicHex(b))),CloudWire.hex(CloudWire.secret(b,CloudWire.publicHex(a))));
  for(int size:new int[]{0,1,127,128,16384}){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] body=new byte[size];Arrays.fill(body,(byte)42);CloudWire.packet(out,0x30,body);CloudWire.Packet result=CloudWire.read(new ByteArrayInputStream(out.toByteArray()));if(result.header!=0x30||!Arrays.equals(body,result.data))throw new AssertionError("MQTT length decoding");}
  boolean rejected=false;try{CloudWire.read(new ByteArrayInputStream(new byte[]{0x30,(byte)255,(byte)255,(byte)255,(byte)255}));}catch(IOException e){rejected=true;}if(!rejected)throw new AssertionError("Malformed MQTT accepted");
  rejected=false;try{CloudWire.dp(1,"",0xa3,new byte[]{1},1700000000L);}catch(IOException e){rejected=true;}if(!rejected)throw new AssertionError("Empty account accepted");
  System.out.println("PASS: cloud AES/HMAC/ECDH, exact Eufy status/on/off DP fixtures, MQTT lengths.");
 }
}

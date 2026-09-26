package com.jasonhome.app;

import java.io.File;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Standalone regression test. All identifiers and keys below are synthetic. */
public final class E10ProbeRegression {
    private static final String SERIAL = "T8L0012345678901";
    private static final String ACCOUNT = "0123456789abcdef0123456789abcdef01234567";
    private static final byte[] SESSION = "synthetic-key-16".getBytes(StandardCharsets.US_ASCII);
    private static int checks;

    public static void main(String[] args) throws Exception {
        // 16-byte fixtures with no customer data.
        check(SERIAL.length() == 16 && ACCOUNT.length() == 40 && SESSION.length == 16, "fixture lengths");
        testReasonsAndPrivacy();
        testFramesAndPower();
        if (args.length == 2) compareOriginalKotlin(args[0], args[1]);
        System.out.println("PASS: " + checks + " protocol checks" +
            (args.length == 2 ? "; original 3.0 Kotlin oracle matched all 5 handshake frames and ON/OFF" : ""));
    }

    private static void testReasonsAndPrivacy() throws Exception {
        E10Probe p = new E10Probe(SERIAL, ACCOUNT);
        reason(p, null, E10Probe.Reason.NO_INPUT);
        reason(p, new byte[3], E10Probe.Reason.TOO_SHORT);
        reason(p, new byte[42], E10Probe.Reason.BAD_MAGIC);
        byte[] valid = sessionResponse();
        byte[] bad = valid.clone(); bad[2]++;
        reason(p, bad, E10Probe.Reason.DECLARED_LENGTH_MISMATCH);
        bad = valid.clone(); bad[bad.length - 1] ^= 1;
        reason(p, bad, E10Probe.Reason.BAD_XOR);
        for (int cmd : new int[]{0x0801, 0x0829, 0x0803, 0x0805})
            reason(p, frame(cmd, new byte[0], 1, 1), E10Probe.Reason.INTERMEDIATE_ACK);
        reason(p, frame(0x0800, new byte[0], 1, 1), E10Probe.Reason.COMMAND_NOT_4822);
        reason(p, frame(0x4822, new byte[17], 1, 1), E10Probe.Reason.CIPHERTEXT_NOT_BLOCK_ALIGNED);
        reason(p, frame(0x4822, crypt(new byte[16], false), 1, 1), E10Probe.Reason.BAD_PADDING);
        reason(p, frame(0x4822, crypt(new byte[]{(byte)0xA2, 1, 0}, true), 1, 1), E10Probe.Reason.SESSION_TLV_NOT_FOUND);
        check(!p.sessionEstablished(), "invalid replies cannot establish session");
        E10Probe.NotificationResult result = p.inspectNotification(valid);
        check(result.accepted() && p.sessionEstablished(), "valid session response accepted");
        check(!result.summary.contains(ACCOUNT) && !result.summary.contains(new String(SESSION, StandardCharsets.US_ASCII)), "no secrets in RX summary");
        String tx = E10Probe.packetSummary(p.step(0));
        check(!tx.contains(ACCOUNT) && tx.substring(tx.indexOf("hdr=") + 4, tx.indexOf(" cmd=")).split(" ").length == 9, "log contains framing bytes only");
        try { new E10Probe("é" + SERIAL.substring(1), ACCOUNT); throw new AssertionError("non-ASCII serial accepted"); }
        catch (IllegalArgumentException expected) { checks++; }
    }

    private static void testFramesAndPower() throws Exception {
        E10Probe p = new E10Probe(SERIAL, ACCOUNT);
        int[] cmds = {1, 0x29, 3, 5, 0x4022};
        for (int i = 0; i < 5; i++) {
            byte[] f = p.step(i);
            check(u16le(f, 2) == f.length && xor(f) == 0, "length/checksum step " + i);
            check(u16le(f, 4) == i + 1 && f[6] == 1 && u16be(f, 7) == cmds[i], "header step " + i);
            byte[] body = Arrays.copyOfRange(f, 9, f.length - 1);
            if (i == 4) body = decrypt(body, ACCOUNT.substring(0, 16).getBytes(StandardCharsets.US_ASCII));
            check(body[0] == (byte)0xA1 && body[1] == 4 && body[6] == (byte)0xA2 && body[7] == 40, "timestamp TLV order step " + i);
            check(Arrays.equals(Arrays.copyOfRange(body, 8, 48), ACCOUNT.getBytes(StandardCharsets.US_ASCII)), "account TLV step " + i);
        }
        check(p.acceptNotification(sessionResponse()), "session fixture accepted");
        for (boolean on : new boolean[]{true, false}) {
            byte[] f = p.powerCommand(on);
            byte[] plain = decrypt(Arrays.copyOfRange(f, 9, f.length - 1), SESSION);
            check(f[6] == 2 && u16be(f, 7) == 0x4201 && xor(f) == 0, "power frame");
            check(plain[0] == (byte)0xA1 && plain[1] == 4 && plain[48] == (byte)0xA3 && plain[49] == 1 && plain[50] == (on ? 1 : 0), "power TLVs");
        }
    }

    private static void compareOriginalKotlin(String classDir, String stdlib) throws Exception {
        try (URLClassLoader loader = new URLClassLoader(new URL[]{new File(classDir).toURI().toURL(), new File(stdlib).toURI().toURL()}, ClassLoader.getPlatformClassLoader())) {
            Class<?> old = loader.loadClass("com.jasonhome.app.E10Probe");
            for (int attempt = 0; attempt < 20; attempt++) {
                long before = System.currentTimeMillis() / 1000;
                Object oracle = old.getConstructor(String.class, String.class).newInstance(SERIAL, ACCOUNT);
                E10Probe current = new E10Probe(SERIAL, ACCOUNT);
                boolean match = true;
                for (int i = 0; i < 5; i++)
                    match &= Arrays.equals((byte[])old.getMethod("step", int.class).invoke(oracle, i), current.step(i));
                check((Boolean)old.getMethod("acceptNotification", byte[].class).invoke(oracle, (Object)sessionResponse()), "original oracle accepts session fixture");
                check(current.acceptNotification(sessionResponse()), "current oracle accepts session fixture");
                for (boolean on : new boolean[]{true, false})
                    match &= Arrays.equals((byte[])old.getMethod("powerCommand", boolean.class).invoke(oracle, on), current.powerCommand(on));
                if (before != System.currentTimeMillis() / 1000) continue; // A real timestamp boundary is not a protocol difference.
                check(match, "byte-for-byte original 3.0 handshake and ON/OFF parity");
                return;
            }
            throw new AssertionError("Could not obtain a same-second oracle comparison");
        }
    }

    private static byte[] sessionResponse() throws Exception {
        byte[] plain = new byte[18]; plain[0] = (byte)0xA1; plain[1] = 16;
        System.arraycopy(SESSION, 0, plain, 2, 16);
        return frame(0x4822, crypt(plain, true), 5, 1);
    }
    private static byte[] crypt(byte[] plain, boolean padding) throws Exception {
        Cipher c = Cipher.getInstance("AES/CBC/" + (padding ? "PKCS5Padding" : "NoPadding"));
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(ACCOUNT.substring(0, 16).getBytes(StandardCharsets.US_ASCII), "AES"), new IvParameterSpec(SERIAL.getBytes(StandardCharsets.US_ASCII)));
        return c.doFinal(plain);
    }
    private static byte[] decrypt(byte[] encrypted, byte[] key) throws Exception {
        Cipher c = Cipher.getInstance("AES/CBC/PKCS5Padding");
        c.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(SERIAL.getBytes(StandardCharsets.US_ASCII)));
        return c.doFinal(encrypted);
    }
    private static byte[] frame(int cmd, byte[] body, int seq, int ch) {
        byte[] f = new byte[body.length + 10];
        f[0]=(byte)255; f[1]=9; f[2]=(byte)f.length; f[3]=(byte)(f.length>>8);
        f[4]=(byte)seq; f[5]=(byte)(seq>>8); f[6]=(byte)ch; f[7]=(byte)(cmd>>8); f[8]=(byte)cmd;
        System.arraycopy(body, 0, f, 9, body.length); f[f.length-1]=(byte)xor(f); return f;
    }
    private static int u16le(byte[] b,int i) { return (b[i]&255)|((b[i+1]&255)<<8); }
    private static int u16be(byte[] b,int i) { return ((b[i]&255)<<8)|(b[i+1]&255); }
    private static int xor(byte[] b) { int v=0; for(byte x:b)v^=x&255; return v; }
    private static void reason(E10Probe p, byte[] f, E10Probe.Reason reason) { check(p.inspectNotification(f).reason == reason, "parser reason " + reason); }
    private static void check(boolean ok,String message) { if(!ok)throw new AssertionError(message); checks++; }
}

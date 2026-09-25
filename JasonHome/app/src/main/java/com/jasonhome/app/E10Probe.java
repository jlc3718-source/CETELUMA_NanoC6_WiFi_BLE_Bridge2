package com.jasonhome.app;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Reconstructed from Jason Home 3.0's working E120 path.
 * Keep framing and crypto unchanged without a real-light regression test.
 */
final class E10Probe {
    private final byte[] iv;
    private final byte[] initialKey;
    private final String userId;
    private int sequence = 1;
    private byte[] sessionKey;
    private boolean sessionEstablished;

    E10Probe(String serial, String userId) {
        if (!validAscii(serial, 16)) throw new IllegalArgumentException("Serial must be 16 ASCII characters");
        if (!validAscii(userId, 40)) throw new IllegalArgumentException("User ID must be 40 ASCII characters");
        this.iv = serial.getBytes(StandardCharsets.US_ASCII);
        this.userId = userId;
        this.initialKey = userId.substring(0, 16).getBytes(StandardCharsets.US_ASCII);
    }

    boolean sessionEstablished() {
        return sessionEstablished;
    }

    byte[] step(int step) {
        byte[] base = base();
        byte[] setup = new byte[] {
            (byte)0xA3, 0x01, 0x20,
            (byte)0xA4, 0x02, (byte)0x96, 0x00
        };
        byte[] finalParams = new byte[] {
            (byte)0xA3, 0x04, (byte)0xE0, (byte)0xE3, (byte)0xFF, (byte)0xFF
        };
        int command;
        byte[] payload;
        switch (step) {
            case 0: command = 0x0001; payload = base; break;
            case 1: command = 0x0029; payload = base; break;
            case 2: command = 0x0003; payload = concat(base, setup); break;
            case 3: command = 0x0005; payload = concat(base, setup); break;
            case 4: command = 0x4022; payload = encrypt(concat(base, finalParams), initialKey); break;
            default: throw new IllegalArgumentException("Invalid handshake step");
        }
        return frame(command, payload, 1, false);
    }

    boolean acceptNotification(byte[] input) {
        if (input == null || input.length < 26) return false;
        if ((input[0] & 0xff) != 0xff || (input[1] & 0xff) != 0x09) return false;
        if ((input[7] & 0xff) != 0x48 || (input[8] & 0xff) != 0x22) return false;
        int xor = 0;
        for (byte b : input) xor ^= b & 0xff;
        if (xor != 0) return false;
        int declared = (input[2] & 0xff) | ((input[3] & 0xff) << 8);
        if (declared != input.length) return false;
        try {
            byte[] encrypted = Arrays.copyOfRange(input, 9, input.length - 1);
            byte[] decrypted = decrypt(encrypted, initialKey);
            int pad = decrypted[decrypted.length - 1] & 0xff;
            if (pad < 1 || pad > 16) return false;
            for (int i = decrypted.length - pad; i < decrypted.length; i++) {
                if ((decrypted[i] & 0xff) != pad) return false;
            }
            byte[] plain = Arrays.copyOfRange(decrypted, 0, decrypted.length - pad);
            for (int i = 0; i + 18 <= plain.length; i++) {
                if ((plain[i] & 0xff) == 0xA1 && (plain[i + 1] & 0xff) == 0x10) {
                    sessionKey = Arrays.copyOfRange(plain, i + 2, i + 18);
                    sessionEstablished = true;
                    return true;
                }
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    byte[] powerCommand(boolean on) {
        byte[] power = new byte[] {(byte)0xA3, 0x01, (byte)(on ? 1 : 0)};
        return command(0x0201, power);
    }

    byte[] command(int opcode, byte[] params) {
        if (sessionKey == null) throw new IllegalStateException("Complete handshake first");
        if (params == null) params = new byte[0];
        return frame(opcode, encrypt(concat(base(), params), sessionKey), 2, true);
    }

    private byte[] base() {
        int seconds = (int)(System.currentTimeMillis() / 1000L);
        byte[] ts = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(seconds).array();
        byte[] account = userId.getBytes(StandardCharsets.US_ASCII);
        byte[] tags = new byte[] {(byte)0xA1, 0x04, (byte)0xA2, 0x28};
        return concat(ts, tags, account);
    }

    private byte[] frame(int commandId, byte[] payload, int channel, boolean flagged) {
        int total = payload.length + 10;
        int seq = sequence++;
        int wire = flagged ? (commandId | 0x4000) : commandId;
        byte[] header = new byte[] {
            (byte)0xFF, 0x09,
            (byte)total, (byte)(total >>> 8),
            (byte)seq, (byte)(seq >>> 8),
            (byte)channel,
            (byte)(wire >>> 8), (byte)wire
        };
        byte[] body = concat(header, payload);
        int checksum = 0;
        for (byte b : body) checksum ^= b & 0xff;
        return concat(body, new byte[] {(byte)checksum});
    }

    private byte[] encrypt(byte[] data, byte[] key) {
        try {
            int pad = 16 - (data.length % 16);
            byte[] padded = Arrays.copyOf(data, data.length + pad);
            Arrays.fill(padded, data.length, padded.length, (byte)pad);
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
            return cipher.doFinal(padded);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private byte[] decrypt(byte[] data, byte[] key) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return cipher.doFinal(data);
    }

    private static boolean validAscii(String s, int length) {
        if (s == null || s.length() != length) return false;
        byte[] b = s.getBytes(StandardCharsets.US_ASCII);
        if (b.length != length) return false;
        for (byte x : b) {
            int u = x & 0xff;
            if (u < 33 || u > 126) return false;
        }
        return true;
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (byte[] p : parts) out.write(p, 0, p.length);
        return out.toByteArray();
    }
}

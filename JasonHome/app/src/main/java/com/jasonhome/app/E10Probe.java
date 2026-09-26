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
 * Wire format verified against the actual Jason Home 3.0 Kotlin APK.
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

    enum Reason {
        NO_INPUT, TOO_SHORT, BAD_MAGIC, DECLARED_LENGTH_MISMATCH, BAD_XOR,
        INTERMEDIATE_ACK, COMMAND_NOT_4822, CIPHERTEXT_NOT_BLOCK_ALIGNED,
        AES_DECRYPT_FAILED, BAD_PADDING, SESSION_TLV_NOT_FOUND, SESSION_ACCEPTED
    }

    static final class NotificationResult {
        final Reason reason;
        final String summary;
        NotificationResult(Reason reason, byte[] input) {
            this.reason = reason;
            this.summary = packetSummary(input) + " → " + reason;
        }
        boolean accepted() { return reason == Reason.SESSION_ACCEPTED; }
    }

    // Only the nine framing bytes are safe to display. Bytes 9+ are payload.
    static String packetSummary(byte[] input) {
        if (input == null) return "len=0";
        StringBuilder b = new StringBuilder("len=").append(input.length);
        if (input.length >= 9 && (input[0] & 0xff) == 0xff && input[1] == 9) {
            b.append(" hdr=");
            for (int i = 0; i < 9; i++) {
                if (i > 0) b.append(' ');
                b.append(String.format(java.util.Locale.ROOT, "%02X", input[i] & 0xff));
            }
            b.append(String.format(java.util.Locale.ROOT, " cmd=%04X", u16be(input, 7)))
             .append(" ch=").append(input[6] & 0xff)
             .append(" seq=").append(u16le(input, 4))
             .append(" declared=").append(u16le(input, 2))
             .append(" xor=").append(xor(input) == 0 ? "OK" : "BAD")
             .append((u16be(input, 7) & 0x4000) != 0 ? " cipher=" : " payload=")
             .append(Math.max(0, input.length - 10));
        }
        return b.toString();
    }

    String notificationSummary(byte[] input) { return packetSummary(input); }

    boolean acceptNotification(byte[] input) { return inspectNotification(input).accepted(); }

    NotificationResult inspectNotification(byte[] input) {
        if (input == null) return result(Reason.NO_INPUT, input);
        if (input.length < 10) return result(Reason.TOO_SHORT, input);
        if ((input[0] & 0xff) != 0xff || input[1] != 9) return result(Reason.BAD_MAGIC, input);
        if (u16le(input, 2) != input.length) return result(Reason.DECLARED_LENGTH_MISMATCH, input);
        if (xor(input) != 0) return result(Reason.BAD_XOR, input);
        int command = u16be(input, 7);
        if (command == 0x0801 || command == 0x0829 || command == 0x0803 || command == 0x0805)
            return result(Reason.INTERMEDIATE_ACK, input);
        if (command != 0x4822) return result(Reason.COMMAND_NOT_4822, input);
        int cipherLength = input.length - 10;
        if (cipherLength == 0 || cipherLength % 16 != 0)
            return result(Reason.CIPHERTEXT_NOT_BLOCK_ALIGNED, input);
        try {
            byte[] encrypted = Arrays.copyOfRange(input, 9, input.length - 1);
            byte[] decrypted = decrypt(encrypted, initialKey);
            int pad = decrypted[decrypted.length - 1] & 0xff;
            if (pad < 1 || pad > 16) return result(Reason.BAD_PADDING, input);
            for (int i = decrypted.length - pad; i < decrypted.length; i++) {
                if ((decrypted[i] & 0xff) != pad) return result(Reason.BAD_PADDING, input);
            }
            byte[] plain = Arrays.copyOfRange(decrypted, 0, decrypted.length - pad);
            for (int i = 0; i + 18 <= plain.length; i++) {
                if ((plain[i] & 0xff) == 0xA1 && (plain[i + 1] & 0xff) == 0x10) {
                    sessionKey = Arrays.copyOfRange(plain, i + 2, i + 18);
                    sessionEstablished = true;
                    return result(Reason.SESSION_ACCEPTED, input);
                }
            }
        } catch (Exception ignored) {
            return result(Reason.AES_DECRYPT_FAILED, input);
        }
        return result(Reason.SESSION_TLV_NOT_FOUND, input);
    }

    private static NotificationResult result(Reason reason, byte[] input) {
        return new NotificationResult(reason, input);
    }
    private static int u16le(byte[] b, int i) { return (b[i] & 255) | ((b[i + 1] & 255) << 8); }
    private static int u16be(byte[] b, int i) { return ((b[i] & 255) << 8) | (b[i + 1] & 255); }
    private static int xor(byte[] input) {
        int value = 0;
        for (byte b : input) value ^= b & 255;
        return value;
    }

    byte[] powerCommand(boolean on) {
        byte[] power = new byte[] {(byte)0xA3, 0x01, (byte)(on ? 1 : 0)};
        return command(0x0201, power);
    }

    // Exact 4.0.15 pre-ON E22 state request recovered from the working APK:
    // opcode 0x0200, payload A3 04 FF 01 00 00.
    byte[] stateCommand() {
        return command(0x0200, new byte[] {
            (byte)0xA3, 0x04, (byte)0xFF, 0x01, 0x00, 0x00
        });
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
        // 3.0: A1 04 <timestamp LE> A2 28 <40 ASCII account bytes>.
        // The Java reconstruction incorrectly moved the timestamp ahead of A1.
        return concat(new byte[] {(byte)0xA1, 0x04}, ts,
            new byte[] {(byte)0xA2, 0x28}, account);
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
        for (int i = 0; i < s.length(); i++) {
            int u = s.charAt(i);
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

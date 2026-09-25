package com.jasonhome.app;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Eufy E10 light command parameter encoders.
 *
 * 0x0201 SetUpDeviceCmd:
 *   A3 power, A4 brightness.
 *
 * 0x0206 LightTransportNewCmd:
 *   A3 local/dynamic light id, A4 direction, A5 speed, A6 palette,
 *   A7 grouped lamp positions for local 20xxx effects, A8 brightness,
 *   A9 calibration/offset, AA flags, AC cloud id when present, AE/B0 update flags.
 *
 * 0x020D LightShowCmd:
 *   A3 show id, A4 speed, A5 layer count, A6 execution mode, A8 reserved,
 *   A9+ encoded layer bodies.
 *
 * The field order/layout follows the recovered Eufy Flutter/native serializers.
 * T8L00/E120 uses RGBW entries; T8L02/E22 uses RGBCW entries.
 */
final class EufyLightCommands {
    static final int OP_SETUP = 0x0201;
    static final int OP_COLOR = 0x0206;
    static final int OP_SHOW = 0x020D;

    private static final int LOCAL_COLOR_ID = 20006;

    static byte[] brightness(int percent) {
        return tlv(0xA4, new byte[]{(byte) clamp(percent, 0, 100)});
    }

    static byte[] color(String model, int rgb, int lampCount) {
        int lamps = clamp(lampCount, 1, 120);
        byte[] nativeColor = nativeColor(model, rgb);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, tlv(0xA3, le16(LOCAL_COLOR_ID)));
        write(out, tlv(0xA4, le16(0)));
        write(out, tlv(0xA5, new byte[]{1}));

        ByteArrayOutputStream palette = new ByteArrayOutputStream();
        palette.write(1);
        write(palette, nativeColor);
        write(out, tlv(0xA6, palette.toByteArray()));

        byte[] positions = new byte[lamps + 1];
        positions[0] = (byte) lamps;
        for (int i = 0; i < lamps; i++) positions[i + 1] = (byte) i;
        write(out, tlv(0xA7, positions));

        write(out, tlv(0xA8, new byte[]{100}));
        write(out, tlv(0xA9, new byte[]{0,0,0,0,0}));
        write(out, tlv(0xAA, new byte[]{0}));
        write(out, tlv(0xAE, new byte[]{0}));
        write(out, tlv(0xB0, new byte[]{0}));
        return out.toByteArray();
    }

    static byte[] white(String model, int kelvin, int lampCount) {
        if (!isE22(model)) {
            // E120 exposes one warm-white channel; use its nominal 3000 K white.
            return color(model, 0xFFF1C7, lampCount);
        }
        int k = clamp(kelvin, 1500, 9000);
        float t = (k - 1500f) / 7500f;
        int warm = Math.round(255f * (1f - t));
        int cool = Math.round(255f * t);
        return colorNative(model, new byte[]{0,0,0,(byte)warm,(byte)cool}, lampCount);
    }

    private static byte[] colorNative(String model, byte[] nativeColor, int lampCount) {
        int lamps = clamp(lampCount, 1, 120);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, tlv(0xA3, le16(LOCAL_COLOR_ID)));
        write(out, tlv(0xA4, le16(0)));
        write(out, tlv(0xA5, new byte[]{1}));
        ByteArrayOutputStream palette = new ByteArrayOutputStream();
        palette.write(1);
        write(palette, nativeColor);
        write(out, tlv(0xA6, palette.toByteArray()));
        byte[] positions = new byte[lamps + 1];
        positions[0] = (byte) lamps;
        for (int i=0;i<lamps;i++) positions[i+1]=(byte)i;
        write(out, tlv(0xA7, positions));
        write(out, tlv(0xA8, new byte[]{100}));
        write(out, tlv(0xA9, new byte[]{0,0,0,0,0}));
        write(out, tlv(0xAA, new byte[]{0}));
        write(out, tlv(0xAE, new byte[]{0}));
        write(out, tlv(0xB0, new byte[]{0}));
        return out.toByteArray();
    }

    static byte[] show(String model, String effectName, int[] colors, int speed1to5, boolean reverse) {
        int[] palette = colors == null || colors.length == 0 ? new int[]{0xFFFFFF} : colors;
        int speed = speedValue(speed1to5);
        int effectIndex = effectIndex(effectName);
        int showId = 21000 + effectIndex;

        int layerType = layerType(effectName);
        byte[] layer = encodeLayer(model, layerType, effectName, palette, speed, reverse);

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        write(out, tlv(0xA3, le32(showId)));
        write(out, tlv(0xA4, new byte[]{(byte)speed}));
        write(out, tlv(0xA5, new byte[]{1}));
        write(out, tlv(0xA6, new byte[]{0}));
        write(out, tlv(0xA8, new byte[]{0}));
        write(out, tlv(0xA9, layer));
        return out.toByteArray();
    }

    private static byte[] encodeLayer(String model, int layerType, String effectName, int[] colors, int speed, boolean reverse) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();

        // layer_priority, layer_speed, range_hi, range_lo, interval_type,
        // interval_value, layer_execution_parameter (BE), post-cycle-status, type.
        write(out, new byte[]{
            0, (byte)speed, 100, 0, 1, 1, 0, 1, 0, (byte)layerType
        });

        out.write(colors.length & 0xFF);
        for (int color : colors) write(out, nativeColor(model, color));

        if (layerType == 0) {
            boolean chase = contains(effectName, "Chase") || contains(effectName, "Candy") || contains(effectName, "Meteor");
            boolean gradient = contains(effectName, "Gradient") || contains(effectName, "Rainbow");
            boolean wipe = contains(effectName, "Wipe");
            boolean pulse = contains(effectName, "Pulse");
            int fillMode = wipe ? 1 : 0;
            int pickMode = gradient ? 1 : 0;
            int flowDirection = reverse ? 1 : 0;
            int directionChange = 0;
            int gradientValue = gradient ? 8 : 0;
            int insertMode = chase ? 1 : 0;
            int insertRange = contains(effectName, "Candy") ? 4 : (contains(effectName, "Meteor") ? 3 : 2);
            int blackMode = contains(effectName, "Meteor") ? 1 : 0;
            int blackRange = contains(effectName, "Meteor") ? 9 : 0;
            int blackPosition = 0;
            int brightnessVariation = pulse ? 1 : 0;
            int brightnessHi = 100;
            int brightnessLo = pulse ? 20 : 100;
            int cycleMethod = 0;
            int executionParameter = 0;
            write(out, new byte[]{
                (byte)fillMode, (byte)pickMode, (byte)flowDirection, (byte)directionChange,
                (byte)(gradientValue >>> 8), (byte)gradientValue,
                (byte)insertMode, (byte)insertRange,
                (byte)blackMode, 0, (byte)blackRange, (byte)blackPosition,
                (byte)brightnessVariation, (byte)brightnessHi, (byte)brightnessLo,
                (byte)cycleMethod, (byte)executionParameter
            });
        } else if (layerType == 1) {
            boolean breath = contains(effectName, "Breath");
            boolean jump = contains(effectName, "Jump");
            int transitionMode = breath ? 2 : 0;
            int switchMode = jump ? 1 : 0;
            int sequence = colors.length > 1 ? 1 : 0;
            write(out, new byte[]{
                100, 1, (byte)Math.max(1, colors.length),
                (byte)transitionMode, (byte)switchMode, 0, 0,
                (byte)sequence, 0, 0
            });
        } else {
            boolean twinkle = contains(effectName, "Twinkle");
            int brightnessVariation = 0;
            int brightnessHi = 100;
            int brightnessLo = 20;
            int blinkCycles = 1;
            int positionMode = twinkle ? 1 : 0;
            int intervalHi = twinkle ? 6 : 2;
            int intervalLo = twinkle ? 2 : 1;
            int quantity = twinkle ? Math.min(255, Math.max(3, colors.length * 3)) : 255;
            int asyncFlag = twinkle ? 1 : 0;
            int colorSwitch = colors.length > 1 ? 2 : 0;
            write(out, new byte[]{
                (byte)brightnessVariation,(byte)brightnessHi,(byte)brightnessLo,
                (byte)blinkCycles,(byte)positionMode,(byte)intervalHi,(byte)intervalLo,
                (byte)quantity,(byte)asyncFlag,(byte)colorSwitch,0,0
            });
        }
        return out.toByteArray();
    }

    static int defaultLampCount(String model) {
        // Both installed strings expose 60 controllable positions in the recovered app data.
        return 60;
    }

    private static byte[] nativeColor(String model, int rgb) {
        int r=(rgb >>> 16)&255, g=(rgb >>> 8)&255, b=rgb&255;
        if (isE22(model)) {
            return new byte[]{(byte)r,(byte)g,(byte)b,0,0};
        }
        // T8L00 getColorData uses packed RGB plus one warm-white channel.
        return new byte[]{(byte)r,(byte)g,(byte)b,0};
    }

    private static boolean isE22(String model) {
        return model != null && (model.equalsIgnoreCase("E22") || model.toUpperCase().startsWith("T8L02"));
    }

    private static int layerType(String name) {
        if (contains(name,"Strobe") || contains(name,"Twinkle")) return 2;
        if (contains(name,"Chase") || contains(name,"Gradient") || contains(name,"Candy") ||
            contains(name,"Wipe") || contains(name,"Meteor") || contains(name,"Rainbow") ||
            contains(name,"Pulse")) return 0;
        return 1;
    }

    private static int effectIndex(String name) {
        String[] names={
            "Solid / Static","Jump","Breath","Strobe","Chase","Gradient Sweep",
            "Candy Cane","Twinkle / Sparkle","Wipe / Fill","Meteor / Comet",
            "Rainbow Flow","Pulse Wave"
        };
        for(int i=0;i<names.length;i++) if(names[i].equals(name)) return i;
        return 0;
    }

    private static int speedValue(int speed1to5) {
        switch (clamp(speed1to5,1,5)) {
            case 1: return 20;
            case 2: return 35;
            case 3: return 50;
            case 4: return 70;
            default: return 90;
        }
    }

    private static boolean contains(String value, String token) {
        return value != null && value.toLowerCase().contains(token.toLowerCase());
    }

    private static byte[] tlv(int tag, byte[] value) {
        if (value.length > 255) throw new IllegalArgumentException("TLV too long");
        return concat(new byte[]{(byte)tag,(byte)value.length}, value);
    }

    private static byte[] le16(int value) {
        return new byte[]{(byte)value,(byte)(value>>>8)};
    }

    private static byte[] le32(int value) {
        return ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(value).array();
    }

    private static int clamp(int v,int lo,int hi) {
        return Math.max(lo,Math.min(hi,v));
    }

    private static void write(ByteArrayOutputStream out, byte[] data) {
        out.write(data,0,data.length);
    }

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        for(byte[] p:parts) write(out,p);
        return out.toByteArray();
    }

    private EufyLightCommands() {}
}

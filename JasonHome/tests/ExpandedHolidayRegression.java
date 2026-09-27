package com.jasonhome.app;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Exercise the generated defaults and real model serializers for all events. */
public final class ExpandedHolidayRegression {
    public static void main(String[] args) throws Exception {
        if (AndersonEventData.EVENTS.length != 210) fail("Calendar count");
        Set<String> ids = new HashSet<>(), supported = new HashSet<>();
        StringBuilder legacy = new StringBuilder();
        for (LightPresetCatalog.EffectTemplate e : LightPresetCatalog.EFFECTS) supported.add(e.name);
        for (AndersonEventData.Event e : AndersonEventData.EVENTS) {
            legacy.append(e.id).append('|').append(e.name).append('|').append(e.kind).append('|').append(e.rule)
                .append('|').append(e.month).append('|').append(e.day).append('|').append(e.weekday).append('|').append(e.nth)
                .append('|').append(e.offsetDays).append('|').append(e.durationDays).append('|').append(e.effect).append('|').append(e.speed)
                .append('|').append(Arrays.toString(e.basicColors)).append('|').append(Arrays.toString(e.majorColors)).append('\n');
            if (!ids.add(e.id)) fail("Duplicate " + e.id);
            if (!e.defaultEffect(false).equals(e.effect) || e.defaultSpeed(false) != e.speed)
                fail("Basic defaults changed " + e.id);
            if (!e.defaultEffect(true).equals(e.expandedEffect) || e.defaultSpeed(true) != e.expandedSpeed)
                fail("Expanded defaults missing " + e.id);
            if (!supported.contains(e.expandedEffect)) fail("Unsupported effect " + e.id);
            int[] colors = e.modernColors;
            if (colors.length < 1 || colors.length > 8) fail("Palette length " + e.id);
            byte[] e120 = EufyLightCommands.effectE120(e.expandedEffect, colors, e.expandedSpeed, false, 60);
            byte[] e22 = EufyLightCommands.show("T8L02", e.expandedEffect, colors, e.expandedSpeed, false);
            byte[] palette = field(e120, 0xA6), layer = field(e22, 0xA9);
            if ((palette[0] & 255) != colors.length || palette.length != 1 + colors.length * 4)
                fail("E120 palette width/count " + e.id);
            if ((layer[10] & 255) != colors.length) fail("E22 palette count " + e.id);
            for (int i = 0; i < colors.length; i++) {
                if (rgb(palette, 1 + i * 4) != colors[i]) fail("E120 color/repetition " + e.id);
                if (rgb(layer, 11 + i * 5) != colors[i]) fail("E22 color/repetition " + e.id);
            }
            if ((field(e120, 0xA5)[0] & 255) != e.expandedSpeed) fail("E120 speed " + e.id);
            if ((field(e22, 0xA4)[0] & 255) != EufyLightCommands.speedValueE22(e.expandedSpeed))
                fail("E22 speed " + e.id);
            byte[] positions = field(e120, 0xA7);
            boolean[] seen = new boolean[60];
            for (int p = 0; p < positions.length;) {
                int count = positions[p++] & 255;
                while (count-- > 0) {
                    if (p >= positions.length) fail("Truncated E120 positions " + e.id);
                    int lamp = positions[p++] & 255;
                    if (lamp >= 60 || seen[lamp]) fail("Repeated/out-of-range lamp " + e.id);
                    seen[lamp] = true;
                }
            }
            for (boolean present : seen) if (!present) fail("Unassigned lamp " + e.id);
        }
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(legacy.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) hex.append(String.format("%02x", b & 255));
        if (!hex.toString().equals("68cafd8ea299f707c95207577c58932fce2cff62157510161d9b2999adfce14e"))
            fail("Compiled Basic profiles differ from 5.4.8");
        AndersonEventData.Event christmas = event("evt208"), valentine = event("evt025");
        if (!christmas.expandedEffect.equals("Candy Cane") || christmas.expandedSpeed != 3)
            fail("Christmas design");
        if (!Arrays.equals(christmas.modernColors, new int[]{0xFF0000,0x28FF00,0xFF0000,0x28FF00,0xFFFFFA,0xFFD700}))
            fail("Christmas palette dominance");
        if (!valentine.expandedEffect.equals("Pulse Wave") || valentine.expandedSpeed != 1)
            fail("Valentine design");
        if (!Arrays.equals(valentine.modernColors,new int[]{0xFF0000,0xFF0024,0xFF0000,0xFF507A}))
            fail("Valentine palette");
        if (!Arrays.equals(event("evt152").modernColors,new int[]{0xFFFFFA,0})) fail("POW/MIA white/off order");
        System.out.println("Expanded holiday Java/wire regression: PASS (210 E120 + 210 E22 recipes)");
    }
    private static AndersonEventData.Event event(String id) {
        for (AndersonEventData.Event e : AndersonEventData.EVENTS) if (e.id.equals(id)) return e;
        throw new AssertionError(id);
    }
    private static int rgb(byte[] bytes, int p) {
        return ((bytes[p] & 255) << 16) | ((bytes[p+1] & 255) << 8) | (bytes[p+2] & 255);
    }
    private static byte[] field(byte[] packet, int tag) {
        for (int p = 0; p < packet.length;) {
            if (p + 2 > packet.length) fail("Truncated TLV header");
            int t = packet[p++] & 255, n = packet[p++] & 255;
            if (p + n > packet.length) fail("Truncated TLV value");
            if (t == tag) return Arrays.copyOfRange(packet,p,p+n);
            p += n;
        }
        throw new AssertionError("Missing TLV " + tag);
    }
    private static void fail(String message) { throw new AssertionError(message); }
}

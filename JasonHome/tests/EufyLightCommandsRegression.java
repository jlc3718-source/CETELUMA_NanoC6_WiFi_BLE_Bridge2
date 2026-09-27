package com.jasonhome.app;

public final class EufyLightCommandsRegression {
    public static void main(String[] args) {
        assertShow("E120", "Breath", 10474, 4);
        assertShow("T8L00", "Strobe", 10474, 4);
        assertShow("E22", "Breath", 21002, 5);
        assertShow("T8L02", "Strobe", 21003, 5);
        assertLocalE120(20001);
        assertLocalE120(20005);
        assertLocalE120(30010);
        assertShowIdOnly(10034);
        assertShowWithId(10034);
        assertCatalogPreset(20005,418507,0,false);
        assertCatalogPreset(30010,10034,50,false);
        assertCatalogPreset(20005,418507,0,true);
        assertGroupedPreset(1);
        assertGroupedPreset(2);
        assertGroupedPreset(3);
        assertGroupedPreset(4);
        assertGroupedPreset(5);
        assertGroupedPreset(6);
        assertNativeE120Modes();
        assertProductionE120Effect("Breath",30011,4,false);
        assertProductionE120Effect("Chase",30010,2,false);
        assertProductionE120Effect("Chase",30008,3,true);
        assertProductionE120Effect("Twinkle / Sparkle",30006,5,false);
        assertProductionE120Effect("Wipe / Fill",30007,1,false);
        assertProductionE120Effect("Meteor / Comet",30012,4,false);
        assertProductionE120Effect("Solid / Static",30014,2,false);
        System.out.println("EufyLightCommands regression: PASS");
    }

    private static void assertShow(String model, String effect, int expectedId, int expectedColorWidth) {
        byte[] payload = EufyLightCommands.show(model, effect, new int[]{0xFF0000}, 3, false);
        int a3 = find(payload, 0xA3);
        if (a3 < 0 || (payload[a3 + 1] & 0xFF) != 4) fail(model + " missing A3/u32 show id");
        int id = (payload[a3 + 2] & 0xFF)
            | ((payload[a3 + 3] & 0xFF) << 8)
            | ((payload[a3 + 4] & 0xFF) << 16)
            | ((payload[a3 + 5] & 0xFF) << 24);
        if (id != expectedId) fail(model + " " + effect + " id=" + id + " expected=" + expectedId);

        int a9 = find(payload, 0xA9);
        if (a9 < 0) fail(model + " missing A9 layer");
        int len = payload[a9 + 1] & 0xFF;
        int layer = a9 + 2;
        if (len < 11 + expectedColorWidth) fail(model + " A9 layer too short");
        if ((payload[layer + 10] & 0xFF) != 1) fail(model + " expected one layer color");
        if ((payload[layer + 11] & 0xFF) != 0xFF) fail(model + " red channel mismatch");
        for (int i = 1; i < expectedColorWidth; i++) {
            if ((payload[layer + 11 + i] & 0xFF) != 0) fail(model + " native color width/content mismatch");
        }
    }

    private static void assertNativeE120Modes() {
        if(EufyLightCommands.e120ModeId("Jump",false)!=30009) fail("Jump mode mismatch");
        if(EufyLightCommands.e120ModeId("Breath",false)!=30011) fail("Breath mode mismatch");
        if(EufyLightCommands.e120ModeId("Strobe",false)!=30006) fail("Strobe mode mismatch");
        if(EufyLightCommands.e120ModeId("Chase",false)!=30010) fail("Chase mode mismatch");
        if(EufyLightCommands.e120ModeId("Chase",true)!=30008) fail("Reverse chase mode mismatch");
        if(EufyLightCommands.e120ModeId("Gradient Sweep",false)!=30007) fail("Gradient mode mismatch");
        if(EufyLightCommands.e120ModeId("Twinkle / Sparkle",false)!=30006) fail("Twinkle mode mismatch");
        if(EufyLightCommands.e120ModeId("Wipe / Fill",false)!=30007) fail("Wipe mode mismatch");
        if(EufyLightCommands.e120ModeId("Meteor / Comet",false)!=30012) fail("Meteor mode mismatch");
        if(EufyLightCommands.e120ModeId("Rainbow Flow",false)!=30013) fail("Rainbow mode mismatch");
        if(EufyLightCommands.e120ModeId("Pulse Wave",false)!=30013) fail("Pulse mode mismatch");
        if(EufyLightCommands.e120ModeId("Solid / Static",false)!=30014) fail("Static mode mismatch");
    }

    private static void assertProductionE120Effect(String effect,int expectedMode,int speed,boolean reverse) {
        byte[] payload=EufyLightCommands.effectE120(effect,new int[]{0xFF0000,0x00FF00,0x0000FF},speed,reverse,60);
        int a3=find(payload,0xA3);
        if(a3<0 || (payload[a3+1]&255)!=2) fail(effect+" production A3 missing");
        int id=(payload[a3+2]&255)|((payload[a3+3]&255)<<8);
        if(id!=expectedMode) fail(effect+" production mode="+id+" expected="+expectedMode);
        int a5=find(payload,0xA5);
        if(a5<0 || (payload[a5+2]&255)!=speed) fail(effect+" production raw speed mismatch");
        int a6=find(payload,0xA6);
        if(a6<0 || (payload[a6+2]&255)!=2) fail(effect+" production palette should use proven two-color path");
        int ac=find(payload,0xAC);
        if(ac<0) fail(effect+" production missing AC");
    }

    private static void assertGroupedPreset(int mode) {
        byte[] payload=EufyLightCommands.groupedCatalogPresetE120(30010,10034,2,new int[]{0xFF0000,0x00FF00},60,mode);
        int a3=find(payload,0xA3);
        if(a3<0) fail("grouped preset missing A3");
        int a6=find(payload,0xA6);
        if(a6<0 || (payload[a6+1]&255)!=9 || (payload[a6+2]&255)!=2) fail("grouped palette malformed mode "+mode);
        int a7=find(payload,0xA7);
        if(a7<0) fail("grouped preset missing A7 mode "+mode);
        int ac=find(payload,0xAC);
        if(ac<0) fail("grouped preset missing AC mode "+mode);
    }

    private static void assertCatalogPreset(int localId,int catalogId,int a5,boolean minimal) {
        byte[] payload=EufyLightCommands.catalogPresetE120(localId,catalogId,a5,new int[]{0xFF0000,0x00FF00},60,minimal);
        int a3=find(payload,0xA3);
        if(a3<0 || (payload[a3+1]&255)!=2) fail("catalog preset missing A3");
        int id=(payload[a3+2]&255)|((payload[a3+3]&255)<<8);
        if(id!=localId) fail("catalog local id mismatch");
        int ac=find(payload,0xAC);
        if(ac<0 || (payload[ac+1]&255)!=4) fail("catalog preset missing AC");
        int cloud=(payload[ac+2]&255)|((payload[ac+3]&255)<<8)|((payload[ac+4]&255)<<16)|((payload[ac+5]&255)<<24);
        if(cloud!=catalogId) fail("catalog id mismatch");
        if(!minimal){
            int p=find(payload,0xA5);
            if(p<0 || (payload[p+2]&255)!=(a5&255)) fail("catalog A5 mismatch");
        }
    }

    private static void assertShowIdOnly(int showId) {
        byte[] payload = EufyLightCommands.showIdOnly(showId);
        if (payload.length != 6 || (payload[0] & 0xFF) != 0xA3 || (payload[1] & 0xFF) != 4)
            fail("captured E120 ID-only payload shape mismatch");
        int id=(payload[2]&255)|((payload[3]&255)<<8)|((payload[4]&255)<<16)|((payload[5]&255)<<24);
        if(id!=showId) fail("captured E120 ID-only id mismatch");
    }

    private static void assertShowWithId(int showId) {
        byte[] payload = EufyLightCommands.showWithId("E120",showId,"Breath",new int[]{0xFF0000,0x0000FF},3,false);
        int a3=find(payload,0xA3);
        if(a3<0 || (payload[a3+1]&255)!=4) fail("captured E120 full show missing A3");
        int id=(payload[a3+2]&255)|((payload[a3+3]&255)<<8)|((payload[a3+4]&255)<<16)|((payload[a3+5]&255)<<24);
        if(id!=showId) fail("captured E120 full show id mismatch");
        if(find(payload,0xA9)<0) fail("captured E120 full show missing layer");
    }

    private static void assertLocalE120(int localId) {
        byte[] payload = EufyLightCommands.localEffectE120(localId, new int[]{0xFF0000,0x0000FF}, 3, 60);
        int a3 = find(payload, 0xA3);
        if (a3 < 0 || (payload[a3 + 1] & 0xFF) != 2) fail("E120 local missing A3/u16 id");
        int id = (payload[a3 + 2] & 0xFF) | ((payload[a3 + 3] & 0xFF) << 8);
        if (id != localId) fail("E120 local id=" + id + " expected=" + localId);
        int a5 = find(payload, 0xA5);
        if (a5 < 0 || (payload[a5 + 2] & 0xFF) != 50) fail("E120 local speed mismatch");
        int a6 = find(payload, 0xA6);
        if (a6 < 0 || (payload[a6 + 2] & 0xFF) != 2) fail("E120 local palette count mismatch");
        if ((payload[a6 + 1] & 0xFF) != 9) fail("E120 local expected 2 RGBW colors");
    }

    private static int find(byte[] payload, int tag) {
        int i = 0;
        while (i + 1 < payload.length) {
            int len = payload[i + 1] & 0xFF;
            if ((payload[i] & 0xFF) == tag) return i;
            i += 2 + len;
        }
        return -1;
    }

    private static void fail(String message) {
        throw new AssertionError(message);
    }

    private EufyLightCommandsRegression() {}
}

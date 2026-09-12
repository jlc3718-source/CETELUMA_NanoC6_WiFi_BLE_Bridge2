#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TARGET_VERSION = "3.0.18"

COLORS = {
    "ORANGE": "FF0D00",   # 255,13,0
    "PINK": "FF0024",     # 255,0,36
    "YELLOW": "FFFF44",   # 255,255,68
    "GREEN": "28FF00",    # 40,255,0
    "BLUE": "0D00FF",     # 13,0,255
    "PURPLE": "5B00E6",   # 91,0,230
}
CANONICAL = set(COLORS.values())

# Existing Anderson output colors and neutral event colors, mapped by their
# original intended family to the closest of the six user-approved baselines.
EVENT_MAP = {
    "FF0000": COLORS["ORANGE"],
    "FF2900": COLORS["ORANGE"],
    "FF6E00": COLORS["YELLOW"],
    "4DFF00": COLORS["GREEN"],
    "05008A": COLORS["BLUE"],
    "23018C": COLORS["PURPLE"],
    "BF0005": COLORS["PINK"],
    "00BD4C": COLORS["GREEN"],
    "FFFFFF": COLORS["YELLOW"],
    "360500": COLORS["ORANGE"],
    "220200": COLORS["ORANGE"],
    "000000": COLORS["PURPLE"],
}


def read(rel):
    return (ROOT / rel).read_text()


def write(rel, text):
    (ROOT / rel).write_text(text)


def must_replace(text, old, new, label, count=None):
    found = text.count(old)
    if found == 0:
        raise SystemExit(f"missing expected source for {label}")
    if count is not None and found != count:
        raise SystemExit(f"unexpected count for {label}: {found} != {count}")
    return text.replace(old, new)


def patch_versions():
    write("FIRMWARE_VERSION.txt", TARGET_VERSION + "\n")
    p = "README.md"
    s = read(p)
    s = re.sub(r"Current firmware: \*\*v[0-9.]+\*\*\.", f"Current firmware: **v{TARGET_VERSION}**.", s, count=1)
    write(p, s)


def patch_main():
    p = "firmware/src/main.cpp"
    s = read(p)
    s = re.sub(r'ANDERSON_FIRMWARE_VERSION="[0-9.]+"', f'ANDERSON_FIRMWARE_VERSION="{TARGET_VERSION}"', s, count=1)
    s = s.replace("0xFFDA7F", "0xFFFF44")
    s = s.replace('runningTheme.name="Warm White"', 'runningTheme.name="Yellow"')
    write(p, s)


def patch_events():
    p = "firmware/src/EventCatalog.cpp"
    s = read(p)
    m = re.search(r"const EventDef EVENTS\[\] = \{(.*?)\n\};\nconst size_t EVENT_COUNT", s, re.S)
    if not m:
        raise SystemExit("EventCatalog EVENTS block not found")
    block = m.group(1)
    def repl(mm):
        h = mm.group(1).upper()
        return "0x" + EVENT_MAP.get(h, h)
    block2 = re.sub(r"0x([0-9A-Fa-f]{6})", repl, block)
    leftovers = sorted(set(re.findall(r"0x([0-9A-F]{6})", block2)) - CANONICAL)
    if leftovers:
        raise SystemExit("non-baseline event colors remain: " + ",".join(leftovers))
    s = s[:m.start(1)] + block2 + s[m.end(1):]
    write(p, s)


def patch_color_correction():
    p = "firmware/src/ColorCorrection.cpp"
    s = read(p)
    palette = '''const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE[] = {
  {0xFF0D00,0xFF0D00},
  {0xFF0024,0xFF0024},
  {0xFFFF44,0xFFFF44},
  {0x28FF00,0x28FF00},
  {0x0D00FF,0x0D00FF},
  {0x5B00E6,0x5B00E6}
};'''
    s, n = re.subn(r"const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE\[\] = \{.*?\n\};", palette, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("palette block replacement failed")
    direct = '''static constexpr DirectMap DIRECT_MAP[] = {
  // Six approved outputs are idempotent.
  {0xFF0D00,0xFF0D00},{0xFF0024,0xFF0024},{0xFFFF44,0xFFFF44},
  {0x28FF00,0x28FF00},{0x0D00FF,0x0D00FF},{0x5B00E6,0x5B00E6},
  // Historical Anderson outputs retain their intended named family.
  {0xFF0000,0xFF0D00},{0xFF2900,0xFF0D00},{0xFF6E00,0xFFFF44},
  {0x4DFF00,0x28FF00},{0x05008A,0x0D00FF},{0x23018C,0x5B00E6},
  {0xBF0005,0xFF0024},{0x00BD4C,0x28FF00},
  {0xFFFFFF,0xFFFF44},{0x360500,0xFF0D00},{0x220200,0xFF0D00},{0x000000,0x5B00E6},
  // Red / orange family -> approved orange.
  {0xFF3B30,0xFF0D00},{0xEF4444,0xFF0D00},{0xDC2626,0xFF0D00},{0xEF233C,0xFF0D00},
  {0xFF1744,0xFF0D00},{0xE11D48,0xFF0D00},{0xFF9500,0xFF0D00},{0xFF7A00,0xFF0D00},
  {0xF97316,0xFF0D00},{0xFF6B35,0xFF0D00},{0xFF3000,0xFF0D00},{0x92400E,0xFF0D00},
  {0xB45309,0xFF0D00},{0x7C2D12,0xFF0D00},{0x111111,0x5B00E6},
  // Yellow / gold / warm-white family -> approved yellow.
  {0xFFFF00,0xFFFF44},{0xFACC15,0xFFFF44},{0xF5D76E,0xFFFF44},{0xFBBF24,0xFFFF44},
  {0xF59E0B,0xFFFF44},{0xFDE68A,0xFFFF44},{0xF18900,0xFFFF44},{0xE44300,0xFFFF44},
  {0xFFDA7F,0xFFFF44},{0xFFF1C7,0xFFFF44},
  // Green / cyan / teal family -> approved green.
  {0x34C759,0x28FF00},{0x22C55E,0x28FF00},{0x16A34A,0x28FF00},{0x86EFAC,0x28FF00},
  {0x00FF00,0x28FF00},{0x2AD555,0x28FF00},{0x32D7D5,0x28FF00},{0x14B8A6,0x28FF00},
  {0x2DD4BF,0x28FF00},{0x00FFFF,0x28FF00},{0x00664D,0x28FF00},
  // Blue family -> approved blue.
  {0x0A84FF,0x0D00FF},{0x2563EB,0x0D00FF},{0x3B82F6,0x0D00FF},{0x0EA5E9,0x0D00FF},
  {0x5BC0EB,0x0D00FF},{0x38BDF8,0x0D00FF},{0x93C5FD,0x0D00FF},{0x60A5FA,0x0D00FF},
  {0xDBEAFE,0x0D00FF},{0x0000FF,0x0D00FF},{0x004BC6,0x0D00FF},{0x377CF9,0x0D00FF},{0xA7C8FC,0x0D00FF},
  // Purple / lavender family -> approved purple.
  {0x7E22CE,0x5B00E6},{0xA855F7,0x5B00E6},{0xBF5AF2,0x5B00E6},{0xC4B5FD,0x5B00E6},{0x7A62F9,0x5B00E6},
  // Pink / rose / magenta family -> approved pink.
  {0xFF00FF,0xFF0024},{0xFF4D6D,0xFF0024},{0xFF2D55,0xFF0024},{0xFF69B4,0xFF0024},
  {0xEC4899,0xFF0024},{0xFF2D92,0xFF0024},{0xF9A8D4,0xFF0024},{0xFF020C,0xFF0024},
  {0xFF1560,0xFF0024},{0xEF4F98,0xFF0024}
};'''
    s, n = re.subn(r"static constexpr DirectMap DIRECT_MAP\[\] = \{.*?\n\};\n\nstatic float srgbLinear", direct + "\n\nstatic float srgbLinear", s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("direct map replacement failed")
    write(p, s)


def patch_migration():
    p = "firmware/src/PaletteMigration.cpp"
    s = read(p)
    s = must_replace(s, "PALETTE_MIGRATION_REVISION=3", "PALETTE_MIGRATION_REVISION=4", "migration revision", 1)
    old = '''static bool transformFavoriteJson(const String& original,String& corrected){
  JsonDocument d;if(deserializeJson(d,original)||!d.is<JsonArray>())return false;for(JsonVariant color:d.as<JsonArray>())color.set(andersonCorrectHex(color.as<String>()));serializeJson(d,corrected);return true;
}'''
    new = '''static bool transformFavoriteJson(const String& original,String& corrected){
  (void)original;JsonDocument d;JsonArray a=d.to<JsonArray>();
  a.add("#FF0D00");a.add("#FF0024");a.add("#FFFF44");a.add("#28FF00");a.add("#0D00FF");a.add("#5B00E6");
  serializeJson(d,corrected);return true;
}'''
    s = must_replace(s, old, new, "favorite normalization", 1)
    old = '''static bool canonicalizeCurrentStoredPalette(){
  String originalPresets=readPrefString("anderson-preset","custom","[]"),correctedPresets;
  if(!transformPresetJson(originalPresets,correctedPresets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",correctedPresets))return false;
  JsonDocument current;JsonObject events=current["events"].to<JsonObject>();'''
    new = '''static bool canonicalizeCurrentStoredPalette(){
  String originalPresets=readPrefString("anderson-preset","custom","[]"),correctedPresets;
  if(!transformPresetJson(originalPresets,correctedPresets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",correctedPresets))return false;
  String originalFavorites=readPrefString("anderson-colors","saved","[]"),correctedFavorites;
  if(!transformFavoriteJson(originalFavorites,correctedFavorites))return false;
  if(!writePrefStringVerified("anderson-colors","saved",correctedFavorites))return false;
  JsonDocument current;JsonObject events=current["events"].to<JsonObject>();'''
    s = must_replace(s, old, new, "current palette favorite migration", 1)
    old = '''static bool applyFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets;if(!transformPresetJson(backup["presets"].as<String>(),presets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",presets))return false;if(!writeEvents(backup["events"].as<JsonObject>(),true))return false;return setMigrationState(STATE_APPLIED,true);
}'''
    new = '''static bool applyFromBackup(){
  JsonDocument backup;if(!loadBackup(backup))return false;String presets;if(!transformPresetJson(backup["presets"].as<String>(),presets))return false;
  if(!writePrefStringVerified("anderson-preset","custom",presets))return false;String favorites;if(!transformFavoriteJson(backup["favoriteColors"].as<String>(),favorites))return false;
  if(!writePrefStringVerified("anderson-colors","saved",favorites))return false;if(!writeEvents(backup["events"].as<JsonObject>(),true))return false;return setMigrationState(STATE_APPLIED,true);
}'''
    s = must_replace(s, old, new, "backup reapply favorites", 1)
    s = s.replace("// Automatic v3 migration always works from the CURRENT custom lights and event\n  // overrides. It never reads or writes Favorite Colors, regardless of prior revision.",
                  "// Automatic v4 migration normalizes CURRENT custom lights and event overrides,\n  // then resets Favorite Colors to the six approved user baselines.")
    write(p, s)


def patch_web():
    p = "firmware/web/index.html"
    s = read(p)
    new_block = '''const NAMED_COLOR_PALETTE=[
  {name:'Orange',reference:'#FF0D00',output:'#FF0D00'},{name:'Pink',reference:'#FF0024',output:'#FF0024'},{name:'Yellow',reference:'#FFFF44',output:'#FFFF44'},
  {name:'Green',reference:'#28FF00',output:'#28FF00'},{name:'Blue',reference:'#0D00FF',output:'#0D00FF'},{name:'Purple',reference:'#5B00E6',output:'#5B00E6'}
];
const LED_REFERENCE=Object.fromEntries(NAMED_COLOR_PALETTE.map(x=>[x.output,x.reference])),LED_COLOR_NAME=Object.fromEntries(NAMED_COLOR_PALETTE.map(x=>[x.output,x.name]));
const REFERENCE_LED={'#FF0D00':'#FF0D00','#FF0024':'#FF0024','#FFFF44':'#FFFF44','#28FF00':'#28FF00','#0D00FF':'#0D00FF','#5B00E6':'#5B00E6','#FF0000':'#FF0D00','#FF9500':'#FF0D00','#FFFF00':'#FFFF44','#22C55E':'#28FF00','#2563EB':'#0D00FF','#7E22CE':'#5B00E6','#FF69B4':'#FF0024'};
const EXPLICIT_LED={'#FF3B30':'#FF0D00','#EF4444':'#FF0D00','#DC2626':'#FF0D00','#EF233C':'#FF0D00','#FF1744':'#FF0D00','#E11D48':'#FF0D00','#FF2900':'#FF0D00','#FF3000':'#FF0D00','#FF7A00':'#FF0D00','#F97316':'#FF0D00','#FF6B35':'#FF0D00','#92400E':'#FF0D00','#360500':'#FF0D00','#220200':'#FF0D00','#FF6E00':'#FFFF44','#F18900':'#FFFF44','#E44300':'#FFFF44','#FFDA7F':'#FFFF44','#FFF1C7':'#FFFF44','#FACC15':'#FFFF44','#F59E0B':'#FFFF44','#FFFFFF':'#FFFF44','#4DFF00':'#28FF00','#00FF00':'#28FF00','#2AD555':'#28FF00','#34C759':'#28FF00','#16A34A':'#28FF00','#00BD4C':'#28FF00','#00FFFF':'#28FF00','#00664D':'#28FF00','#05008A':'#0D00FF','#0000FF':'#0D00FF','#004BC6':'#0D00FF','#377CF9':'#0D00FF','#A7C8FC':'#0D00FF','#0A84FF':'#0D00FF','#3B82F6':'#0D00FF','#23018C':'#5B00E6','#7A62F9':'#5B00E6','#C4B5FD':'#5B00E6','#000000':'#5B00E6','#BF0005':'#FF0024','#FF020C':'#FF0024','#FF1560':'#FF0024','#EF4F98':'#FF0024','#FF00FF':'#FF0024','#FF2D55':'#FF0024','#F9A8D4':'#FF0024'};
const LEGACY_DISPLAY={'#FF0000':'#FF0D00','#FF2900':'#FF0D00','#FF6E00':'#FFFF44','#4DFF00':'#28FF00','#00BD4C':'#28FF00','#05008A':'#0D00FF','#23018C':'#5B00E6','#BF0005':'#FF0024','#FFFFFF':'#FFFF44','#360500':'#FF0D00','#220200':'#FF0D00','#000000':'#5B00E6'};
function normalizeLedColor(c){const k=normHex(c);return REFERENCE_LED[k]||EXPLICIT_LED[k]||k}
function displayColor(c){const k=String(c||'').toUpperCase();return LED_REFERENCE[k]||LEGACY_DISPLAY[k]||c}
function displayLabel(c){const k=String(c||'').toUpperCase(),n=LED_COLOR_NAME[k],r=LED_REFERENCE[k];return n&&r?`${n} ${r} • LED ${k}`:c}'''
    s, n = re.subn(r"const NAMED_COLOR_PALETTE=\[.*?function displayLabel\(c\)\{.*?\}", new_block, s, count=1, flags=re.S)
    if n != 1:
        raise SystemExit("web palette block replacement failed")
    replacements = {
        "let running={name:'Warm White',colors:['#FFDA7F'],effect:'Jump'}": "let running={name:'Yellow',colors:['#FFFF44'],effect:'Jump'}",
        "state.colors&&state.colors.length?state.colors:['#05008A']": "state.colors&&state.colors.length?state.colors:['#0D00FF']",
        "let builderColors=['#05008A'];": "let builderColors=['#0D00FF'];",
        "colors&&colors.length?colors.slice(0,8):['#05008A']": "colors&&colors.length?colors.slice(0,8):['#0D00FF']",
        "color)?color:'#05008A'": "color)?color:'#0D00FF'",
        "const suggestions=['#FFFFFF','#FF0000','#4DFF00','#05008A','#23018C','#FF2900','#FF6E00','#00BD4C','#BF0005'];": "const suggestions=['#FF0D00','#FF0024','#FFFF44','#28FF00','#0D00FF','#5B00E6'];",
        "builderColors[0]||'#05008A'": "builderColors[0]||'#0D00FF'",
        "const quick=['#FF0000','#23018C','#05008A','#00BD4C','#BF0005','#FF2900','#FF6E00','#4DFF00','#FFFFFF'];": "const quick=['#FF0D00','#FF0024','#FFFF44','#28FF00','#0D00FF','#5B00E6'];",
        "builderColors[0]==='#05008A'": "builderColors[0]==='#0D00FF'",
        "builderColors.length===1&&builderColors[0]==='#05008A'": "builderColors.length===1&&builderColors[0]==='#0D00FF'",
        "$('testRed').addEventListener('click',()=>manual({name:'BLE Test Red',colors:['#ff0000'],effect:'Jump'}));$('testRainbow').textContent='Test Gradient';$('testRainbow').addEventListener('click',()=>manual({name:'BLE Test Gradient',colors:['#05008A','#23018C','#FFFFFF'],effect:'Gradient'}));": "$('testRed').textContent='Test Orange';$('testRed').addEventListener('click',()=>manual({name:'BLE Test Orange',colors:['#FF0D00'],effect:'Jump'}));$('testRainbow').textContent='Test Gradient';$('testRainbow').addEventListener('click',()=>manual({name:'BLE Test Gradient',colors:['#0D00FF','#5B00E6','#FFFF44'],effect:'Gradient'}));"
    }
    for old,new in replacements.items():
        if old in s:
            s=s.replace(old,new)
    write(p, s)


def validate():
    ev = read("firmware/src/EventCatalog.cpp")
    m = re.search(r"const EventDef EVENTS\[\] = \{(.*?)\n\};\nconst size_t EVENT_COUNT", ev, re.S)
    colors = set(re.findall(r"0x([0-9A-F]{6})", m.group(1))) if m else set()
    if colors - CANONICAL:
        raise SystemExit("event palette validation failed")
    mig = read("firmware/src/PaletteMigration.cpp")
    for h in ("#FF0D00","#FF0024","#FFFF44","#28FF00","#0D00FF","#5B00E6"):
        if h not in mig:
            raise SystemExit(f"favorite baseline missing {h}")
    web = read("firmware/web/index.html")
    quick = "const quick=['#FF0D00','#FF0024','#FFFF44','#28FF00','#0D00FF','#5B00E6'];"
    if quick not in web:
        raise SystemExit("quick palette not normalized")
    if read("FIRMWARE_VERSION.txt").strip()!=TARGET_VERSION:
        raise SystemExit("firmware version did not advance")


def main():
    patch_versions()
    patch_main()
    patch_events()
    patch_color_correction()
    patch_migration()
    patch_web()
    validate()
    print("Applied Anderson six-color baseline v4 for firmware", TARGET_VERSION)

if __name__ == "__main__":
    main()

from pathlib import Path
import re

COLORS = {
    1: ['00B4B4', 'FFFFFA'],
    2: ['28FF00'],
    3: ['FF0000'],
    4: ['00B4B4', 'FF0024', '0096FF'],
    5: ['FF0024', '0096FF'],
    6: ['FFA000', 'FFFFFA'],
    7: ['FFFF44', '0096FF'],
    8: ['FFFFFA', 'FFA000'],
    9: ['FFFFFA', 'FFA000', 'FF0000'],
    10: ['0D00FF'],
    11: ['FF0000', 'FFFFFA', '0D00FF'],
    12: ['0096FF', 'FFFFFA'],
    13: ['FFFF44', '0D00FF', 'FFFFFA'],
    14: ['0D00FF', 'FFFFFA'],
    15: ['FF0000', '28FF00', 'FFA000'],
    16: ['FF0000'],
    17: ['B464FF'],
    18: ['FF0D00'],
    19: ['FF0000', 'FFFFFA', '0D00FF'],
    20: ['28FF00', 'FFA000'],
    21: ['FF0000'],
    22: ['B464FF', 'FF0D00'],
    23: ['5B00E6', 'FF0024'],
    24: ['FF0000', '87002D'],
    25: ['FF0000', 'FF0024'],
    26: ['FF0000', 'FFFFFA', '0D00FF'],
    27: ['5B00E6', '28FF00', 'FFA000'],
    28: ['FF0000', 'FFA000'],
    29: ['5B00E6'],
    30: ['28FF00', 'FFA000'],
    31: ['0096FF', 'FFFFFA'],
    32: ['0D00FF', 'FFFFFA'],
    33: ['FF0024', '0096FF', '28FF00', '5B00E6'],
    34: ['5B00E6', '28FF00', 'FFFFFA'],
    35: ['001478'],
    36: ['FF0D00'],
    37: ['28FF00'],
    38: ['FF0D00'],
    39: ['FF0D00', '0D00FF'],
    40: ['28FF00'],
    41: ['FFFF44'],
    42: ['FF0D00'],
    43: ['A0A5AF', 'FF0000'],
    44: ['5B00E6', '28FF00', 'FFFFFA'],
    45: ['FF0000'],
    46: ['28FF00'],
    47: ['28FF00', 'FFA000'],
    48: ['0096FF', 'FFFF44'],
    49: ['0096FF', '00B4B4'],
    50: ['FF0000'],
    51: ['B464FF', '5B00E6'],
    52: ['FFA000', '28FF00', 'FF0000'],
    53: ['0096FF', 'FF0024', 'FFFFFA'],
    54: ['FFA000', 'FF0000', '0096FF'],
    55: ['00B4B4'],
    56: ['001478'],
    57: ['FF0000'],
    58: ['0096FF', 'FF0D00'],
    59: ['A0A5AF', 'FF0000'],
    60: ['0096FF', '28FF00'],
    61: ['FFFF44', '5B00E6'],
    62: ['0096FF'],
    63: ['0096FF', 'FFFFFA'],
    64: ['5B00E6', 'FF0000'],
    65: ['FF0024', 'FFFF44', 'B464FF', 'FFFFFA'],
    66: ['0096FF', 'FFFFFA'],
    67: ['FF0000'],
    68: ['FF0000', 'A0A5AF'],
    69: ['FFFF44', '0096FF', 'FFFFFA'],
    70: ['28FF00', '0096FF'],
    71: ['FF0D00', '0096FF'],
    72: ['28FF00'],
    73: ['28FF00'],
    74: ['28FF00', '0096FF'],
    75: ['5B00E6', 'A0A5AF'],
    76: ['FF0000', 'FFA000'],
    77: ['0D00FF', 'FFFFFA'],
    78: ['FF0000', 'FFFFFA', '0D00FF'],
    79: ['FF0D00'],
    80: ['0096FF'],
    81: ['5B00E6'],
    82: ['001478', 'FFFFFA'],
    83: ['A0A5AF'],
    84: ['FF0000', 'FFFFFA', '0D00FF'],
    85: ['28FF00', 'FFFFFA', 'FF0000'],
    86: ['FFFFFA', 'FF0000', '0096FF'],
    87: ['FF0024', 'FFFFFA'],
    88: ['5B00E6'],
    89: ['FFFFFA', '0096FF'],
    90: ['001478'],
    91: ['FF0000', 'FFFFFA', '0D00FF'],
    92: ['FF0000', 'FF0D00', 'FFFF44', '28FF00', '0096FF', '5B00E6'],
    93: ['FFFFFA', 'FF0000'],
    94: ['28FF00', 'FFA000'],
    95: ['FF0000', 'FFFFFA', '0D00FF'],
    96: ['28FF00', 'FFA000'],
    97: ['FF0D00'],
    98: ['FF0000', 'FF0D00', 'FFFF44', '28FF00', '0096FF', '5B00E6'],
    99: ['5B00E6'],
    100: ['00B4B4'],
    101: ['FF0000', 'FFA000', '28FF00', '0096FF'],
    102: ['28FF00'],
    103: ['FF0000', 'FFFFFA', '0D00FF'],
    104: ['FF0000', 'FF0024', 'FFFFFA'],
    105: ['FF0000', 'FFFFFA', '0D00FF'],
    106: ['FF0000', 'FFFFFA', '0D00FF', '28FF00'],
    107: ['87002D'],
    108: ['0096FF'],
    109: ['001478', 'FFFFFA'],
    110: ['FFFF44', 'FF0D00'],
    111: ['00B4B4'],
    112: ['FF0000'],
    113: ['FF0000', 'FFA000', 'FFFFFA', '0096FF', '28FF00'],
    114: ['28FF00'],
    115: ['FFFF44', 'FF0D00'],
    116: ['0096FF'],
    117: ['FFFF44'],
    118: ['FF0000', 'FFFFFA', '0D00FF'],
    119: ['FF0000'],
    120: ['5B00E6', 'FF0024', 'FFFFFA'],
    121: ['FF0000', 'FFFFFA', '0D00FF'],
    122: ['5B00E6', 'FFFF44'],
    123: ['FFA000', 'FFFFFA'],
    124: ['FFFFFA', '0096FF', '28FF00'],
    125: ['FFA000', '28FF00'],
    126: ['FF0024', 'FFFFFA'],
    127: ['FF0D00', 'B464FF'],
    128: ['5B00E6', 'FFFFFA'],
    129: ['28FF00', '0096FF'],
    130: ['0096FF', 'FFFFFA'],
    131: ['0096FF', 'FFA000'],
    132: ['5B00E6', 'FFFFFA', 'FFA000'],
    133: ['5B00E6', 'A0A5AF'],
    134: ['00B4B4', '5B00E6'],
    135: ['FFA000'],
    136: ['0096FF'],
    137: ['00B4B4'],
    138: ['FF0000'],
    139: ['87002D'],
    140: ['5B00E6'],
    141: ['28FF00', 'FFA000'],
    142: ['FFFF44', 'FF0D00'],
    143: ['FF0024', 'FF0000'],
    144: ['FF0000', 'FFFFFA', '0D00FF'],
    145: ['00B4B4', '5B00E6'],
    146: ['FFFF44', '00B4B4', '5B00E6'],
    147: ['FF0000', 'FFFFFA', '0D00FF'],
    148: ['FFFFFA', '0096FF', 'FFA000'],
    149: ['0096FF', 'FFFF44'],
    150: ['FF0000', 'FFFFFA', '28FF00', 'FFA000', '0096FF'],
    151: ['FF0000', 'FFFFFA', '0D00FF'],
    152: ['A0A5AF', 'FFFFFA'],
    153: ['FFFFFA'],
    154: ['5B00E6'],
    155: ['FFFFFA', '0096FF'],
    156: ['FF0024', '5B00E6', '0096FF'],
    157: ['FFA000', '001478', 'FFFFFA'],
    158: ['FF0000'],
    159: ['FF0024'],
    160: ['5B00E6'],
    161: ['FF0D00'],
    162: ['FF0D00'],
    163: ['0096FF', 'FFFF44'],
    164: ['28FF00'],
    165: ['0096FF', 'FFFFFA'],
    166: ['FF0000'],
    167: ['0096FF', '28FF00'],
    168: ['FF0000', 'FF0D00', 'FFFF44', '28FF00', '0096FF', '5B00E6'],
    169: ['0096FF', 'FF0000', 'FFFFFA', 'FFA000'],
    170: ['FF0024', '0096FF'],
    171: ['28FF00'],
    172: ['0096FF', 'FFFF44'],
    173: ['FF0000', 'FFA000', 'FFFFFA'],
    174: ['FFFFFA', 'FF0000'],
    175: ['FF0024', '0096FF'],
    176: ['5B00E6'],
    177: ['FFA000', 'FF0D00', 'FF0000'],
    178: ['0096FF', '5B00E6'],
    179: ['FF0D00', '5B00E6', '28FF00'],
    180: ['FF0000', 'FFA000', 'FFFFFA', '0096FF'],
    181: ['0096FF'],
    182: ['FF0D00'],
    183: ['FFFFFA'],
    184: ['5B00E6'],
    185: ['5B00E6'],
    186: ['5B00E6'],
    187: ['5B00E6'],
    188: ['28FF00'],
    189: ['FFFFFA', 'FFA000'],
    190: ['5B00E6', 'FFFFFA'],
    191: ['FF0000', 'FFFFFA', '0D00FF'],
    192: ['FFA000', 'FF0000', 'FF0D00'],
    193: ['FF0000', 'FFFFFA', '0D00FF', 'FFA000'],
    194: ['0096FF'],
    195: ['5B00E6'],
    196: ['0096FF', 'FF0024', 'FFFFFA'],
    197: ['FF0D00', 'FF0000', 'FFA000'],
    198: ['FF0000', 'FFA000', 'FFFFFA'],
    199: ['FF0000'],
    200: ['FF0000'],
    201: ['5B00E6', '0096FF'],
    202: ['0096FF', 'FFFFFA'],
    203: ['FF0000', 'FFFFFA', '0D00FF'],
    204: ['0096FF', 'FFFFFA'],
    205: ['FF0000', 'FFFFFA', '0D00FF'],
    206: ['FFFFFA', '00B4B4', '0096FF'],
    207: ['FF0000', '28FF00', 'FFA000'],
    208: ['FF0000', '28FF00', 'FFA000', 'FFFFFA'],
    209: ['FF0000', '28FF00'],
    210: ['FFA000', 'A0A5AF', 'FFFFFA', '5B00E6'],
}
assert len(COLORS) == 210
assert set(COLORS) == set(range(1, 211))
assert max(len(v) for v in COLORS.values()) <= 6

event_path = Path("firmware/src/EventCatalog.cpp")
event = event_path.read_text()
ids = re.findall(r'\{"evt(\d{3})"', event)
assert len(ids) == 210, len(ids)
assert ids == [f"{i:03d}" for i in range(1, 211)]

for i in range(1, 211):
    cols = COLORS[i]
    macro = f"C{len(cols)}(" + ",".join("0x" + c for c in cols) + f"),{len(cols)}"
    pat = rf'(\{{"evt{i:03d}".*?Effect::[A-Za-z]+,)C[1-6]\([^)]*\),\d+(\s*\}},)'
    event, n = re.subn(pat, lambda m: m.group(1) + macro + m.group(2), event, count=1)
    assert n == 1, f"event {i} replacement failed"

event_path.write_text(event)

cc_path = Path("firmware/src/ColorCorrection.cpp")
cc = cc_path.read_text()
new_palette = """const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE[] = {
  {0xFF0000,0xFF0000}, // Red
  {0xFF0D00,0xFF0D00}, // Orange
  {0xFF0024,0xFF0024}, // Pink
  {0xFFFF44,0xFFFF44}, // Yellow
  {0x28FF00,0x28FF00}, // Green
  {0x00BD4C,0x00BD4C}, // Cyan
  {0x0D00FF,0x0D00FF}, // Blue
  {0x5B00E6,0x5B00E6}, // Purple
  {0xFFFFFA,0xFFFFFA}, // White
  {0x00B4B4,0x00B4B4}, // Teal
  {0x0096FF,0x0096FF}, // Sky Blue
  {0xFFA000,0xFFA000}, // Amber Gold
  {0xB464FF,0xB464FF}, // Lavender
  {0x001478,0x001478}, // Navy Blue
  {0x87002D,0x87002D}, // Burgundy
  {0xA0A5AF,0xA0A5AF}  // Silver Gray
};"""
cc, n = re.subn(
    r'const AndersonColorPaletteEntry ANDERSON_COLOR_PALETTE\[\] = \{.*?\n\};',
    new_palette,
    cc,
    count=1,
    flags=re.S,
)
assert n == 1, "ColorCorrection palette replacement failed"

new_idempotent = """  // Sixteen approved outputs are idempotent.
  {0xFF0000,0xFF0000},{0xFF0D00,0xFF0D00},{0xFF0024,0xFF0024},{0xFFFF44,0xFFFF44},{0x28FF00,0x28FF00},{0x00BD4C,0x00BD4C},{0x0D00FF,0x0D00FF},{0x5B00E6,0x5B00E6},{0xFFFFFA,0xFFFFFA},{0x00B4B4,0x00B4B4},{0x0096FF,0x0096FF},{0xFFA000,0xFFA000},{0xB464FF,0xB464FF},{0x001478,0x001478},{0x87002D,0x87002D},{0xA0A5AF,0xA0A5AF},
"""
cc, n = re.subn(
    r'  // Nine approved outputs are idempotent\.\n.*?(?=  // Historical Anderson outputs retain their intended named family\.)',
    new_idempotent,
    cc,
    count=1,
    flags=re.S,
)
assert n == 1, "ColorCorrection idempotent map replacement failed"
cc_path.write_text(cc)

web_path = Path("firmware/web/index.html")
web = web_path.read_text()
new_js_palette = """const NAMED_COLOR_PALETTE=[
  {name:'Red',reference:'#FF0000',output:'#FF0000'},
  {name:'Orange',reference:'#FF0D00',output:'#FF0D00'},
  {name:'Pink',reference:'#FF0024',output:'#FF0024'},
  {name:'Yellow',reference:'#FFFF44',output:'#FFFF44'},
  {name:'Green',reference:'#28FF00',output:'#28FF00'},
  {name:'Cyan',reference:'#00BD4C',output:'#00BD4C'},
  {name:'Blue',reference:'#0D00FF',output:'#0D00FF'},
  {name:'Purple',reference:'#5B00E6',output:'#5B00E6'},
  {name:'White',reference:'#FFFFFA',output:'#FFFFFA'},
  {name:'Teal',reference:'#00B4B4',output:'#00B4B4'},
  {name:'Sky Blue',reference:'#0096FF',output:'#0096FF'},
  {name:'Amber Gold',reference:'#FFA000',output:'#FFA000'},
  {name:'Lavender',reference:'#B464FF',output:'#B464FF'},
  {name:'Navy Blue',reference:'#001478',output:'#001478'},
  {name:'Burgundy',reference:'#87002D',output:'#87002D'},
  {name:'Silver Gray',reference:'#A0A5AF',output:'#A0A5AF'}
];"""
web, n = re.subn(
    r'const NAMED_COLOR_PALETTE=\[.*?\n\];',
    new_js_palette,
    web,
    count=1,
    flags=re.S,
)
assert n == 1, "web palette replacement failed"
web_path.write_text(web)

Path("FIRMWARE_VERSION.txt").write_text("3.0.29\n")
readme = Path("README.md")
if readme.exists():
    txt = readme.read_text()
    txt = re.sub(r'Current firmware: \*\*v[^*]+\*\*\.', 'Current firmware: **v3.0.29**.', txt, count=1)
    readme.write_text(txt)

notes = """# Anderson Home v3.0.29

- Expands the locked Anderson master/Favorite Colors palette from 9 to 16 colors.
- Adds Teal #00B4B4, Sky Blue #0096FF, Amber Gold #FFA000, Lavender #B464FF, Navy Blue #001478, Burgundy #87002D, and Silver Gray #A0A5AF.
- Keeps the existing Red, Orange, Pink, Yellow, Green, Cyan, Blue, Purple, and White colors.
- Updates all 210 built-in calendar events to the exact revised event color assignments supplied by the owner.
- Halloween is Orange #FF0D00 + Purple #5B00E6 + Green #28FF00.
- Preserves v3.0.28 UI/navigation, Wi-Fi Settings sub-tab, holiday search, Favorites tab, Jason/Shirley access, Schedule 1/2, event persistence, reboot storage-health optimization, Wi-Fi/BLE/PINs, custom shows, partitions, and saved-data compatibility.
- Manual release only for this revision: do not advance the signed OTA manifest.
"""
Path("firmware/RELEASE_NOTES_v3.0.29.md").write_text(notes)

updated_event = event_path.read_text()
checks = {
    "evt001": "C2(0x00B4B4,0xFFFFFA),2",
    "evt006": "C2(0xFFA000,0xFFFFFA),2",
    "evt035": "C1(0x001478),1",
    "evt043": "C2(0xA0A5AF,0xFF0000),2",
    "evt107": "C1(0x87002D),1",
    "evt179": "C3(0xFF0D00,0x5B00E6,0x28FF00),3",
    "evt210": "C4(0xFFA000,0xA0A5AF,0xFFFFFA,0x5B00E6),4",
}
for eid, needle in checks.items():
    line = next(x for x in updated_event.splitlines() if f'"{eid}"' in x)
    assert needle in line, (eid, line)
assert len(re.findall(r'\{"evt\d{3}"', updated_event)) == 210

updated_cc = cc_path.read_text()
for _, h in [('Red', 'FF0000'), ('Orange', 'FF0D00'), ('Pink', 'FF0024'), ('Yellow', 'FFFF44'), ('Green', '28FF00'), ('Cyan', '00BD4C'), ('Blue', '0D00FF'), ('Purple', '5B00E6'), ('White', 'FFFFFA'), ('Teal', '00B4B4'), ('Sky Blue', '0096FF'), ('Amber Gold', 'FFA000'), ('Lavender', 'B464FF'), ('Navy Blue', '001478'), ('Burgundy', '87002D'), ('Silver Gray', 'A0A5AF')]:
    assert f"0x{h}" in updated_cc
updated_web = web_path.read_text()
for name, h in [('Red', 'FF0000'), ('Orange', 'FF0D00'), ('Pink', 'FF0024'), ('Yellow', 'FFFF44'), ('Green', '28FF00'), ('Cyan', '00BD4C'), ('Blue', '0D00FF'), ('Purple', '5B00E6'), ('White', 'FFFFFA'), ('Teal', '00B4B4'), ('Sky Blue', '0096FF'), ('Amber Gold', 'FFA000'), ('Lavender', 'B464FF'), ('Navy Blue', '001478'), ('Burgundy', '87002D'), ('Silver Gray', 'A0A5AF')]:
    assert f"name:'{name}'" in updated_web and f"output:'#{h}'" in updated_web
print("v3.0.29 palette/event patch validated")

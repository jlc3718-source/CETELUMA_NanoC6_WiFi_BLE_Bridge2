#!/usr/bin/env python3
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def exact(text,old,new,label):
    n=text.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, got {n}')
    return text.replace(old,new,1)

# Browser-facing reference colors use recognizable web/sRGB color values. LED outputs
# remain the calibrated Anderson codes; this changes only visual identity/matching.
refs={
'Red':'#FF0000','Orange':'#FFA500','Pink':'#FFC0CB','Yellow':'#FFFF00','Green':'#008000',
'Cyan':'#00FFFF','Blue':'#0000FF','Purple':'#800080','White':'#FFFFFF','Teal':'#008080',
'Sky Blue':'#87CEEB','Amber Gold':'#FFC000','Lavender':'#E6E6FA','Navy Blue':'#000080',
'Burgundy':'#800020','Silver Gray':'#C0C0C0'}
outputs={
'Red':'#FF0000','Orange':'#FF0D00','Pink':'#FF0024','Yellow':'#FFFF44','Green':'#28FF00',
'Cyan':'#00BD4C','Blue':'#0D00FF','Purple':'#5B00E6','White':'#FFFFFA','Teal':'#00B4B4',
'Sky Blue':'#0096FF','Amber Gold':'#FFA000','Lavender':'#B464FF','Navy Blue':'#001478',
'Burgundy':'#87002D','Silver Gray':'#A0A5AF'}

p=ROOT/'firmware/web/index.html'; s=p.read_text()
for name in refs:
    pat=rf"\{{name:'{re.escape(name)}',reference:'#[0-9A-Fa-f]{{6}}',output:'{outputs[name]}'\}}"
    repl=f"{{name:'{name}',reference:'{refs[name]}',output:'{outputs[name]}'}}"
    s,n=re.subn(pat,repl,s,count=1)
    if n!=1: raise SystemExit(f'UI palette {name}: expected 1 match, got {n}')
s,n=re.subn(r"const REFERENCE_LED=\{.*?\};\nconst EXPLICIT_LED=", "const REFERENCE_LED=Object.assign(Object.fromEntries(NAMED_COLOR_PALETTE.flatMap(x=>[[x.reference,x.output],[x.output,x.output]])),{'#FF9500':'#FF0D00','#22C55E':'#28FF00','#2563EB':'#0D00FF','#7E22CE':'#5B00E6','#FF69B4':'#FF0024'});\nconst EXPLICIT_LED=", s, count=1, flags=re.S)
if n!=1: raise SystemExit('REFERENCE_LED replacement failed')
p.write_text(s)

p=ROOT/'firmware/src/ColorCorrection.cpp'; s=p.read_text()
for name in refs:
    old_output=outputs[name][1:].upper(); new_ref=refs[name][1:].upper()
    pat=rf"\{{0x[0-9A-Fa-f]{{6}},0x{old_output}\}}, // {re.escape(name)}"
    repl=f"{{0x{new_ref},0x{old_output}}}, // {name}"
    s,n=re.subn(pat,repl,s,count=1)
    if n!=1: raise SystemExit(f'firmware palette {name}: expected 1 match, got {n}')
needle='''  // Sixteen approved outputs are idempotent.\n'''
addition='''  // Browser/reference colors map directly to their intended calibrated LED families.\n  {0xFFA500,0xFF0D00},{0xFFC0CB,0xFF0024},{0xFFFF00,0xFFFF44},{0x008000,0x28FF00},\n  {0x00FFFF,0x00BD4C},{0x0000FF,0x0D00FF},{0x800080,0x5B00E6},{0xFFFFFF,0xFFFFFA},\n  {0x008080,0x00B4B4},{0x87CEEB,0x0096FF},{0xFFC000,0xFFA000},{0xE6E6FA,0xB464FF},\n  {0x000080,0x001478},{0x800020,0x87002D},{0xC0C0C0,0xA0A5AF},\n'''
s=exact(s,needle,needle+addition,'direct reference map')
p.write_text(s)

# Release notes and standing invariant.
p=ROOT/'firmware/RELEASE_NOTES_v3.1.1.md'; s=p.read_text()
s += '- Favorite/quick color tiles now display recognizable web-standard sRGB reference colors while still sending the calibrated Anderson LED output codes.\n'
p.write_text(s)
p=ROOT/'AGENTS.md'; s=p.read_text()
marker='- Original Colors and Modern Colors must each retain their own per-event overrides in NVS.'
idx=s.find(marker)
if idx<0: raise SystemExit('AGENTS palette persistence marker missing')
line='- Color buttons/tiles must use recognizable browser-facing sRGB reference colors for their names while preserving the separate calibrated LED output codes.\n'
if line not in s: s=s[:idx]+line+s[idx:]
p.write_text(s)
print('v3.1.1 display-color patch applied')

#!/usr/bin/env python3
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def exact(text,old,new,label):
    n=text.count(old)
    if n!=1: raise SystemExit(f'{label}: expected 1 match, got {n}')
    return text.replace(old,new,1)

# The first-stage helper intentionally reaches the hero-reference assertion after
# applying the persistence/UI edits. Verify those edits exist before completing.
main=(ROOT/'firmware/src/main.cpp').read_text()
if 'eventOverrideKey(i,activeEventColorTheme)' not in main or 'migrateLegacyEventOverrides()' not in main:
    raise SystemExit('first-stage palette-specific persistence edits are missing')

# Remove every remaining dependency on the retired v3 hero/rainbow sprite.
p=ROOT/'firmware/web/v3_mockup.css'; css=p.read_text()
css=css.replace("--v3-art:url('__V3_HERO_DATA_URI__');",'')
css='\n'.join(line for line in css.splitlines() if '.v3Scene' not in line and '.v3EffectArt' not in line)+'\n'
if '__V3_HERO_DATA_URI__' in css or 'var(--v3-art)' in css or '.v3EffectArt' in css or '.v3Scene' in css:
    raise SystemExit('hero sprite references remain in v3 CSS')
p.write_text(css)

p=ROOT/'tools/release.py'; rel=p.read_text()
rel=rel.replace('import base64\n','')
rel=rel.replace("V3_HERO_B64 = ROOT / 'firmware/web/v3_hero.b64'\n",'')
start=rel.find('    if not V3_CSS.exists() or not V3_JS.exists() or not V3_HERO_B64.exists():')
end=rel.find('    js = V3_JS.read_text()',start)
if start<0 or end<0: raise SystemExit('release hero block not found')
replacement="    if not V3_CSS.exists() or not V3_JS.exists():\n        raise ValueError('Anderson v3 reference layout assets are missing')\n\n    css = V3_CSS.read_text()\n"
rel=rel[:start]+replacement+rel[end:]
if 'V3_HERO' in rel or 'hero_b64' in rel or '__V3_HERO_DATA_URI__' in rel:
    raise SystemExit('release hero dependency remains')
p.write_text(rel)
hero=ROOT/'firmware/web/v3_hero.b64'
if hero.exists(): hero.unlink()

# Browser-facing color tiles use recognizable sRGB/web colors, while each button
# still submits the existing calibrated Anderson LED output code.
refs={
'Red':'#FF0000','Orange':'#FFA500','Pink':'#FFC0CB','Yellow':'#FFFF00','Green':'#008000',
'Cyan':'#00FFFF','Blue':'#0000FF','Purple':'#800080','White':'#FFFFFF','Teal':'#008080',
'Sky Blue':'#87CEEB','Amber Gold':'#FFBF00','Lavender':'#E6E6FA','Navy Blue':'#000080',
'Burgundy':'#800020','Silver Gray':'#C0C0C0'}
outputs={
'Red':'#FF0000','Orange':'#FF0D00','Pink':'#FF0024','Yellow':'#FFFF44','Green':'#28FF00',
'Cyan':'#00BD4C','Blue':'#0D00FF','Purple':'#5B00E6','White':'#FFFFFA','Teal':'#00B4B4',
'Sky Blue':'#0096FF','Amber Gold':'#FFA000','Lavender':'#B464FF','Navy Blue':'#001478',
'Burgundy':'#87002D','Silver Gray':'#A0A5AF'}

p=ROOT/'firmware/web/index.html'; ui=p.read_text()
for name,reference in refs.items():
    pat=rf"\{{name:'{re.escape(name)}',reference:'#[0-9A-Fa-f]{{6}}',output:'{outputs[name]}'\}}"
    repl=f"{{name:'{name}',reference:'{reference}',output:'{outputs[name]}'}}"
    ui,n=re.subn(pat,repl,ui,count=1)
    if n!=1: raise SystemExit(f'UI palette {name}: expected 1 match, got {n}')
ui,n=re.subn(r"const REFERENCE_LED=\{.*?\};\nconst EXPLICIT_LED=", "const REFERENCE_LED=Object.assign(Object.fromEntries(NAMED_COLOR_PALETTE.flatMap(x=>[[x.reference,x.output],[x.output,x.output]])),{'#FF9500':'#FF0D00','#22C55E':'#28FF00','#2563EB':'#0D00FF','#7E22CE':'#5B00E6','#FF69B4':'#FF0024'});\nconst EXPLICIT_LED=", ui, count=1, flags=re.S)
if n!=1: raise SystemExit('REFERENCE_LED replacement failed')

old="""const quick=[...MASTER_FAVORITE_COLORS];
quick.forEach(c=>{
  const b=document.createElement('button');
  b.className='swatch';
  b.style.background=displayColor(c);
  b.type='button';
  b.title='Add '+displayLabel(c);"""
new="""const quick=[...MASTER_FAVORITE_COLORS];
quick.forEach(c=>{
  const b=document.createElement('button');
  b.className='savedSwatch quickColorTile';
  b.style.background=displayColor(c);
  b.style.color=favoriteInk(c);
  b.textContent=favoriteName(c);
  b.type='button';
  b.setAttribute('aria-label','Add '+favoriteName(c));
  b.title='Add '+displayLabel(c);"""
ui=exact(ui,old,new,'named quick colors')
ui=ui.replace('.quick{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}', '.quick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}')
style='''.quickColorTile{width:100%;aspect-ratio:1;min-height:0;font-size:12px;line-height:1.12;padding:7px 5px;text-wrap:balance;text-shadow:0 1px 2px rgba(0,0,0,.20)}
@media(max-width:430px){#quickColors.quick{grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.quickColorTile{font-size:10px;padding:5px 3px}}
'''
needle='<style id="anderson-v310-controls">\n'
ui=exact(ui,needle,needle+style,'quick color style')
p.write_text(ui)

# Standing project rules and release notes.
p=ROOT/'AGENTS.md'; ag=p.read_text()
ag=ag.replace('illuminated nighttime house/RGB hero, integrated Anderson Home branding, dark translucent glass controls, prominent green ON control, rainbow brightness bar, effect/schedule cards, circular favorite colors, feature tiles, and floating bottom navigation.','integrated Anderson Home branding, dark translucent glass controls, prominent ON/OFF controls, monochrome brightness bar, effect/schedule cards, square dimensional favorite-color tiles, feature tiles, and floating bottom navigation. Do not restore the retired v3 hero/rainbow sprite.')
ag=ag.replace('Effect IDs `Jump=0, Breath=1, Strobe=2, Gradient=3, Solid=4`.','Supported user effects are Jump, Breath, Strobe, and Solid/Static. Legacy Gradient ID 3 may remain reserved for backward compatibility but must never be offered or assigned; legacy Gradient assignments migrate to Breath.')
ag=ag.replace('v3.0.21 and later Favorite Colors are the firmware-locked nine-color master palette in this exact order: Red `#FF0000`, Orange `#FF0D00`, Pink `#FF0024`, Yellow `#FFFF44`, Green `#28FF00`, Cyan `#00BD4C`, Blue `#0D00FF`, Purple `#5B00E6`, White `#FFFFFA`.','v3.0.29 and later Favorite Colors are the firmware-locked 16-color master palette: Red `#FF0000`, Orange `#FF0D00`, Pink `#FF0024`, Yellow `#FFFF44`, Green `#28FF00`, Cyan `#00BD4C`, Blue `#0D00FF`, Purple `#5B00E6`, White `#FFFFFA`, Teal `#00B4B4`, Sky Blue `#0096FF`, Amber Gold `#FFA000`, Lavender `#B464FF`, Navy Blue `#001478`, Burgundy `#87002D`, Silver Gray `#A0A5AF`.')
needle='- Built-in event palettes are editable through saved per-event overrides. The UI must\n  allow visible removal as well as addition of colors while keeping at least one color;\n  preserve event identity, ordering, schedules, and unrelated event settings.\n'
extra='''- Color buttons and tiles use recognizable browser-facing sRGB reference colors for their names while preserving the separate calibrated LED output codes. Quick Colors must show each color name.\n- Original Colors and Modern Colors each retain independent per-event overrides in NVS. Switching palettes must never discard the other palette's custom colors/effect/speed, and routine firmware upgrades must preserve both sets. Legacy single-slot overrides migrate non-destructively.\n- The Favorites page shows a checked Favorite control beside every favorite scene so it can be removed directly from Favorites.\n'''
if extra not in ag: ag=exact(ag,needle,needle+extra,'AGENTS persistence rules')
p.write_text(ag)

(ROOT/'firmware/RELEASE_NOTES_v3.1.1.md').write_text('''# Anderson Home v3.1.1\n\n- Fixed built-in event customization persistence across firmware updates and Original/Modern palette switching.\n- Original Colors and Modern Colors now keep independent per-event colors, effect, and speed in NVS.\n- Migrates the v3.1.0 single-slot event override non-destructively into its matching palette.\n- Added a checked Favorite control beside every scene on the Favorites page for one-step removal.\n- Removed the rainbow Current Effect artwork and deleted the retired v3 hero/rainbow sprite from the firmware build.\n- Quick Colors now show color names and use recognizable web/sRGB reference colors while still sending calibrated Anderson LED codes.\n- Preserves schedules, event identity, PIN/auth data, Wi-Fi/BLE behavior, custom shows, and OTA partition compatibility.\n''')

# Focused assertions.
ui=(ROOT/'firmware/web/index.html').read_text()
assert "reference:'#FFA500',output:'#FF0D00'" in ui
assert "reference:'#FFC0CB',output:'#FF0024'" in ui
assert "reference:'#FFBF00',output:'#FFA000'" in ui
assert "b.textContent=favoriteName(c)" in ui
assert 'v3_hero.b64' not in (ROOT/'tools/release.py').read_text()
print('v3.1.1 completion patch applied')

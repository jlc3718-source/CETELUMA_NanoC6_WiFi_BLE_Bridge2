from pathlib import Path

webp=Path('firmware/web/index.html')
web=webp.read_text()
Path('FIRMWARE_VERSION.txt').write_text('3.1.21\n')
mp=Path('firmware/src/main.cpp')
main=mp.read_text()
main=main.replace('ANDERSON_FIRMWARE_VERSION="3.1.20"','ANDERSON_FIRMWARE_VERSION="3.1.21"')
mp.write_text(main)
web=web.replace('3.1.20','3.1.21')

old="let savedColors=[],savedColorLabels=[],activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;"
if old not in web: raise SystemExit('saved color declaration not found')
web=web.replace(old,"let activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;",1)
anchor="const SEMANTIC_COLOR_VISUAL={"
pos=web.find(anchor)
if pos<0: raise SystemExit('semantic visual anchor missing')
web=web[:pos]+"let savedColors=[],savedColorLabels=[];\n\n"+web[pos:]

old="  const sync=()=>buttons.forEach(b=>b.classList.toggle('active',b.dataset.effect===sel.value));"
new="  const sync=()=>buttons.forEach(b=>{const active=b.dataset.effect===sel.value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false')});\n  sel._syncEffectButtons=sync;"
if old not in web: raise SystemExit('effect sync anchor missing')
web=web.replace(old,new,1)
web=web.replace("  $('effectSelect').value=effect;\n  $('homeEffect').value=effect;","  $('effectSelect').value=effect;$('effectSelect')._syncEffectButtons?.();\n  $('homeEffect').value=effect;$('homeEffect')._syncEffectButtons?.();",1)
web=web.replace("  $('effectSelect').value=effect;\n  setBuilderColors(colors,false);","  $('effectSelect').value=effect;$('effectSelect')._syncEffectButtons?.();\n  setBuilderColors(colors,false);",1)

old="document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor'),colors=box?.querySelector('.row.wraprow');if(colors)renderEventFavoriteGrid(g,c=>{if(colors.children.length>=8)return;const b=document.createElement('button');b.type='button';b.className='colorChip';setChipColor(b,c);b.onclick=()=>openRgbWheel(b);colors.appendChild(b)})})"
new="document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor');if(box&&typeof box._addEventColor==='function')renderEventFavoriteGrid(g,c=>box._addEventColor(c))})"
if old not in web: raise SystemExit('event favorite rebuild anchor missing')
web=web.replace(old,new,1)
needle="const addColor=c=>{if(colorRow.children.length>=8)return;"
idx=web.find(needle)
if idx<0: raise SystemExit('event addColor helper missing')
end=web.find('};',idx)
if end<0: raise SystemExit('event addColor helper end missing')
end+=2
web=web[:end]+"box._addEventColor=addColor;"+web[end:]

web=web.replace("$('liveColorCode').textContent=semanticColorName(h);","$('liveColorCode').textContent=h;",1)
webp.write_text(web)

tp=Path('tools/test_regressions.py')
t=tp.read_text()
insert="""
assert web.index('let savedColors=[],savedColorLabels=[];') < web.index('function semanticColorName') < web.index('renderColorBuilder();')
assert 'sel._syncEffectButtons=sync' in web and "setAttribute('aria-pressed'" in web
assert "$('effectSelect')._syncEffectButtons?.()" in web and "$('homeEffect')._syncEffectButtons?.()" in web
assert 'box._addEventColor=addColor' in web and "typeof box._addEventColor==='function'" in web
assert "$('liveColorCode').textContent=h" in web
"""
marker="assert 'savedColorLabels' in web and \"p.name||NAMED_COLOR_PALETTE[i]?.name\" in web\n"
if marker not in t: raise SystemExit('regression insertion marker missing')
t=t.replace(marker,marker+insert,1)
tp.write_text(t)

Path('firmware/RELEASE_NOTES_v3.1.21.md').write_text('''# Anderson Home v3.1.21\n\n- Emergency recovery for the v3.1.20 browser runtime failure that prevented the remainder of the UI from initializing.\n- Preserves the blue interface, four visible Jump/Breath/Strobe/Solid buttons, backup tab, schedules, favorites, calibrated LED payload values, permissions, and Android freeze.\n- Synchronizes effect-button highlighting with incoming state without sending unintended control commands.\n- Keeps event favorite-color additions removable after the RGB picker is opened.\n- Preserves exact HEX/RGB tuning values in Live Color Tuning.\n''')
print('v3.1.21 reviewed recovery patch applied')

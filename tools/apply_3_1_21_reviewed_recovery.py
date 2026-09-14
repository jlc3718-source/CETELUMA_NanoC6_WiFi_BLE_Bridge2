from pathlib import Path

webp=Path('firmware/web/index.html')
web=webp.read_text()
Path('FIRMWARE_VERSION.txt').write_text('3.1.21\n')
mp=Path('firmware/src/main.cpp')
main=mp.read_text()
main=main.replace('ANDERSON_FIRMWARE_VERSION="3.1.20"','ANDERSON_FIRMWARE_VERSION="3.1.21"')
mp.write_text(main)
web=web.replace('3.1.20','3.1.21')

# Critical 3.1.20 runtime fix: semanticColorName() was reached by renderColorBuilder()
# before these lexical bindings initialized, throwing a TDZ ReferenceError and halting UI startup.
old="let savedColors=[],savedColorLabels=[],activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;"
if old not in web: raise SystemExit('saved color declaration not found')
web=web.replace(old,"let activeColorChip=null,pickerH=0,pickerS=0,pickerV=1;",1)
anchor="const SEMANTIC_COLOR_VISUAL={"
pos=web.find(anchor)
if pos<0: raise SystemExit('semantic visual anchor missing')
web=web[:pos]+"let savedColors=[],savedColorLabels=[];\n\n"+web[pos:]

# Side-effect-free effect button renderer. Incoming state updates repaint buttons without POSTing.
old="  const sync=()=>buttons.forEach(b=>b.classList.toggle('active',b.dataset.effect===sel.value));"
new="  const sync=()=>buttons.forEach(b=>{const active=b.dataset.effect===sel.value;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false')});\n  sel._syncEffectButtons=sync;"
if old not in web: raise SystemExit('effect sync anchor missing')
web=web.replace(old,new,1)
web=web.replace("  $('effectSelect').value=effect;\n  $('homeEffect').value=effect;","  $('effectSelect').value=effect;$('effectSelect')._syncEffectButtons?.();\n  $('homeEffect').value=effect;$('homeEffect')._syncEffectButtons?.();",1)
web=web.replace("  $('effectSelect').value=effect;\n  setBuilderColors(colors,false);","  $('effectSelect').value=effect;$('effectSelect')._syncEffectButtons?.();\n  setBuilderColors(colors,false);",1)

# Reuse the event editor's addColor path after RGB picker refresh so every chip keeps remove controls.
old="document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor'),colors=box?.querySelector('.row.wraprow');if(colors)renderEventFavoriteGrid(g,c=>{if(colors.children.length>=8)return;const b=document.createElement('button');b.type='button';b.className='colorChip';setChipColor(b,c);b.onclick=()=>openRgbWheel(b);colors.appendChild(b)})})"
new="document.querySelectorAll('.eventFavoriteGrid').forEach(g=>{const box=g.closest('.eventEditor');if(box&&typeof box._addEventColor==='function')renderEventFavoriteGrid(g,c=>box._addEventColor(c))})"
if old not in web: raise SystemExit('event favorite rebuild anchor missing')
web=web.replace(old,new,1)
marker="  (ev.colors||['#E08700']).forEach(addColor);"
if marker not in web: raise SystemExit('event addColor marker missing')
web=web.replace(marker,"  box._addEventColor=addColor;\n"+marker,1)

# Finish semantic color presentation on custom-light and custom-schedule surfaces without changing payloads.
old="(Array.isArray(p.colors)?p.colors:[]).forEach(color=>{const chip=document.createElement('span');chip.className='chip';chip.style.background=displayColor(color);chips.appendChild(chip)})"
new="(Array.isArray(p.colors)?p.colors:[]).forEach(color=>{const chip=document.createElement('span');chip.className='colorNamePill';chip.style.background=semanticColorVisual(color);chip.style.color=semanticColorInk(color);chip.textContent=semanticColorName(color);chip.title=semanticColorName(color);chips.appendChild(chip)})"
if old not in web: raise SystemExit('custom light semantic anchor missing')
web=web.replace(old,new,1)
old="(x.colors||[]).forEach(c=>{const chip=document.createElement('span');chip.className='chip';chip.style.background=/^#[0-9A-F]{6}$/i.test(c)?c:'#FFFFFA';chips.appendChild(chip)})"
new="(x.colors||[]).forEach(c=>{const chip=document.createElement('span');chip.className='colorNamePill';chip.style.background=semanticColorVisual(c);chip.style.color=semanticColorInk(c);chip.textContent=semanticColorName(c);chip.title=semanticColorName(c);chips.appendChild(chip)})"
if old not in web: raise SystemExit('custom schedule semantic anchor missing')
web=web.replace(old,new,1)

# Keep exact tuning information prominent in the dedicated tuning panel.
web=web.replace("$('liveColorCode').textContent=semanticColorName(h);","$('liveColorCode').textContent=h;",1)
webp.write_text(web)

tp=Path('tools/test_regressions.py')
t=tp.read_text()
t=t.replace("assert \"$('liveColorCode').textContent=semanticColorName(h)\" in web\n","assert \"$('liveColorCode').textContent=h\" in web\n",1)
insert="""
assert web.index('let savedColors=[],savedColorLabels=[];') < web.index('function semanticColorName') < web.index('renderColorBuilder();')
assert 'sel._syncEffectButtons=sync' in web and "setAttribute('aria-pressed'" in web
assert "$('effectSelect')._syncEffectButtons?.()" in web and "$('homeEffect')._syncEffectButtons?.()" in web
assert 'box._addEventColor=addColor' in web and "typeof box._addEventColor==='function'" in web
assert "customLightSummary" in web and "chip.className='colorNamePill'" in web
"""
marker="assert 'savedColorLabels' in web and \"p.name||NAMED_COLOR_PALETTE[i]?.name\" in web\n"
if marker not in t: raise SystemExit('regression insertion marker missing')
t=t.replace(marker,marker+insert,1)
tp.write_text(t)

Path('firmware/RELEASE_NOTES_v3.1.21.md').write_text('''# Anderson Home v3.1.21\n\n- Emergency recovery for the v3.1.20 browser runtime failure that prevented the remainder of the UI from initializing.\n- Preserves the blue interface, four visible Jump/Breath/Strobe/Solid buttons, backup tab, schedules, favorites, calibrated LED payload values, permissions, and Android freeze.\n- Synchronizes effect-button highlighting with incoming state without sending unintended control commands.\n- Keeps event favorite-color additions removable after the RGB picker is opened.\n- Uses semantic color names on built-in and custom schedule surfaces while preserving calibrated LED payloads.\n- Preserves exact HEX/RGB tuning values in Live Color Tuning.\n''')
print('v3.1.21 reviewed recovery patch applied')

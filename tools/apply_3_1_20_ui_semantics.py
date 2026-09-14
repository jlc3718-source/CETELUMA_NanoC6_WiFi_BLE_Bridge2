from pathlib import Path
import re

web_path=Path('firmware/web/index.html')
test_path=Path('tools/test_regressions.py')
notes_path=Path('firmware/RELEASE_NOTES_v3.1.20.md')
web=web_path.read_text()

css='''\n<style id="anderson-semantic-color-ui">\n.effectSelectHidden{display:none!important}\n.effectButtonGroup{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:7px 0 2px}\n.effectChoice{min-height:42px;padding:8px 5px;border:1px solid rgba(76,177,224,.42);background:rgba(6,18,30,.78);color:var(--text);border-radius:11px;font-size:12px;font-weight:750;cursor:pointer}\n.effectChoice.active{border-color:#55dfff;background:linear-gradient(180deg,rgba(39,170,255,.34),rgba(20,90,145,.42));box-shadow:0 0 0 1px rgba(41,216,255,.2),0 0 14px rgba(41,216,255,.16)}\n.colorNamePill{display:inline-flex;align-items:center;justify-content:center;min-height:25px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.32);font-size:10px;font-weight:800;line-height:1;text-shadow:0 1px 2px rgba(0,0,0,.22)}\n.colorChip.namedColorChip{width:auto!important;min-width:74px!important;height:48px!important;padding:5px 7px!important;font-size:10px!important;font-weight:800!important;line-height:1.05!important;text-align:center!important}\n@media(max-width:430px){.effectButtonGroup{gap:5px}.effectChoice{font-size:10px;padding:7px 3px}.colorChip.namedColorChip{min-width:66px!important}}\n</style>\n'''
if 'id="anderson-semantic-color-ui"' not in web:
    if '</head>' not in web: raise SystemExit('missing </head>')
    web=web.replace('</head>',css+'</head>',1)

palette_match=re.search(r'(const NAMED_COLOR_PALETTE=\[.*?\];)',web,re.S)
if not palette_match: raise SystemExit('NAMED_COLOR_PALETTE not found')
helper='''\n\nconst SEMANTIC_COLOR_VISUAL={\n  'Red':'#FF0000','Orange':'#FF7A00','Pink':'#FF3B9D','Yellow':'#FFD400',\n  'Green':'#00C853','Cyan':'#00D9FF','Blue':'#0066FF','Purple':'#8A2BE2',\n  'White':'#FFFFFF','Teal':'#00B8A9','Sky Blue':'#4DB8FF','Amber Gold':'#FFB000',\n  'Lavender':'#B57EDC','Navy Blue':'#001F5B','Burgundy':'#800020','Silver Gray':'#A7ADB5'\n};\nfunction semanticColorName(c){\n  const k=normHex(c);\n  if(typeof savedColors!=='undefined'&&typeof savedColorLabels!=='undefined'&&savedColors.length){\n    for(let i=0;i<savedColors.length;i++)if(normHex(savedColors[i])===k&&savedColorLabels[i])return savedColorLabels[i];\n  }\n  const exact=NAMED_COLOR_PALETTE.find(x=>normHex(x.output)===k||normHex(x.reference)===k);\n  if(exact)return exact.name;\n  const q=hexRgb(k);let best=NAMED_COLOR_PALETTE[0],bestD=Infinity;\n  const pool=(typeof savedColors!=='undefined'&&savedColors.length)?savedColors:NAMED_COLOR_PALETTE.map(x=>x.output);\n  pool.forEach((v,i)=>{const p=hexRgb(normHex(v)),d=(q[0]-p[0])**2+(q[1]-p[1])**2+(q[2]-p[2])**2;if(d<bestD){bestD=d;best=NAMED_COLOR_PALETTE[i]||best;}});\n  return best?.name||'Custom Color';\n}\nfunction semanticColorVisual(c,name=''){const n=name||semanticColorName(c);return SEMANTIC_COLOR_VISUAL[n]||SEMANTIC_COLOR_VISUAL[semanticColorName(c)]||normHex(c)}\nfunction semanticColorInk(c,name=''){const q=hexRgb(semanticColorVisual(c,name));return(q[0]*299+q[1]*587+q[2]*114)>155000?'#071019':'#FFFFFF'}\n\nconst EFFECT_BUTTON_VALUES=['Jump','Breath','Strobe','Solid'];\nfunction enhanceEffectSelect(sel){\n  if(!sel||sel.dataset.effectButtonsReady==='1')return;\n  sel.dataset.effectButtonsReady='1';sel.classList.add('effectSelectHidden');\n  const group=document.createElement('div');group.className='effectButtonGroup';group.setAttribute('role','group');group.setAttribute('aria-label','Effect');\n  const buttons=[];\n  const sync=()=>buttons.forEach(b=>b.classList.toggle('active',b.dataset.effect===sel.value));\n  EFFECT_BUTTON_VALUES.forEach(v=>{const b=document.createElement('button');b.type='button';b.className='effectChoice';b.dataset.effect=v;b.textContent=v==='Solid'?'Solid':v;b.addEventListener('click',()=>{sel.value=v;sel.dispatchEvent(new Event('change',{bubbles:true}));sync()});buttons.push(b);group.appendChild(b)});\n  sel.insertAdjacentElement('afterend',group);sel.addEventListener('change',sync);sync();\n}\nfunction enhanceEffectButtons(root=document){\n  const selector='#homeEffect,#effectSelect,.eventEditor select.field';\n  if(root?.matches?.(selector))enhanceEffectSelect(root);\n  root?.querySelectorAll?.(selector).forEach(enhanceEffectSelect);\n}\nconst effectButtonObserver=new MutationObserver(ms=>ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1)enhanceEffectButtons(n)})));\nrequestAnimationFrame(()=>{enhanceEffectButtons(document);effectButtonObserver.observe(document.body,{childList:true,subtree:true})});\n'''
if 'const SEMANTIC_COLOR_VISUAL=' not in web:
    web=web[:palette_match.end()]+helper+web[palette_match.end():]

repls=[
("function displayLabel(c){const k=String(c||'').toUpperCase(),n=LED_COLOR_NAME[k],r=LED_REFERENCE[k];return n&&r?`${n} ${r} • LED ${k}`:c}",
 "function displayLabel(c){return semanticColorName(c)}"),
("function favoriteName(c){const k=normHex(c);return LED_COLOR_NAME[k]||k}",
 "function favoriteName(c){return semanticColorName(c)}"),
("function favoriteInk(c){const q=hexRgb(displayColor(c));return(q[0]*299+q[1]*587+q[2]*114)>155000?'#071019':'#FFFFFF'}",
 "function favoriteInk(c){return semanticColorInk(c)}"),
("function masterFavoriteTile(c,verb,onClick,label=''){const b=document.createElement('button');b.type='button';b.className='savedSwatch';b.style.background=displayColor(c);b.style.color=favoriteInk(c);const n=label||favoriteName(c);b.textContent=n;b.setAttribute('aria-label',verb+' '+n);b.title=verb+' '+n+' '+normHex(c);b.onclick=onClick;return b}",
 "function masterFavoriteTile(c,verb,onClick,label=''){const b=document.createElement('button');b.type='button';b.className='savedSwatch';const n=label||favoriteName(c);b.style.background=semanticColorVisual(c,n);b.style.color=semanticColorInk(c,n);b.textContent=n;b.setAttribute('aria-label',verb+' '+n);b.title=verb+' '+n;b.onclick=onClick;return b}"),
("chip.style.background=displayColor(h);chip.title=displayLabel(h)+' — tap to edit';",
 "chip.style.background=semanticColorVisual(h);chip.style.color=semanticColorInk(h);chip.textContent=semanticColorName(h);chip.classList.add('namedColorChip');chip.title=semanticColorName(h)+' — tap to edit';"),
("b.style.background=displayColor(c);\n  b.style.color=favoriteInk(c);\n  b.textContent=favoriteName(c);",
 "b.style.background=semanticColorVisual(c,favoriteName(c));\n  b.style.color=semanticColorInk(c,favoriteName(c));\n  b.textContent=favoriteName(c);"),
("b.title='Add '+displayLabel(c);",
 "b.title='Add '+favoriteName(c);"),
("b.style.background=hex;b.style.color=favoriteInk(hex);b.textContent=p.name;b.title=`${p.name} ${hex}${p.customized?' • overwritten':''}`;b.setAttribute('aria-label','Select '+p.name+' preset '+hex);",
 "b.style.background=semanticColorVisual(hex,p.name);b.style.color=semanticColorInk(hex,p.name);b.textContent=p.name;b.title=`${p.name}${p.customized?' • overwritten':''}`;b.setAttribute('aria-label','Select '+p.name+' preset');"),
("$('liveColorCode').textContent=h;",
 "$('liveColorCode').textContent=semanticColorName(h);"),
("await post('/api/control',{power:true,name:'Live Color Tune '+color,colors:[color],effect:'Solid',brightness});",
 "await post('/api/control',{power:true,name:'Live Color Tune '+semanticColorName(color),colors:[color],effect:'Solid',brightness});"),
("power=true;running={name:'Live Color Tune '+color,colors:[color],effect:'Solid'};",
 "power=true;running={name:'Live Color Tune '+semanticColorName(color),colors:[color],effect:'Solid'};"),
("if(announce)status('Previewing '+color+' on the selected light controller.');",
 "if(announce)status('Previewing '+semanticColorName(color)+' on the selected light controller.');"),
("status(`${d.name||record.name} overwritten with ${d.color||color}.`);",
 "status(`${d.name||record.name} preset overwritten.`);"),
]
for old,new in repls:
    if old not in web: raise SystemExit('missing replacement target: '+old[:90])
    web=web.replace(old,new,1)

old_chip='''<div class=\\"chips\\">${ev.colors.map(c=>`<span class=\\"chip\\" style=\\"background:${c}\\"></span>`).join('')}</div>'''
new_chip='''<div class=\\"chips\\">${ev.colors.map(c=>`<span class=\\"colorNamePill\\" style=\\"background:${semanticColorVisual(c)};color:${semanticColorInk(c)}\\">${semanticColorName(c)}</span>`).join('')}</div>'''
if old_chip not in web: raise SystemExit('event chips target missing')
web=web.replace(old_chip,new_chip,1)

# Preserve exact HEX/RGB edit fields, but the large visible readout is now semantic.
web_path.write_text(web)

test=test_path.read_text()
anchor="assert '<option value=\"Breath\">Breath</option>' in web and \"['Jump','Breath','Strobe','Solid']\" in web\n"
extra="""assert 'const EFFECT_BUTTON_VALUES=[' in web and \"'Jump','Breath','Strobe','Solid'\" in web\nassert 'effectButtonGroup' in web and 'enhanceEffectSelect' in web and 'effectSelectHidden' in web\nassert 'const SEMANTIC_COLOR_VISUAL=' in web and 'semanticColorName' in web and 'semanticColorVisual' in web\nassert \"'Yellow':'#FFD400'\" in web and \"'Orange':'#FF7A00'\" in web\nassert 'colorNamePill' in web and '${semanticColorName(c)}</span>' in web\nassert \"$('liveColorCode').textContent=semanticColorName(h)\" in web\nassert \"b.title=verb+' '+n\" in web and \"preset '+hex\" not in web\n"""
if extra.strip() not in test:
    if anchor not in test: raise SystemExit('test anchor missing')
    test=test.replace(anchor,anchor+extra,1)
test_path.write_text(test)

notes=notes_path.read_text() if notes_path.exists() else '# Anderson Home v3.1.20\n'
add='''\n- Replaces effect dropdown presentation with four visible **Jump / Breath / Strobe / Solid** buttons while preserving the existing effect engine and saved values.\n- Displays semantic color names and normal human-recognizable UI colors throughout presets, quick colors, event cards, event editing, and favorites; calibrated LED output codes remain unchanged.\n- Keeps exact HEX/RGB values available only in the dedicated Live Color Tuning editor.\n'''
if 'semantic color names' not in notes:
    notes=notes.rstrip()+add
notes_path.write_text(notes+'\n')
print('Applied v3.1.20 visible-effect and semantic-color UI changes')

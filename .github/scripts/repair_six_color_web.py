#!/usr/bin/env python3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

web=ROOT/'firmware/web/index.html'
s=web.read_text()
bad="function displayLabel(c){const k=String(c||'').toUpperCase(),n=LED_COLOR_NAME[k],r=LED_REFERENCE[k];return n&&r?`${n} ${r} • LED ${k}`:c} ${r} • LED ${k}`:c}"
good="function displayLabel(c){const k=String(c||'').toUpperCase(),n=LED_COLOR_NAME[k],r=LED_REFERENCE[k];return n&&r?`${n} ${r} • LED ${k}`:c}"
if bad not in s:
    raise SystemExit('expected malformed displayLabel fragment not found')
s=s.replace(bad,good,1)
s=s.replace("setRunning('Suicide Prevention Awareness Month',['#00664D','#23018C'],'Gradient')","setRunning('Suicide Prevention Awareness Month',['#28FF00','#5B00E6'],'Gradient')")
s=s.replace("function addColor(v='#FFFFFF')","function addColor(v='#FFFF44')")
s=s.replace("(ev.colors||['#FFFFFF']).forEach(addColor)","(ev.colors||['#FFFF44']).forEach(addColor)")
web.write_text(s)

main=ROOT/'firmware/src/main.cpp'
m=main.read_text()
m=m.replace('if(!c.size())c.add("#FF6E00");','if(!c.size())c.add("#FFFF44");')
old='if(col.length()!=7){server.send(400,"text/plain","Color must be #RRGGBB");return;}bool remove=d["remove"]|false;'
new='if(col.length()!=7){server.send(400,"text/plain","Color must be #RRGGBB");return;}col=andersonCorrectHex(col);bool remove=d["remove"]|false;'
if old not in m:
    raise SystemExit('favorite color POST validation anchor not found')
m=m.replace(old,new,1)
main.write_text(m)

required=['#FF0D00','#FF0024','#FFFF44','#28FF00','#0D00FF','#5B00E6']
check=web.read_text()
for color in required:
    if color not in check:
        raise SystemExit('missing baseline '+color)
if bad in check:
    raise SystemExit('malformed displayLabel function remains')
if good not in check:
    raise SystemExit('correct displayLabel function missing')
print('Repaired six-color web palette and canonical favorite-save path')

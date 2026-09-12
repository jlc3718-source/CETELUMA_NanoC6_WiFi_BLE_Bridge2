from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "firmware/web/index.html"
MAIN = ROOT / "firmware/src/main.cpp"
VERSION = ROOT / "FIRMWARE_VERSION.txt"
README = ROOT / "README.md"
AGENTS = ROOT / "AGENTS.md"

web = WEB.read_text()

css_anchor = ".pickerPreview{height:38px;border-radius:10px;border:1px solid #334155;margin:8px 0}\n"
css_insert = css_anchor + ".liveColorTuneWheel{width:min(68vw,260px);height:min(68vw,260px);max-width:260px;max-height:260px}.liveColorCode{text-align:center;font:800 clamp(22px,6vw,32px)/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;color:#f8fbff;margin:4px 0 2px;user-select:all}.liveColorRgb{text-align:center}.liveColorPreview{height:54px;border-radius:13px;border:1px solid rgba(255,255,255,.22);margin:10px 0;box-shadow:inset 0 0 20px rgba(255,255,255,.06),0 0 22px rgba(41,216,255,.08)}\n"
assert css_anchor in web, "live color CSS anchor missing"
web = web.replace(css_anchor, css_insert, 1)

panel_anchor = "      <div id=\"sysDetails\" class=\"card sysDetails\">Waiting for live telemetry…</div>\n    </div>\n    <div class=\"panel\">\n      <strong>Overlap Behavior</strong>"
panel_insert = """      <div id=\"sysDetails\" class=\"card sysDetails\">Waiting for live telemetry…</div>\n    </div>\n    <div id=\"liveColorTunerPanel\" class=\"panel\">\n      <strong>Live Color Tuning</strong><div class=\"sub\">Fine-tune an exact RGB output while watching the selected light controller respond. This preview does not save or alter event colors.</div>\n      <div id=\"liveColorWheel\" class=\"rgbWheel liveColorTuneWheel\"><div id=\"liveColorMarker\" class=\"rgbWheelMarker\"></div></div>\n      <div id=\"liveColorCode\" class=\"liveColorCode\">#FFFFFF</div>\n      <div id=\"liveColorRgb\" class=\"sub liveColorRgb\">RGB 255, 255, 255</div>\n      <div id=\"liveColorPreview\" class=\"liveColorPreview\" style=\"background:#FFFFFF\"></div>\n      <div class=\"label row between\"><span>RGB value</span><span id=\"liveColorValueText\" class=\"muted\">100%</span></div><input id=\"liveColorValue\" type=\"range\" min=\"0\" max=\"100\" value=\"100\">\n      <label class=\"row\" style=\"margin-top:12px\"><input id=\"liveColorEnabled\" type=\"checkbox\" checked><span class=\"small\">Live preview on lights while selecting</span></label>\n      <button id=\"liveColorPreviewButton\" class=\"btn primary\" type=\"button\" style=\"width:100%;margin-top:10px\">Preview on Lights</button>\n      <div class=\"sub\" style=\"margin-top:7px\">The HEX code above is the exact RGB code sent to the lights. Preview uses Solid / Static at the current light brightness. Use Resume Schedule when you are finished tuning.</div>\n    </div>\n    <div class=\"panel\">\n      <strong>Overlap Behavior</strong>"""
assert panel_anchor in web, "settings panel anchor missing"
web = web.replace(panel_anchor, panel_insert, 1)

bind_anchor = "function bindRgbPicker(){const w=$('rgbWheel');let drag=false;w.addEventListener('pointerdown',e=>{drag=true;w.setPointerCapture(e.pointerId);wheelPoint(e)});w.addEventListener('pointermove',e=>{if(drag)wheelPoint(e)});w.addEventListener('pointerup',()=>drag=false);$('rgbValue').addEventListener('input',e=>{pickerV=(+e.target.value)/100;renderPicker()});['rgbR','rgbG','rgbB'].forEach(id=>$(id).addEventListener('change',()=>setPickerHex(rgbHex($('rgbR').value,$('rgbG').value,$('rgbB').value))));$('rgbHex').addEventListener('change',e=>setPickerHex(e.target.value));$('rgbSave').addEventListener('click',saveCurrentColor);$('rgbClose').addEventListener('click',()=>$('rgbPickerOverlay').classList.remove('open'));$('rgbPickerOverlay').addEventListener('click',e=>{if(e.target===$('rgbPickerOverlay'))$('rgbPickerOverlay').classList.remove('open')})}\n"
live_js = r"""

let liveTuneH=0,liveTuneS=0,liveTuneV=1,liveTuneTimer=null,liveTuneSending=false,liveTuneQueued=false;
function liveTuneHex(){const q=hsvRgb(liveTuneH,liveTuneS,liveTuneV);return rgbHex(q[0],q[1],q[2])}
function renderLiveColorTune(sendLive=false){const h=liveTuneHex(),q=hexRgb(h),w=$('liveColorWheel');if(!w)return;const rad=w.clientWidth/2,ang=(liveTuneH-90)*Math.PI/180,rr=liveTuneS*rad*.92;$('liveColorMarker').style.left=(rad+Math.cos(ang)*rr)+'px';$('liveColorMarker').style.top=(rad+Math.sin(ang)*rr)+'px';$('liveColorCode').textContent=h;$('liveColorRgb').textContent=`RGB ${q[0]}, ${q[1]}, ${q[2]}`;$('liveColorPreview').style.background=h;$('liveColorValue').value=Math.round(liveTuneV*100);$('liveColorValueText').textContent=Math.round(liveTuneV*100)+'%';if(sendLive&&$('liveColorEnabled').checked)scheduleLiveColorTune()}
function liveColorWheelPoint(e){const w=$('liveColorWheel'),r=w.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2,dx=e.clientX-cx,dy=e.clientY-cy,dist=Math.sqrt(dx*dx+dy*dy),rad=r.width/2;liveTuneS=Math.min(1,dist/(rad*.92));liveTuneH=(Math.atan2(dy,dx)*180/Math.PI+90+360)%360;renderLiveColorTune(true)}
function scheduleLiveColorTune(){clearTimeout(liveTuneTimer);liveTuneTimer=setTimeout(()=>sendLiveColorTune(false),120)}
async function sendLiveColorTune(announce=true){clearTimeout(liveTuneTimer);const color=liveTuneHex();if(liveTuneSending){liveTuneQueued=true;return}liveTuneSending=true;try{if(API_MODE){await post('/api/control',{power:true,name:'Live Color Tune '+color,colors:[color],effect:'Solid',brightness});}else{power=true;running={name:'Live Color Tune '+color,colors:[color],effect:'Solid'};}if(announce)status('Previewing '+color+' on the selected light controller.')}catch(e){if(announce)status('Color preview failed: '+e.message)}finally{liveTuneSending=false;if(liveTuneQueued){liveTuneQueued=false;scheduleLiveColorTune()}}}
function bindLiveColorTuner(){const w=$('liveColorWheel');if(!w)return;let drag=false;w.addEventListener('pointerdown',e=>{drag=true;w.setPointerCapture(e.pointerId);liveColorWheelPoint(e)});w.addEventListener('pointermove',e=>{if(drag)liveColorWheelPoint(e)});w.addEventListener('pointerup',()=>drag=false);w.addEventListener('pointercancel',()=>drag=false);$('liveColorValue').addEventListener('input',e=>{liveTuneV=(+e.target.value)/100;renderLiveColorTune(true)});$('liveColorPreviewButton').addEventListener('click',()=>sendLiveColorTune(true));$('liveColorEnabled').addEventListener('change',e=>{if(e.target.checked)sendLiveColorTune(false)});renderLiveColorTune(false)}
"""
assert bind_anchor in web, "RGB picker bind anchor missing"
web = web.replace(bind_anchor, bind_anchor + live_js, 1)

init_anchor = "setTimeout(bindRgbPicker,0);"
assert init_anchor in web, "RGB picker init anchor missing"
web = web.replace(init_anchor, "setTimeout(()=>{bindRgbPicker();bindLiveColorTuner()},0);", 1)

# Focused source validation before writing.
for required in [
    'id="liveColorTunerPanel"', 'id="liveColorWheel"', 'id="liveColorCode"',
    'id="liveColorPreview"', 'id="liveColorPreviewButton"', 'id="liveColorEnabled"',
    "function bindLiveColorTuner()", "effect:'Solid'", "scheduleLiveColorTune()"
]:
    assert required in web, f"missing live color tuner element: {required}"
WEB.write_text(web)

main = MAIN.read_text()
assert 'ANDERSON_FIRMWARE_VERSION="3.0.15"' in main, "main firmware version anchor missing"
MAIN.write_text(main.replace('ANDERSON_FIRMWARE_VERSION="3.0.15"', 'ANDERSON_FIRMWARE_VERSION="3.0.16"', 1))

assert VERSION.read_text().strip() == "3.0.15", "unexpected firmware version file"
VERSION.write_text("3.0.16\n")

readme = README.read_text()
assert "Current firmware: **v3.0.15**." in readme, "README version anchor missing"
README.write_text(readme.replace("Current firmware: **v3.0.15**.", "Current firmware: **v3.0.16**.", 1))

agents = AGENTS.read_text()
agent_anchor = "- v3.0.1 and later use the approved third-reference Anderson Home dashboard as the visual source of truth: illuminated nighttime house/RGB hero, integrated Anderson Home branding, dark translucent glass controls, prominent green ON control, rainbow brightness bar, effect/schedule cards, circular favorite colors, feature tiles, and floating bottom navigation. Do not regress to the generic logo-card/tab-bar layout unless the user explicitly requests it.\n"
agent_add = agent_anchor + "- Settings includes the v3.0.16 Live Color Tuning panel: an embedded RGB wheel with an exact live HEX/RGB readout, on-screen color preview, switchable live-to-lights updates, and an explicit Preview on Lights button. Tuning is temporary and must not silently save or rewrite event/theme colors.\n"
assert agent_anchor in agents, "AGENTS UI anchor missing"
AGENTS.write_text(agents.replace(agent_anchor, agent_add, 1))

print("Applied Anderson Home v3.0.16 live color tuning patch")

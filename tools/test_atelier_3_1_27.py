"""3.1.27 presentation invariants and browser exercise against an isolated fake controller."""
import base64
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
from release import ROOT, render_ui

BASE="949294c0346bcf3c0a167062fc3ac973f05882bd"
def old(path): return subprocess.check_output(["git","show",BASE+":"+path],text=True)
paths=subprocess.check_output(["git","ls-tree","-r","--name-only",BASE,"firmware/src","firmware/include","firmware/partitions_ota.csv","firmware/platformio.ini","firmware/web/recovery.html"],text=True).splitlines()
for path in paths:
    new=(ROOT/path).read_text()
    if path=="firmware/src/main.cpp": new=new.replace('ANDERSON_FIRMWARE_VERSION="3.1.27"','ANDERSON_FIRMWARE_VERSION="3.1.26"')
    assert new==old(path), "Protected implementation changed: "+path
html=(ROOT/"firmware/web/index.html").read_text()
prior=old("firmware/web/index.html")
assert re.findall(r"<script\b[^>]*>(.*?)</script>",html,re.S)==re.findall(r"<script\b[^>]*>(.*?)</script>",prior,re.S), "Base control scripts changed"
assert set(re.findall(r'\bid="([^"]+)"',prior))<=set(re.findall(r'\bid="([^"]+)"',html)), "Existing control IDs removed"
assert (ROOT/"firmware/web/v3_mockup.js").read_text().startswith(old("firmware/web/v3_mockup.js")), "Existing layout/control implementation changed"
print("PASS: firmware logic, safety code, all original control scripts and IDs preserved")
out=ROOT/"ui-review";out.mkdir(exist_ok=True)
rendered=render_ui()
events=[
 {"id":"test1","name":"Independence Day","when":"July 4","kind":"holiday","colors":["#FF0000","#FFFFFA","#0D00FF"],"effect":"Jump","enabled":True,"favorite":True,"speed":1},
 {"id":"test2","name":"Winter evenings","when":"December","kind":"monthly","colors":["#0D00FF","#FFFFFA"],"effect":"Solid","enabled":True,"favorite":True,"speed":1},
 {"id":"test3","name":"Autumn nights","when":"October","kind":"monthly","colors":["#FF0D00","#5B00E6"],"effect":"Jump","enabled":True,"favorite":True,"speed":1},
 {"id":"test4","name":"The blue hour","when":"September","kind":"monthly","colors":["#0D00FF"],"effect":"Solid","enabled":True,"favorite":True,"speed":1},
]
with sync_playwright() as p:
    browser=p.chromium.launch()
    for width in (390,1280,320,768):
        state={"power":True,"brightness":75,"speed":2,"running":{"name":"The blue hour","colors":["#0D00FF"],"effect":"Solid"},"scheduleWindow":"5:00 PM – 11:00 PM","nextEvent":"Autumn nights · October 1","wifi":{"ssid":"Home network","rssi":-52,"ip":"192.0.2.10"},"ble":{"connectedCount":2,"controllers":[]},"settings":{"on":"17:00","off":"23:00","scheduler":True,"scheduler2":True,"schedule2Brightness":10}}
        writes=[];errors=[]
        page=browser.new_page(viewport={"width":width,"height":1000},reduced_motion="reduce")
        page.on("pageerror",lambda err:errors.append(str(err)))
        def route(r):
            path=urlparse(r.request.url).path
            if path=="/":
                r.fulfill(status=200,content_type="text/html",body=rendered);return
            data={};status=200
            if r.request.method=="POST":
                body=r.request.post_data_json or {};writes.append((path,body))
                if path=="/api/auth/unlock":
                    profile=body.get("profile");valid=body.get("pin")==("1234" if profile=="jason" else "4321")
                    if valid:data={"pinEnabled":True,"token":"test-session","role":"admin" if profile=="jason" else "user"}
                    else:status=403;data={"error":"PIN was not accepted."}
                elif path=="/api/control":
                    for key in ("power","brightness","speed"):
                        if key in body:state[key]=body[key]
                    for key in ("name","colors","effect"):
                        if key in body:state["running"][key]=body[key]
                    data=state
                elif path=="/api/resume":data=state
            elif path=="/api/auth/status":data={"pinEnabled":True}
            elif path=="/api/state":data=state
            elif path in ("/api/events","/api/favorites"):data={"events":events}
            elif path=="/api/event-color-theme":data={"theme":"1"}
            elif path=="/api/firmware":data={"version":"3.1.27","slotSize":1966080,"runningPartition":"app0","nextPartition":"app1","previousAvailable":True}
            elif path=="/api/system":data={"version":"3.1.27","wifiConnected":True,"rssi":-52,"cpuMhz":160,"cpuLoad":8,"heapFree":180000,"slotBytes":1966080,"appBytes":1820000,"appFreeBytes":146080,"bleCount":2,"nextReboot":"6:00 PM","nextRebootSeconds":3600,"loopWatchdog":True}
            elif path=="/api/backup/status":data={"hasBackup":True,"lastOk":True,"mask":31,"lastBackup":1789401600,"lastAutomatic":1789401600,"nextAutomatic":1790006400}
            r.fulfill(status=status,content_type="application/json",body=json.dumps(data))
        page.route("**/*",route)
        page.goto("http://anderson.test/")
        expect(page.locator('.profileChoice[data-profile="jason"]')).to_be_enabled()
        if width==390:
            data=page.screenshot(type="jpeg",quality=65)
            print("REVIEW_CHOOSER_390="+base64.b64encode(data).decode())
        page.locator('.profileChoice[data-profile="jason"]').click()
        expect(page.locator("#profilePinForm")).to_be_visible()
        page.locator("#profilePin").fill("0000");page.locator("#submitProfilePin").click()
        expect(page.locator("#profilePinError")).to_contain_text("not accepted")
        expect(page.locator("#profileGate")).to_be_visible()
        page.locator("#profilePin").fill("1234");page.locator("#submitProfilePin").click()
        expect(page.locator("#profileGate")).to_be_hidden()
        expect(page.locator("#homeBrightVal")).to_have_text("75%")
        assert page.locator("#houseLeds .houseLed").count()==36
        ids=page.evaluate("Array.from(document.querySelectorAll('[id]'),n=>n.id)")
        assert len(ids)==len(set(ids)), "Duplicate IDs after composition"
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), f"Home overflow {width}"
        page.evaluate("scrollTo(0,0)")
        if width in (390,1280):
            data=page.screenshot(path=str(out/f"home-{width}.jpg"),type="jpeg",quality=70,full_page=True)
            print(f"REVIEW_HOME_{width}="+base64.b64encode(data).decode())
        page.locator("#homePowerOff").click()
        expect(page.locator("#homePowerOff")).to_have_class(re.compile("primary"))
        assert ("/api/control",{"power":False}) in writes
        page.locator("#homePowerOn").click()
        expect(page.locator("#homePowerOn")).to_have_class(re.compile("primary"))
        page.locator("#homeBrightness").evaluate("(n)=>{n.value=42;n.dispatchEvent(new Event('input',{bubbles:true}));n.dispatchEvent(new Event('change',{bubbles:true}))}")
        expect(page.locator("#homeBrightVal")).to_have_text("42%")
        assert any(path=="/api/control" and body.get("brightness")==42 for path,body in writes)
        page.locator('.v3EffectCard [data-effect="Jump"]').click()
        expect(page.locator('.v3EffectCard [data-effect="Jump"]')).to_have_attribute("aria-pressed","true")
        page.locator("#resumeSchedule").click()
        assert any(path=="/api/resume" for path,_ in writes)
        for target in ("lights","events","favorites","settings"):
            page.locator(f'.v3BottomNav [data-tab="{target}"]').click()
            expect(page.locator(f'.page[data-page="{target}"]')).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), f"{target} overflow {width}"
        for section in ("general","wifi","lighting","preview","schedules","controllers","backup","security","firmware"):
            page.locator(f'[data-settings-tab="{section}"]').click()
            expect(page.locator(f'#v3SettingsPane-{section}')).to_be_visible()
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth+1"), f"{section} overflow {width}"
        page.locator('[data-settings-tab="backup"]').click()
        expect(page.locator("#backupRestore")).to_be_enabled()
        if width==390:
            page.evaluate("scrollTo(0,0)")
            data=page.screenshot(type="jpeg",quality=65,full_page=True)
            print("REVIEW_SETTINGS_390="+base64.b64encode(data).decode())
        page.locator("#switchProfile").click()
        page.locator('.profileChoice[data-profile="shirley"]').click()
        page.locator("#profilePin").fill("4321");page.locator("#submitProfilePin").click()
        expect(page.locator("#profileGate")).to_be_hidden()
        for target in ("lights","wifi","settings"):
            expect(page.locator(f'.v3BottomNav [data-tab="{target}"]')).to_be_hidden()
            expect(page.locator(f'.page[data-page="{target}"]')).to_be_hidden()
        assert not errors, errors
        print(f"PASS {width}px: PIN gate, role restrictions, power/brightness/effect/resume handlers, all tabs, all settings panes, no overflow or script errors")
        page.close()
    browser.close()

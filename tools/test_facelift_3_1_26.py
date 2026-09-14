"""Browser layout gate for the 3.1.26 presentation-only release."""
from pathlib import Path
import re
import subprocess
from playwright.sync_api import sync_playwright
from release import render_ui, ROOT

BASE = "4d1196b1318bd6d26ab7e9507e61ee7a942305ba"
def baseline(path):
    return subprocess.check_output(["git","show",BASE+":"+path],text=True)
# Compare all protected implementation sources to the known 3.1.25 parent.
paths = subprocess.check_output(["git","ls-tree","-r","--name-only",BASE,"firmware/src","firmware/include","firmware/web","firmware/partitions_ota.csv","firmware/platformio.ini"],text=True).splitlines()
for path in paths:
    if path in ("firmware/web/index.html","firmware/web/v3_mockup.css"): continue
    old = baseline(path)
    new = (ROOT/path).read_text()
    if path == "firmware/src/main.cpp":
        new = new.replace('ANDERSON_FIRMWARE_VERSION="3.1.26"', 'ANDERSON_FIRMWARE_VERSION="3.1.25"')
    assert old == new, "Unexpected implementation change: "+path
old_html = baseline("firmware/web/index.html")
new_html = (ROOT/"firmware/web/index.html").read_text()
assert re.findall(r"<script\b[^>]*>(.*?)</script>",old_html,re.S) == re.findall(r"<script\b[^>]*>(.*?)</script>",new_html,re.S), "Functional scripts changed"
assert re.findall(r'\bid="([^"]+)"',old_html) == re.findall(r'\bid="([^"]+)"',new_html), "Control IDs changed"

out = ROOT/"ui-review"
out.mkdir(exist_ok=True)
page_file = out/"index.html"
page_file.write_text(render_ui())
with sync_playwright() as p:
    browser = p.chromium.launch()
    for width in (320,390,768,1280):
        page = browser.new_page(viewport={"width":width,"height":900},reduced_motion="reduce")
        errors=[]
        page.on("pageerror",lambda err:errors.append(str(err)))
        page.goto(page_file.as_uri())
        page.locator('.profileChoice[data-profile="jason"]').wait_for(state="visible")
        page.screenshot(path=str(out/f"chooser-{width}.png"),full_page=True)
        page.locator('.profileChoice[data-profile="jason"]').click()
        page.locator('#homePowerOn').wait_for(state="visible")
        assert page.locator('.ahBrandName').last.inner_text()=="Anderson Home"
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), f"Horizontal overflow: {width}"
        fx=page.locator(".v3EffectCard").bounding_box()
        live=page.locator(".v3LiveCard").bounding_box()
        assert abs(fx["y"]-live["y"])<2 and live["x"]>fx["x"], "Effect and live cards must share one row"
        for selector in ("#homePowerOn","#homePowerOff","#homeBrightness","#resumeSchedule"):
            box=page.locator(selector).bounding_box()
            assert box and box["width"]>20 and box["x"]>=0 and box["x"]+box["width"]<=width+1, selector
        page.screenshot(path=str(out/f"home-{width}.png"),full_page=True)
        for target in ("lights","events","favorites","settings"):
            page.locator(f'.v3BottomNav [data-tab="{target}"]').click()
            assert page.locator(f'.page[data-page="{target}"]').is_visible()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), f"Overflow: {target}/{width}"
        for section in ("general","wifi","lighting","preview","schedules","controllers","backup","security","firmware"):
            page.locator(f'[data-settings-tab="{section}"]').click()
            assert page.locator(f'#v3SettingsPane-{section}').is_visible()
        page.locator('[data-settings-tab="backup"]').click()
        page.screenshot(path=str(out/f"backup-{width}.png"),full_page=True)
        page.locator("#switchProfile").click()
        page.locator('.profileChoice[data-profile="shirley"]').click()
        for target in ("lights","wifi","settings"):
            assert not page.locator(f'.v3BottomNav [data-tab="{target}"]').is_visible(), "Restricted tab exposed"
            assert not page.locator(f'.page[data-page="{target}"]').is_visible(), "Restricted page exposed"
        assert not errors, errors
        print(f"PASS {width}px: login, layout, navigation, settings panes, restricted profile; no JavaScript errors")
        page.close()
    browser.close()
print("PASS: protected implementation and every existing UI script/ID are unchanged.")

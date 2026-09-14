from pathlib import Path

# Anderson Home v3.1.22 combines three UI/runtime fixes:
# 1) recovery entry point on profile selector
# 2) Breath restored to the animated effect row, with duplicate text-only row removed
# 3) backup settings UI uses the actual backend route names

Path('FIRMWARE_VERSION.txt').write_text('3.1.22\n')

mainp=Path('firmware/src/main.cpp')
main=mainp.read_text()
old='static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.21";'
new='static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.22";'
if old not in main:
    raise SystemExit('firmware version anchor missing')
main=main.replace(old,new,1)
mainp.write_text(main)

webp=Path('firmware/web/index.html')
web=webp.read_text()

# Small recovery button on the user/profile selection screen.
css_anchor='.profileName{display:block;font-size:20px;font-weight:800}.profileAccess{display:block;margin-top:3px;color:#aebbd0;font-size:13px}.profileGateStatus'
css_repl='.profileName{display:block;font-size:20px;font-weight:800}.profileAccess{display:block;margin-top:3px;color:#aebbd0;font-size:13px}.profileRecoveryWrap{text-align:center;margin:12px 0 2px}.profileRecoveryButton{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:6px 12px;border:1px solid #3a618c;border-radius:999px;background:rgba(10,25,42,.82);color:#c9ddf3;text-decoration:none;font-size:12px;font-weight:700;box-shadow:0 5px 16px rgba(0,0,0,.18)}.profileRecoveryButton:hover,.profileRecoveryButton:focus-visible{border-color:#55baff;color:#fff;outline:2px solid rgba(39,170,255,.24);outline-offset:2px}.profileGateStatus'
if css_anchor not in web:
    raise SystemExit('profile CSS anchor missing')
web=web.replace(css_anchor,css_repl,1)
status_anchor='    <div id="profileGateStatus" class="profileGateStatus" aria-live="polite">Checking PIN protection…</div>'
status_repl='    <div class="profileRecoveryWrap"><a class="profileRecoveryButton" href="/recovery" aria-label="Open recovery page">Recovery</a></div>\n'+status_anchor
if status_anchor not in web:
    raise SystemExit('profile status anchor missing')
web=web.replace(status_anchor,status_repl,1)

# The primary Settings > Backup & Restore pane was wired to stale endpoint names.
# Use the canonical routes that the NanoC6 actually serves.
if "post('/api/backup/config',{mask})" not in web or "post('/api/backup/now',{})" not in web:
    raise SystemExit('backup route anchors missing')
web=web.replace("post('/api/backup/config',{mask})","post('/api/backup/settings',{mask})")
web=web.replace("post('/api/backup/now',{})","post('/api/backup/manual',{mask})")

# Do not create the redundant plain-text effect row. The v3 runtime owns the
# animated four-button selector everywhere, including dynamically-added event editors.
selector_old="const selector='#homeEffect,#effectSelect,.eventEditor select.field';"
selector_new="const selector='.anderson-no-plain-effect-buttons';"
if selector_old not in web:
    raise SystemExit('plain effect selector anchor missing')
web=web.replace(selector_old,selector_new,1)

if '<strong>v3.1.21</strong>' not in web:
    raise SystemExit('visible version anchor missing')
web=web.replace('<strong>v3.1.21</strong>','<strong>v3.1.22</strong>',1)
webp.write_text(web)

# Restore Breath to the actual animated button system.
mockp=Path('firmware/web/v3_mockup.js')
mock=mockp.read_text()
repls={
    "const values=['Jump','Strobe','Solid'];":"const values=['Jump','Breath','Strobe','Solid'];",
    "const labels={Jump:'Jump',Strobe:'Strobe',Solid:'Solid'};":"const labels={Jump:'Jump',Breath:'Breath',Strobe:'Strobe',Solid:'Solid'};",
    "const hints={Jump:'Whole string steps from one color to the next',Strobe:'Color on, off, then the next color',Solid:'Holds one color steady'};":"const hints={Jump:'Whole string steps from one color to the next',Breath:'Smoothly fades the current colors brighter and dimmer',Strobe:'Color on, off, then the next color',Solid:'Holds one color steady'};",
    "effect==='__REMOVED_BREATH__'":"effect==='Breath'",
}
for a,b in repls.items():
    if a not in mock:
        raise SystemExit('animated effect anchor missing: '+a[:60])
    mock=mock.replace(a,b,1)
mockp.write_text(mock)

# Regression coverage for all three fixes.
tp=Path('tools/test_regressions.py')
t=tp.read_text()
marker="assert 'id=\"backupSettingsTab\"' in web and 'id=\"backupSettingsPanel\"' in web\n"
extra=(
    "assert 'class=\"profileRecoveryButton\" href=\"/recovery\"' in web and 'profileRecoveryWrap' in web\n"
    "assert 'server.on(\"/recovery\",HTTP_GET' in main\n"
    "assert \"post('/api/backup/settings',{mask})\" in web and \"post('/api/backup/manual',{mask})\" in web and \"post('/api/backup/restore',{})\" in web\n"
    "assert \"/api/backup/config\" not in web and \"/api/backup/now\" not in web\n"
    "assert \"const values=['Jump','Breath','Strobe','Solid'];\" in mock\n"
    "assert \"effect==='Breath'\" in mock and '__REMOVED_BREATH__' not in mock\n"
    "assert \"const selector='.anderson-no-plain-effect-buttons';\" in web\n"
)
if marker not in t:
    raise SystemExit('regression insertion anchor missing')
if "profileRecoveryButton" not in t:
    t=t.replace(marker,marker+extra,1)
else:
    # Branch may have been partially staged; keep the new invariants authoritative.
    for line in extra.splitlines(True):
        if line not in t:
            t=t.replace(marker,marker+line,1)
tp.write_text(t)

Path('firmware/RELEASE_NOTES_v3.1.22.md').write_text('''# Anderson Home v3.1.22\n\n- Adds a small **Recovery** button to the user-selection screen that opens the existing independent `/recovery` page.\n- Restores **Breath** as the fourth animated effect button beside Jump, Strobe, and Solid on the Home/effect selectors.\n- Removes the redundant plain-text effect-button row that appeared beneath the animated buttons.\n- Repairs **Settings → Backup & Restore** by wiring Save Selection and Back Up Now to the canonical NanoC6 backup endpoints; Restore Last Good Backup remains on the verified restore endpoint.\n- Preserves v3.1.21 schedules, favorites, transactional backup storage, calibrated colors, protected updates, and partition layout.\n''')

print('Anderson Home v3.1.22 recovery/effects/backup fixes applied')

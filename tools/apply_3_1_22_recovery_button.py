from pathlib import Path

# Version bump
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
if '<strong>v3.1.21</strong>' not in web:
    raise SystemExit('visible version anchor missing')
web=web.replace('<strong>v3.1.21</strong>','<strong>v3.1.22</strong>',1)
webp.write_text(web)

# Regression coverage for the user-select recovery entry point.
tp=Path('tools/test_regressions.py')
t=t=tp.read_text()
marker="assert 'id=\"backupSettingsTab\"' in web and 'id=\"backupSettingsPanel\"' in web\n"
extra="assert 'class=\"profileRecoveryButton\" href=\"/recovery\"' in web and 'profileRecoveryWrap' in web\nassert 'server.on(\"/recovery\",HTTP_GET' in main\n"
if marker not in t:
    raise SystemExit('regression insertion anchor missing')
if extra not in t:
    t=t.replace(marker,marker+extra,1)
tp.write_text(t)

Path('firmware/RELEASE_NOTES_v3.1.22.md').write_text('''# Anderson Home v3.1.22\n\n- Adds a small **Recovery** button to the user-selection screen.\n- The button opens the existing independent `/recovery` page directly, before a user profile is selected.\n- Preserves the v3.1.21 recovery, backup/restore, schedules, favorites, effects, and color behavior unchanged.\n''')

print('Anderson Home v3.1.22 recovery button applied')

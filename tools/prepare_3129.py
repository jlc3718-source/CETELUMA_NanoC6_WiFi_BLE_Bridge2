from pathlib import Path
import re

ROOT = Path('.')


def one(path, old, new):
    p = ROOT / path
    s = p.read_text()
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {n}: {old[:90]!r}')
    p.write_text(s.replace(old, new, 1))


def subline(path, pattern, replacement):
    p = ROOT / path
    s = p.read_text()
    s2, n = re.subn(pattern, replacement, s, count=1, flags=re.M)
    if n != 1:
        raise SystemExit(f'{path}: line pattern did not match exactly once: {pattern!r}')
    p.write_text(s2)


def subblock(path, pattern, replacement):
    p = ROOT / path
    s = p.read_text()
    s2, n = re.subn(pattern, replacement, s, count=1, flags=re.M | re.S)
    if n != 1:
        raise SystemExit(f'{path}: block pattern did not match exactly once')
    p.write_text(s2)


# Version
one('FIRMWARE_VERSION.txt', '3.1.28\n', '3.1.29\n')
one('firmware/src/main.cpp', 'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.28";', 'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.29";')

# Backend: Kelly is a first-class ROLE_USER with a separate salted PIN record.
one('firmware/src/main.cpp',
    'static String shirleyPinSalt,shirleyPinHash,jasonPinSalt,jasonPinHash;',
    'static String shirleyPinSalt,shirleyPinHash,kellyPinSalt,kellyPinHash,jasonPinSalt,jasonPinHash;')
one('firmware/src/main.cpp',
    'static bool basePinAuthConfigured(){return pinRecordConfigured(shirleyPinSalt,shirleyPinHash)&&pinRecordConfigured(jasonPinSalt,jasonPinHash);}\n',
    'static bool basePinAuthConfigured(){return pinRecordConfigured(shirleyPinSalt,shirleyPinHash)&&pinRecordConfigured(jasonPinSalt,jasonPinHash);}\n'
    'static bool kellyPinConfigured(){return pinRecordConfigured(kellyPinSalt,kellyPinHash);}\n'
    'static bool pinAuthConfigured(){return basePinAuthConfigured()&&kellyPinConfigured();}\n')
subline('firmware/src/main.cpp', r'^static uint8_t profileRole\(const String& profile\).*$',
        'static uint8_t profileRole(const String& profile){return profile=="jason"?ROLE_ADMIN:((profile=="shirley"||profile=="kelly")?ROLE_USER:ROLE_NONE);}')
subline('firmware/src/main.cpp', r'^static const char\* profileDisplayName\(const String& profile\).*$',
        'static const char* profileDisplayName(const String& profile){if(profile=="shirley")return "Shirley";if(profile=="kelly")return "Kelly";if(profile=="jason")return "Jason";return "";}')
subline('firmware/src/main.cpp', r'^static bool storePinAuthConfig\(.*$',
        'static bool storePinAuthConfig(bool enabled,const String& ss,const String& sh,const String& ks,const String& kh,const String& js,const String& jh){JsonDocument d;d["version"]=4;d["enabled"]=enabled;d["shirleySalt"]=ss;d["shirleyHash"]=sh;d["kellySalt"]=ks;d["kellyHash"]=kh;d["jasonSalt"]=js;d["jasonHash"]=jh;String raw;serializeJson(d,raw);Preferences p;if(!p.begin("anderson-auth",false))return false;size_t wrote=p.putString("config",raw);String verify=p.getString("config","");p.end();return wrote==raw.length()&&verify==raw;}')
subline('firmware/src/main.cpp', r'^static void loadPinAuthConfig\(\).*$',
        'static void loadPinAuthConfig(){Preferences p;if(!p.begin("anderson-auth",true))return;String raw=p.getString("config","");p.end();JsonDocument d;if(!raw.length()||deserializeJson(d,raw))return;int schema=d["version"]|0;shirleyPinSalt=d["shirleySalt"]|String("");shirleyPinHash=d["shirleyHash"]|String("");kellyPinSalt=d["kellySalt"]|String("");kellyPinHash=d["kellyHash"]|String("");jasonPinSalt=d["jasonSalt"]|String("");jasonPinHash=d["jasonHash"]|String("");pinProtectionEnabled=(d["enabled"]|false)&&basePinAuthConfigured();if(schema<4)storePinAuthConfig(pinProtectionEnabled,shirleyPinSalt,shirleyPinHash,kellyPinSalt,kellyPinHash,jasonPinSalt,jasonPinHash);}')
subline('firmware/src/main.cpp', r'^static bool configureProfilePins\(.*$',
        'static bool configureProfilePins(const String& shirleyPin,const String& kellyPin,const String& jasonPin){if(!fourDigitPin(shirleyPin)||!fourDigitPin(kellyPin)||!fourDigitPin(jasonPin)||shirleyPin==kellyPin||shirleyPin==jasonPin||kellyPin==jasonPin)return false;String ss=randomHex(16),ks=randomHex(16),js=randomHex(16),sh=pinDigest("shirley",shirleyPin,ss),kh=pinDigest("kelly",kellyPin,ks),jh=pinDigest("jason",jasonPin,js);if(sh.length()!=64||kh.length()!=64||jh.length()!=64||!storePinAuthConfig(true,ss,sh,ks,kh,js,jh))return false;shirleyPinSalt=ss;shirleyPinHash=sh;kellyPinSalt=ks;kellyPinHash=kh;jasonPinSalt=js;jasonPinHash=jh;pinProtectionEnabled=true;clearAuthSessions();return true;}')
subline('firmware/src/main.cpp', r'^static bool disablePinProtection\(\).*$',
        'static bool disablePinProtection(){if(!basePinAuthConfigured())return false;if(!storePinAuthConfig(false,shirleyPinSalt,shirleyPinHash,kellyPinSalt,kellyPinHash,jasonPinSalt,jasonPinHash))return false;pinProtectionEnabled=false;clearAuthSessions();return true;}')
subline('firmware/src/main.cpp', r'^static bool verifyProfilePin\(.*$',
        'static bool verifyProfilePin(const String& profile,const String& pin,uint8_t& role){role=profileRole(profile);if(role==ROLE_NONE||!fourDigitPin(pin))return false;const String& salt=profile=="jason"?jasonPinSalt:(profile=="kelly"?kellyPinSalt:shirleyPinSalt);const String& expected=profile=="jason"?jasonPinHash:(profile=="kelly"?kellyPinHash:shirleyPinHash);return constantTimeEqual(pinDigest(profile,pin,salt),expected);}')
subline('firmware/src/main.cpp', r'^static String pinAuthStatusJson\(\).*$',
        'static String pinAuthStatusJson(){JsonDocument d;String token=server.header(AUTH_HEADER);uint8_t role=pinProtectionEnabled?sessionRoleForToken(token,false):ROLE_NONE;String profile=role!=ROLE_NONE?sessionProfileForToken(token):String("");d["pinEnabled"]=pinProtectionEnabled;d["configured"]=pinAuthConfigured();d["kellyConfigured"]=kellyPinConfigured();d["pinLength"]=4;d["authenticated"]=role!=ROLE_NONE;if(role!=ROLE_NONE){d["role"]=role==ROLE_ADMIN?"admin":"user";d["name"]=profileDisplayName(profile);}String out;serializeJson(d,out);return out;}')
one('firmware/src/main.cpp', 'Choose Shirley or Jason', 'Choose Shirley, Kelly, or Jason')
one('firmware/src/main.cpp',
    '    if(!pinProtectionEnabled){JsonDocument out;out["ok"]=true;out["pinEnabled"]=false;out["role"]=role==ROLE_ADMIN?"admin":"user";out["name"]=profileDisplayName(profile);String json;serializeJson(out,json);sendJson(json);return;}\n    uint32_t retry=pinRetryAfter();',
    '    if(!pinProtectionEnabled){JsonDocument out;out["ok"]=true;out["pinEnabled"]=false;out["role"]=role==ROLE_ADMIN?"admin":"user";out["name"]=profileDisplayName(profile);String json;serializeJson(out,json);sendJson(json);return;}\n    if(profile=="kelly"&&!kellyPinConfigured()){server.send(409,"application/json","{\\"ok\\":false,\\"error\\":\\"Jason must configure Kelly\'s PIN in Settings before Kelly can sign in\\"}");return;}\n    uint32_t retry=pinRetryAfter();')
subline('firmware/src/main.cpp', r'^    String shirleyPin=d\["shirleyPin"\].*$',
        '    String shirleyPin=d["shirleyPin"]|String(""),kellyPin=d["kellyPin"]|String(""),jasonPin=d["jasonPin"]|String("");if(!fourDigitPin(shirleyPin)||!fourDigitPin(kellyPin)||!fourDigitPin(jasonPin)){server.send(400,"application/json","{\\"ok\\":false,\\"error\\":\\"All three PINs must contain exactly four digits\\"}");return;}if(shirleyPin==kellyPin||shirleyPin==jasonPin||kellyPin==jasonPin){server.send(400,"application/json","{\\"ok\\":false,\\"error\\":\\"Shirley, Kelly, and Jason must use three different PINs\\"}");return;}if(!configureProfilePins(shirleyPin,kellyPin,jasonPin)){server.send(500,"application/json","{\\"ok\\":false,\\"error\\":\\"PINs could not be saved and verified\\"}");return;}JsonDocument out;out["ok"]=true;out["pinEnabled"]=true;out["token"]=issueAuthSession(ROLE_ADMIN,"jason");String json;serializeJson(out,json);sendJson(json);')

# UI: third profile, same limited view as Shirley, separate PIN configuration.
one('firmware/web/index.html', '.profilePinGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}', '.profilePinGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}')
one('firmware/web/index.html', '.profileChoices{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}', '.profileChoices{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}')
one('firmware/web/index.html', 'body[data-profile="shirley"] .nav{grid-template-columns:repeat(3,1fr)}', 'body[data-profile="shirley"] .nav,body[data-profile="kelly"] .nav{grid-template-columns:repeat(3,1fr)}')
one('firmware/web/index.html',
    '      <button class="profileChoice" type="button" data-profile="shirley" disabled><span class="profileAvatar">S</span><span class="profileName">Shirley</span><span class="profileAccess">Home &amp; Events</span></button>\n      <button class="profileChoice" type="button" data-profile="jason" disabled>',
    '      <button class="profileChoice" type="button" data-profile="shirley" disabled><span class="profileAvatar">S</span><span class="profileName">Shirley</span><span class="profileAccess">Home &amp; Events</span></button>\n      <button class="profileChoice" type="button" data-profile="kelly" disabled><span class="profileAvatar">K</span><span class="profileName">Kelly</span><span class="profileAccess">Home &amp; Events</span></button>\n      <button class="profileChoice" type="button" data-profile="jason" disabled>')
one('firmware/web/index.html', "  let pinProtectionEnabled=false,pendingProfile='';", "  let pinProtectionEnabled=false,kellyPinReady=false,pendingProfile='';")
subblock('firmware/web/index.html', r"  async function loadPinStatus\(note=''\)\{.*?\n  \}\n  function showPinPrompt",
'''  async function loadPinStatus(note=''){
    const status=byId('profileGateStatus');document.querySelectorAll('.profileChoice').forEach(button=>button.disabled=true);
    try{const {response,text}=await controllerRequest('/api/auth/status?gate='+Date.now(),{cache:'no-store'});if(!response.ok)throw new Error('unavailable');const data=JSON.parse(text);pinProtectionEnabled=data.pinEnabled===true;kellyPinReady=data.kellyConfigured===true;status.textContent=note||(pinProtectionEnabled&&!kellyPinReady?'PIN protection is on. Jason must add Kelly’s PIN in Settings.':(pinProtectionEnabled?'Four-digit PIN protection is on.':'PIN protection is off. Jason can configure it in Settings.'));}
    catch(error){pinProtectionEnabled=location.protocol!=='file:';kellyPinReady=true;status.textContent=note||(pinProtectionEnabled?'PIN status could not be checked. You can retry the PIN.':'Preview mode — PIN protection is simulated as off.');}
    document.querySelectorAll('.profileChoice').forEach(button=>button.disabled=button.dataset.profile==='kelly'&&pinProtectionEnabled&&!kellyPinReady);
  }
  function showPinPrompt''')
subline('firmware/web/index.html', r'^  function showPinPrompt\(profile\).*$',
        "  function showPinPrompt(profile){pendingProfile=profile;const name=profile==='shirley'?'Shirley':(profile==='kelly'?'Kelly':'Jason');byId('profilePinTitle').textContent='Enter '+name+'’s four-digit PIN';byId('profilePin').value='';byId('profilePinError').textContent='';byId('profilePinForm').hidden=false;setTimeout(()=>byId('profilePin').focus(),0)}")
one('firmware/web/index.html',
    "    const limited=profile!=='jason'||(role&&role!=='admin'),name=profile==='shirley'?'Shirley':'Jason',allowed=limited?['home','events','favorites']:['home','lights','events','favorites','wifi','settings'];",
    "    const limited=profile!=='jason'||(role&&role!=='admin'),name=profile==='shirley'?'Shirley':(profile==='kelly'?'Kelly':'Jason'),allowed=limited?['home','events','favorites']:['home','lights','events','favorites','wifi','settings'];")
one('firmware/web/index.html',
    '<strong>Profile PINs</strong><div class="sub">Set a different four-digit PIN for Shirley and Jason.</div>',
    '<strong>Profile PINs</strong><div class="sub">Set a different four-digit PIN for Shirley, Kelly, and Jason. Existing Shirley/Jason protection stays active; Kelly remains unavailable until all three PINs are saved.</div>')
one('firmware/web/index.html',
    '<div><div class="label">Shirley PIN</div><input id="shirleyPinConfig" class="field" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="4 digits"><div class="label">Confirm Shirley PIN</div><input id="shirleyPinConfirm" class="field" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="Repeat 4 digits"></div><div><div class="label">Jason PIN</div>',
    '<div><div class="label">Shirley PIN</div><input id="shirleyPinConfig" class="field" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="4 digits"><div class="label">Confirm Shirley PIN</div><input id="shirleyPinConfirm" class="field" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="Repeat 4 digits"></div><div><div class="label">Kelly PIN</div><input id="kellyPinConfig" class="field" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="4 digits"><div class="label">Confirm Kelly PIN</div><input id="kellyPinConfirm" class="field" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="new-password" placeholder="Repeat 4 digits"></div><div><div class="label">Jason PIN</div>')
one('firmware/web/index.html', 'Save Both PINs &amp; Enable', 'Save All Three PINs &amp; Enable')
one('firmware/web/index.html', 'Both PINs must be different. They are stored as separate salted hashes in the NanoC6, not in this page or GitHub.', 'All three PINs must be different. They are stored as separate salted hashes in the NanoC6, not in this page or GitHub.')
one('firmware/web/index.html', "['shirleyPinConfig','shirleyPinConfirm','jasonPinConfig','jasonPinConfirm'].forEach(id=>$(id).addEventListener('input',scrubPinInput));", "['shirleyPinConfig','shirleyPinConfirm','kellyPinConfig','kellyPinConfirm','jasonPinConfig','jasonPinConfirm'].forEach(id=>$(id).addEventListener('input',scrubPinInput));")
subline('firmware/web/index.html', r'^async function loadPinSettings\(\).*$',
        '''async function loadPinSettings(){const meta=$('pinConfigMeta');try{const d=await api('/api/auth/status?settings='+Date.now());meta.innerHTML=d.pinEnabled?(d.kellyConfigured?'<strong>PIN protection is ON</strong><br><span class="sub">Each fresh page load requires that person’s own four-digit PIN.</span>':'<strong>PIN protection is ON for Shirley and Jason</strong><br><span class="sub">Enter all three PINs below to add Kelly securely.</span>'):'<strong>PIN protection is OFF</strong><br><span class="sub">Set all three PINs below when you are ready to turn it on.</span>';$('disablePinConfig').disabled=!d.pinEnabled;$('savePinConfig').textContent=d.pinEnabled?'Change All Three PINs & Keep Enabled':'Save All Three PINs & Enable'}catch(e){meta.textContent=API_MODE?'PIN status unavailable.':'Preview mode — PIN settings require the NanoC6.'}}''')
subline('firmware/web/index.html', r"^\$\('savePinConfig'\)\.addEventListener.*$",
        '''$('savePinConfig').addEventListener('click',async()=>{const shirleyPin=$('shirleyPinConfig').value,shirleyConfirm=$('shirleyPinConfirm').value,kellyPin=$('kellyPinConfig').value,kellyConfirm=$('kellyPinConfirm').value,jasonPin=$('jasonPinConfig').value,jasonConfirm=$('jasonPinConfirm').value,pins=[shirleyPin,kellyPin,jasonPin];if(pins.some(pin=>!/^\\d{4}$/.test(pin)))return status('All three profile PINs must contain exactly four digits.');if(shirleyPin!==shirleyConfirm||kellyPin!==kellyConfirm||jasonPin!==jasonConfirm)return status('Each confirmation must match its four-digit PIN.');if(new Set(pins).size!==3)return status('Shirley, Kelly, and Jason must use three different PINs.');$('savePinConfig').disabled=true;try{const d=await post('/api/auth/config',{enabled:true,shirleyPin,kellyPin,jasonPin});if(d.token)window.andersonAuthToken=d.token;['shirleyPinConfig','shirleyPinConfirm','kellyPinConfig','kellyPinConfirm','jasonPinConfig','jasonPinConfirm'].forEach(id=>$(id).value='');await loadPinSettings();status('All three four-digit PINs were saved and verified. PIN protection is now on.')}catch(e){status('PIN setup failed: '+e.message)}finally{$('savePinConfig').disabled=false}});''')
subline('firmware/web/index.html', r"^\$\('disablePinConfig'\)\.addEventListener.*$",
        '''$('disablePinConfig').addEventListener('click',async()=>{if(!confirm('Disable all three profile PINs? The user chooser and firmware recovery will remain available.'))return;$('disablePinConfig').disabled=true;try{await post('/api/auth/config',{enabled:false});window.andersonAuthToken='';status('PIN protection is off. All three saved PINs can be replaced whenever you re-enable it.')}catch(e){status('PIN protection could not be disabled: '+e.message)}finally{await loadPinSettings()}});''')

# Current Atelier theme: reserve a clock column so wrapping event names cannot overlap it.
subline('firmware/web/v3_mockup.css', r'^\.v3Next\{position:relative;.*$',
        '.v3Next{position:relative;align-self:stretch;background:none!important;border:0!important;border-left:1px solid #a8c4ff20!important;border-radius:0!important;padding:22px 24px;display:grid;grid-template-columns:20px minmax(0,1fr);column-gap:14px;row-gap:6px;align-content:center;min-width:0}')
subline('firmware/web/v3_mockup.css', r'^\.v3Next>strong\{.*$',
        '.v3Next>strong{grid-column:2;font-size:8px;text-transform:uppercase;letter-spacing:.12em;color:#a4bde7;font-weight:550;min-width:0}.v3NextIcon{position:static;grid-column:1;grid-row:1/3;align-self:start;margin-top:1px;color:#9bb8eb}.v3NextIcon .v3Icon{width:15px;height:15px}')
subline('firmware/web/v3_mockup.css', r'^#nextEvent\{.*$',
        '#nextEvent{grid-column:2;min-width:0;margin-top:0!important;color:#dbe7fc;font-size:12px;line-height:1.65;overflow-wrap:anywhere}')
subline('firmware/web/v3_mockup.css', r'^\.v3Next\{border-left:0!important;.*$',
        '.v3Next{border-left:0!important;border-top:1px solid #a8c4ff20!important;padding:17px 20px;grid-template-columns:19px minmax(0,1fr);column-gap:12px;row-gap:5px}.v3NextIcon{position:static;margin-top:1px}#nextEvent{font-size:11px}')
one('firmware/web/v3_mockup.css',
    '.profileChoices{display:grid;grid-template-columns:1fr 1fr;gap:14px;background:none;padding:0;border:0;box-shadow:none}',
    '.profileChoices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;background:none;padding:0;border:0;box-shadow:none}')

# Regression coverage.
p = ROOT / 'tools/test_regressions.py'
s = p.read_text()
anchor = "assert 'PinAttemptState pinAttempts[6]' in main\n"
insert = anchor + '''assert 'profile=="shirley"||profile=="kelly"' in main and 'kellyPinConfigured()' in main and 'd["kellyConfigured"]' in main\nassert 'data-profile="kelly"' in web and 'kellyPinConfig' in web and 'Kelly PIN' in web\nassert 'body[data-profile="shirley"] .nav,body[data-profile="kelly"] .nav' in web\nmock_css=t('firmware/web/v3_mockup.css')\nassert 'grid-template-columns:20px minmax(0,1fr)' in mock_css and '#nextEvent{grid-column:2;min-width:0;margin-top:0!important' in mock_css\nassert '.profileChoices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))' in mock_css\n'''
if s.count(anchor) != 1:
    raise SystemExit('tools/test_regressions.py: regression anchor mismatch')
p.write_text(s.replace(anchor, insert, 1))

(ROOT / 'firmware/RELEASE_NOTES_v3.1.29.md').write_text('''# Anderson Home v3.1.29\n\n- Restores Kelly as a third user with the same Home, Schedules, and Favorites access as Shirley.\n- Restores Kelly's independent four-digit PIN path while preserving existing Shirley/Jason PIN protection during migration.\n- Adds Kelly to the Users & Security PIN configuration without exposing Jason-only controls.\n- Reworks the home-page Next Scheduled Event card so its clock icon occupies a dedicated grid column and can no longer overlap event text on narrow screens.\n''')

# Final intent checks before committing anything.
main = (ROOT / 'firmware/src/main.cpp').read_text()
web = (ROOT / 'firmware/web/index.html').read_text()
css = (ROOT / 'firmware/web/v3_mockup.css').read_text()
assert 'ANDERSON_FIRMWARE_VERSION="3.1.29"' in main
assert 'profile=="shirley"||profile=="kelly"' in main
assert 'data-profile="kelly"' in web
assert "allowed=limited?['home','events','favorites']" in web
assert 'grid-template-columns:20px minmax(0,1fr)' in css
assert 'grid-template-columns:repeat(3,minmax(0,1fr))' in css
print('Anderson 3.1.29 source prepared')

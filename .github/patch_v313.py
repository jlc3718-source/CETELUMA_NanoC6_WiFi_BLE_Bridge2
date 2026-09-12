from pathlib import Path

js=Path('firmware/web/v3_mockup.js')
s=js.read_text()
a=s.index('  function effectPreviews() {')
b=s.index('  function settingsSubTabs() {',a)
fn=r'''  function effectPreviews() {
    const values=['Jump','Breath','Strobe','Solid'];
    const labels={Jump:'Jump',Breath:'Breath',Strobe:'Strobe',Solid:'Solid'};
    const hints={Jump:'Snaps between colors',Breath:'Gently fades in and out',Strobe:'Flashes on and off',Solid:'Holds one color steady'};
    const palette=['#42d8ff','#ff4ebd','#ffd24a','#7cff74','#7c72ff'];
    if(!byId('v3EffectPreviewStyle')) {
      const style=document.createElement('style');style.id='v3EffectPreviewStyle';style.textContent=`
.v3EffectNative{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;clip-path:inset(50%)!important}
.v3EffectPicker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:9px 0 4px;min-width:0}
.v3EffectButton{min-width:0;min-height:66px;padding:7px 5px 6px;border:1px solid #79bde644;border-radius:12px;background:linear-gradient(155deg,#122943d9,#071426f2);color:#dceeff;box-shadow:inset 0 1px 0 #eaf8ff14,0 4px 12px #0003;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;transition:border-color .18s,background .18s,box-shadow .18s,transform .12s}
.v3EffectButton:active{transform:scale(.97)}.v3EffectButton[aria-pressed="true"]{border-color:#79e9ff;background:radial-gradient(ellipse at 50% 0,#35cfff38,transparent 72%),linear-gradient(145deg,#164c78e8,#08213bea);box-shadow:inset 0 1px 0 #e8fbff38,0 0 0 1px #22cfff33,0 0 16px #08a9ff28}
.v3EffectMini{width:100%;max-width:66px;min-height:20px;display:grid;grid-template-columns:repeat(5,1fr);align-items:center;gap:3px;padding:5px 6px;border-radius:99px;background:#020914c9;border:1px solid #8fdfff26;overflow:hidden}
.v3EffectMini i{display:block;width:100%;aspect-ratio:1;border-radius:50%;background:#42d8ff;box-shadow:0 0 7px currentColor;color:#42d8ff;will-change:opacity,transform,filter}
.v3EffectName{font-size:10px;font-weight:720;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.v3EffectCard .v3EffectPicker{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin-top:7px}.v3EffectCard .v3EffectButton{min-height:58px;padding:5px 3px;gap:4px}.v3EffectCard .v3EffectMini{max-width:56px;min-height:19px;padding:4px}.v3EffectCard .v3EffectName{font-size:9px}
@media(max-width:520px){.v3EffectPicker,.page:not([data-page="home"]) .v3EffectPicker,.v3EffectCard .v3EffectPicker{grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}.v3EffectButton,.page:not([data-page="home"]) .v3EffectButton{min-height:58px;padding:5px 3px}.v3EffectMini{padding:4px;gap:2px}.v3EffectName{font-size:9px}}
`;document.head.appendChild(style);
    }
    const paintButton=(button,now)=>{
      const dots=qa('i',button);if(!dots.length)return;
      const effect=button.dataset.effect;
      dots.forEach((dot,i)=>{dot.style.background=palette[i];dot.style.color=palette[i];dot.style.opacity='1';dot.style.transform='scale(1)';dot.style.filter='none'});
      if(effect==='Jump'){
        const active=Math.floor(now/360)%dots.length;
        dots.forEach((dot,i)=>{const on=i===active;dot.style.opacity=on?'1':'.18';dot.style.transform=on?'scale(1.18)':'scale(.72)';dot.style.filter=on?'brightness(1.45)':'brightness(.65)'});
      }else if(effect==='Breath'){
        const wave=.22+.78*((Math.sin(now/430)+1)/2);
        dots.forEach(dot=>{dot.style.background='#45d9ff';dot.style.color='#45d9ff';dot.style.opacity=String(wave);dot.style.transform=`scale(${.78+wave*.24})`;dot.style.filter=`brightness(${.65+wave*.7})`});
      }else if(effect==='Strobe'){
        const on=Math.floor(now/240)%2===0;
        dots.forEach(dot=>{dot.style.background='#f3fbff';dot.style.color='#f3fbff';dot.style.opacity=on?'1':'.07';dot.style.transform=on?'scale(1.12)':'scale(.78)';dot.style.filter=on?'brightness(1.6)':'brightness(.5)'});
      }else{
        dots.forEach(dot=>{dot.style.background='#45d9ff';dot.style.color='#45d9ff';dot.style.opacity='1';dot.style.transform='scale(1)';dot.style.filter='brightness(1.15)'});
      }
    };
    const animate=now=>{qa('.v3EffectButton').forEach(button=>paintButton(button,now));requestAnimationFrame(animate)};
    const sync=select=>{
      const picker=select.nextElementSibling?.classList.contains('v3EffectPicker')?select.nextElementSibling:null;if(!picker)return;
      qa('.v3EffectButton',picker).forEach(button=>{const active=button.dataset.effect===select.value;button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active)});
    };
    const enhance=select=>{
      if(!(select instanceof HTMLSelectElement)||select.dataset.v3EffectPreview==='1')return;
      const options=[...select.options].map(o=>o.value);if(!values.every(v=>options.includes(v)))return;
      select.dataset.v3EffectPreview='1';select.classList.add('v3EffectNative');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
      const picker=el('div','v3EffectPicker');picker.setAttribute('role','group');picker.setAttribute('aria-label',select.getAttribute('aria-label')||'Effect type');
      values.forEach(value=>{const button=el('button','v3EffectButton',`<span class="v3EffectMini" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="v3EffectName">${labels[value]}</span>`);button.type='button';button.dataset.effect=value;button.title=hints[value];button.setAttribute('aria-label',`${value==='Solid'?'Solid / Static':value}: ${hints[value]}`);button.addEventListener('click',()=>{if(select.value!==value){select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}))}sync(select)});picker.appendChild(button)});
      select.insertAdjacentElement('afterend',picker);select.addEventListener('change',()=>sync(select));sync(select);
    };
    const scan=root=>{if(root instanceof HTMLSelectElement)enhance(root);qa('select',root instanceof Element?root:document).forEach(enhance)};
    scan(document);
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node instanceof Element)scan(node)}))).observe(document.body,{childList:true,subtree:true});
    requestAnimationFrame(animate);
  }
'''
js.write_text(s[:a]+fn+s[b:])

css=Path('firmware/web/v3_mockup.css')
t=css.read_text()
marker='/* ANDERSON_MOBILE_V3_1_3'
if marker in t: raise SystemExit('mobile layer already present')
mobile=r'''

/* ANDERSON_MOBILE_V3_1_3 — compact phone layout across every screen. */
@media(max-width:600px){
html{scroll-padding-bottom:96px}body{font-size:15px}.wrap{padding:0 9px calc(98px + env(safe-area-inset-bottom))}.header{width:calc(100% - 18px);top:max(7px,env(safe-area-inset-top))}.headerActions{gap:6px}.v3HomeMeta{max-width:45vw}.v3HomeName{font-size:12px}#connectionBadge{font-size:10px}.v3ProfileName{font-size:11px;top:8px}.switchProfile{min-width:38px;min-height:38px;padding:8px}
.panel,.card{padding:12px;border-radius:16px;margin:9px 0}.panel>strong,.v3SavedScenes>strong{font-size:16px}.sub,.small,.note{font-size:12px}.label{font-size:13px;margin:11px 0 6px}.btn,.field{min-height:42px;border-radius:11px;padding:8px;font-size:14px}.field{width:100%;min-width:0}
.v3Dashboard.panel{padding:13px;border-radius:20px;margin-top:-2px}.v3MasterRow{grid-template-columns:1fr;gap:9px}.v3MasterTitle h2{font-size:26px;margin:3px 0}.v3Eyebrow{font-size:9px}.v3PowerButtons{grid-template-columns:1fr 1fr;gap:8px}#homePowerOn,#homePowerOff{min-height:56px;border-radius:15px;font-size:17px}#homePowerOn .v3Icon,#homePowerOff .v3Icon{width:25px;height:25px}.v3BrightnessBlock{margin-top:12px;padding:10px 12px 15px}.v3BrightnessBlock .label{margin:0 0 10px;font-size:13px}
.v3FeatureGrid{grid-template-columns:1fr;gap:8px;margin-top:9px}.v3EffectCard,.v3LiveCard{padding:10px;border-radius:15px}.v3CardKicker{font-size:12px}.v3LiveCard .housePreview{min-height:98px;margin:6px 0}.v3LiveCaption{font-size:11px}.v3ScheduleCard{grid-template-columns:1fr;gap:5px;padding:9px 10px 11px;margin-top:8px}.v3ScheduleCard .v3CardKicker,.v3ScheduleCard #nowTheme,.v3ScheduleCard #scheduleWindow,#resumeSchedule{grid-column:1;grid-row:auto}.v3ScheduleCard #nowTheme{font-size:14px}.v3ScheduleCard #scheduleWindow{font-size:11px}#resumeSchedule{width:100%;max-width:none;margin-top:4px;min-height:36px}
.v3HomeTiles{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:9px}.v3HomeTile{padding:10px 8px;border-radius:14px}.v3HomeTile>.v3Icon:first-child{width:24px;height:24px;margin-bottom:4px}.v3HomeTile strong{font-size:12px}.v3HomeTile small{font-size:10px}.v3Next{padding:10px 10px 10px 42px;margin:9px 0}.v3NextIcon{left:12px;top:13px}
.page:not([data-page=home]){padding-top:62px}.v3PageTitle{padding:14px 2px 5px}.v3PageTitle>span{font-size:11px}.v3PageTitle h2{font-size:27px;margin:2px 0 9px}.v3PageTitle:after{width:54px}.v3SettingsLink{min-height:66px;padding:13px;gap:11px;border-radius:16px;margin:9px 0}.v3SettingsLink strong{font-size:16px}.v3SettingsLink small{font-size:11px}.v3SettingsLink>.v3Icon:first-child{width:25px;height:25px}.v3SettingsTabs{top:4px;gap:6px;margin:0 -1px 10px;padding:5px 1px 7px}.v3SettingsTab{min-height:36px;padding:7px 10px;font-size:11px}
.grid2,.grid3,.monthHead,.colorActions{grid-template-columns:1fr!important}.monthActions{grid-template-columns:1fr 1fr;gap:6px}.profilePinGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.event{grid-template-columns:1fr!important;gap:7px}.event>.row:last-child,.event>.customPresetActions:last-child,.event .previewEvent{grid-column:1!important}.eventchecks{display:flex!important;flex-direction:row!important;flex-wrap:wrap;min-width:0!important;gap:10px!important}.eventchecks .small{font-size:11px}.event .sub{font-size:11px}.customPresetActions{gap:5px}.customPresetActions .btn{flex:1 1 auto;min-width:0}
.colorSlot{grid-template-columns:40px minmax(0,1fr) 38px 38px;gap:5px}.colorSlot input[type=color]{width:40px;height:40px}.colorSlot .moveBtn,.colorSlot .removeBtn{min-width:38px;padding:6px}.savedColorGrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.savedSwatch{min-height:42px;padding:6px;font-size:11px}
.favoriteGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important}.page[data-page=favorites] .favoriteGrid .card,.v3SavedScenes .favoriteGrid .card{padding:7px!important;border-radius:12px}.page[data-page=favorites] .favoriteGrid .row,.v3SavedScenes .favoriteGrid .row{gap:4px}.page[data-page=favorites] .favoriteGrid .btn,.v3SavedScenes .favoriteGrid .btn{min-height:36px;padding:7px 6px;font-size:11px;line-height:1.2}.page[data-page=favorites] .favoriteGrid label,.v3SavedScenes .favoriteGrid label{font-size:0;gap:0}.page[data-page=favorites] .favoriteGrid input[type=checkbox],.v3SavedScenes .favoriteGrid input[type=checkbox]{width:17px;height:17px;flex:0 0 17px}.v3SavedScenes{padding:10px}.v3SavedScenes .favoriteGrid{margin-top:7px}
.profileGate{padding:0 10px max(24px,env(safe-area-inset-bottom))}.profileChoices{grid-template-columns:1fr!important;gap:8px}.profileChoice{min-height:104px;display:grid;grid-template-columns:48px 1fr auto;grid-template-rows:auto auto;align-items:center;text-align:left;padding:12px;border-radius:17px}.profileAvatar{grid-row:1/3;width:48px;height:48px;margin:0 12px 0 0;font-size:20px}.profileName{font-size:18px}.profileAccess{font-size:11px;margin-top:1px}.profileChoice>.v3Icon{position:static;grid-column:3;grid-row:1/3}.profileGateStatus{font-size:11px;margin-top:12px}.pinPanel{margin-top:10px;padding:14px;border-radius:17px}.pinDigits{font-size:22px;min-height:48px}
.rgbPickerOverlay,.scheduleOverlay{padding:8px}.rgbPickerCard,.scheduleCard{width:calc(100vw - 16px);max-height:94vh;padding:12px;border-radius:17px}.rgbReadout{gap:5px}.rgbReadout input,.rgbHex{padding:7px}.rgbWheel{width:min(74vw,250px);height:min(74vw,250px)}.sysToolbar{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.sysMetric{padding:8px 5px}.bleDevice{grid-template-columns:minmax(0,1fr) auto;gap:5px}.bleDevice .btn{padding:7px}
.v3BottomNav.nav{bottom:max(6px,env(safe-area-inset-bottom));width:calc(100% - 14px);padding:4px 5px}.v3BottomNav .tab{min-height:50px;font-size:10px;padding:5px 1px 7px}.v3BottomNav .tab .v3Icon{width:20px;height:20px}body[data-profile=shirley] .v3BottomNav{width:calc(100% - 28px)}
}
@media(max-width:370px){.wrap{padding-left:7px;padding-right:7px}.panel,.card{padding:10px}.v3Dashboard.panel{padding:11px}.v3MasterTitle h2{font-size:23px}#homePowerOn,#homePowerOff{font-size:15px;min-height:52px}.v3EffectButton{min-width:0!important;padding-left:2px!important;padding-right:2px!important}.v3EffectName{font-size:8px!important}.v3EffectMini{padding:3px!important;gap:1px!important}.favoriteGrid{gap:5px!important}.page[data-page=favorites] .favoriteGrid .btn,.v3SavedScenes .favoriteGrid .btn{font-size:10px;padding:6px 4px}.v3BottomNav .tab{font-size:9px}}
'''
css.write_text(t+mobile)

v=Path('FIRMWARE_VERSION.txt')
if v.read_text().strip()!='3.1.2': raise SystemExit('expected v3.1.2 baseline')
v.write_text('3.1.3\n')
r=Path('README.md');x=r.read_text();r.write_text(x.replace('**v3.1.2**','**v3.1.3**'))

assert 'requestAnimationFrame(animate)' in js.read_text()
assert 'ANDERSON_MOBILE_V3_1_3' in css.read_text()
assert '.profileChoices{grid-template-columns:1fr!important' in css.read_text()
assert '.favoriteGrid{grid-template-columns:repeat(2,minmax(0,1fr))!important' in css.read_text()

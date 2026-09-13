/* ANDERSON_V4_HOME_RECOVERY
   Keep Jason's emergency APP-flash controls visible near the top of Home. */
(() => {
  'use strict';
  const byId=id=>document.getElementById(id);
  function syncVisibility(){
    const panel=byId('emergencyFirmwarePanel');
    if(panel)panel.hidden=!window.andersonProfile||window.andersonProfile.role!=='admin';
  }
  function placeRecovery(){
    const home=document.querySelector('.page[data-page="home"]');
    const panel=byId('emergencyFirmwarePanel');
    if(!home||!panel)return;
    const dashboard=home.querySelector('.v3Dashboard');
    if(dashboard&&dashboard.nextElementSibling!==panel)dashboard.insertAdjacentElement('afterend',panel);
    panel.dataset.v4HomeRecovery='true';
    const title=panel.querySelector(':scope > strong');if(title)title.textContent='Emergency Firmware Recovery';
    const file=byId('emergencyFirmwareFile');if(file)file.classList.add('field');
    const flash=byId('emergencyFirmwareFlash');if(flash)flash.classList.add('btn','danger');
    if(!byId('emergencyRecoveryActions')){
      const actions=document.createElement('div');actions.id='emergencyRecoveryActions';actions.className='grid2';actions.style.marginTop='10px';
      const previous=document.createElement('button');previous.id='emergencyBootPrevious';previous.type='button';previous.className='btn';previous.textContent='Boot Previous Firmware';
      const full=document.createElement('button');full.id='emergencyOpenFirmwareTools';full.type='button';full.className='btn';full.textContent='Open Full Firmware Tools';
      previous.addEventListener('click',()=>byId('rollbackFirmware')?.click());
      full.addEventListener('click',()=>{document.querySelector('.tab[data-tab="settings"]')?.click();setTimeout(()=>{if(typeof window.andersonActivateSettingsTab==='function')window.andersonActivateSettingsTab('firmware');byId('firmwareFile')?.scrollIntoView({behavior:'smooth',block:'center'});},60);});
      actions.append(previous,full);
      const progress=byId('emergencyFirmwareProgress');panel.insertBefore(actions,progress||null);
    }
    syncVisibility();
  }
  function start(){setTimeout(placeRecovery,0);setTimeout(placeRecovery,150);}
  window.addEventListener('anderson-profile-selected',()=>{placeRecovery();syncVisibility();});
  window.addEventListener('anderson-profile-cleared',syncVisibility);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();

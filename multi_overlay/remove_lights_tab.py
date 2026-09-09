from pathlib import Path
import sys

# Anderson Home v1.0.4: remove the Lights navigation tab while keeping its backend features intact.
p=Path(sys.argv[1])
s=p.read_text()
marker='ANDERSON_REMOVE_LIGHTS_TAB'
if marker not in s:
    patch=r'''
<style>
/* ANDERSON_REMOVE_LIGHTS_TAB */
[data-tab="lights"],[data-page="lights"],[href="#lights"],#tabLights,#lightsTab{display:none!important;}
</style>
<script>
/* ANDERSON_REMOVE_LIGHTS_TAB */
(function(){
  function removeLightsTab(){
    document.querySelectorAll('button,a,[role="tab"]').forEach(function(el){
      var txt=(el.textContent||'').trim().toLowerCase();
      var cls=(typeof el.className==='string'?el.className:'').toLowerCase();
      var tab=(el.getAttribute('data-tab')||'').toLowerCase();
      var href=(el.getAttribute('href')||'').toLowerCase();
      var inNav=!!el.closest('nav,.tabs,.tabbar,.nav,.bottom-nav,.top-nav');
      if(tab==='lights'||href==='#lights'||(txt==='lights'&&(inNav||cls.indexOf('tab')>=0))){el.remove();}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',removeLightsTab);
  else removeLightsTab();
  setTimeout(removeLightsTab,250);
})();
</script>
'''
    if '</body>' in s:
        s=s.replace('</body>',patch+'\n</body>',1)
    else:
        s+=patch
p.write_text(s)
print('Removed Lights navigation tab')

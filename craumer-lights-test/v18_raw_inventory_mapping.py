from pathlib import Path
import re

root = Path('build_source/Craumer_Lights_Eufy_Test_v2')

# Front-end: make the APK honest about what this build does, display raw inventory,
# and actually map returned light candidates into the four UI slots.
for rel in ['web/index.html', 'android/app/src/main/assets/index.html']:
    p = root / rel
    t = p.read_text()
    for label in ['TEST v17', 'TEST v16', 'TEST v15', 'TEST v14', 'TEST v13', 'TEST v12', 'TEST v11', 'TEST v10', 'TEST v9', 'TEST v8', 'TEST v7', 'TEST v6']:
        t = t.replace(label, 'TEST v18 RAW INVENTORY')
    t = t.replace('Eufy Connection Test v6', 'Raw Eufy Inventory Diagnostic')
    t = t.replace(
        'Sign in once to discover the four Craumer light systems.',
        'Sign in and dump every device record the Eufy service returns so we can map the four Craumer light systems correctly.'
    )
    t = t.replace('No diagnostic run yet.', 'No raw inventory diagnostic run yet.')
    t = t.replace(
        'Signing into Eufy and scanning all Tuya homes, groups and shared-device routes…',
        'Signing into Eufy and collecting raw device inventory. This may take up to 75 seconds…'
    )
    t = t.replace(
        'This test checks three things: eufy account authentication, whether T8L00/T8L02 devices are returned by the eufy service, and whether each device exposes the older local Eufy TCP service on port 55556.',
        'This raw diagnostic shows every device-like record returned by the Eufy cloud probes, even when the model name does not match T8L00/T8L02. Send a screenshot of the RAW lines if the four light slots still do not map.'
    )
    t = t.replace('Tuya/Eufy smart devices found:', 'Returned Eufy/Tuya device candidates:')
    t = t.replace('No Tuya-linked smart devices were returned.', 'No mapped Eufy/Tuya device candidates were returned. Check the RAW lines below; those are now printed even when the app cannot recognize the model yet.')

    old = """    $('eufyDiag').textContent=lines.join('\\n');

    // v5 intentionally lists every Tuya-linked device first. We will map the
    // four permanent-light controllers after we see their product IDs/names.
    status(`Eufy test finished — ${devices.length} Craumer light system(s) found.`);"""
    new = """    $('eufyDiag').textContent=lines.join('\\n');

    localStorage.setItem('craumerRawEufyDevices', JSON.stringify(devices));
    applyDiscoveredDevices(devices);
    refreshTargetOptions();
    renderDevices();
    updateTargetCapability();

    status(`Raw Eufy inventory finished — ${devices.length} returned device(s), ${craumerDevices.filter(d=>d.discovered).length} mapped slot(s).`);"""
    if old in t:
        t = t.replace(old, new, 1)
    elif 'Raw Eufy inventory finished' not in t:
        raise SystemExit(f'v18 frontend status anchor missing in {rel}')

    t = t.replace(
        '<span class="badge offline">${hasNativeBridge()?\'● Checking\':\'● Preview\'}</span>',
        '<span class="${d.discovered?\'badge\':\'badge offline\'}">${d.discovered?\'● Cloud found\':(hasNativeBridge()?\'● Not mapped\':\'● Preview\')}</span>'
    )
    t = t.replace(
        '<div><div class="small"><strong>${d.name}</strong></div><div class="sub">${d.family} • ${d.model} • ${d.white}</div></div>',
        '<div><div class="small"><strong>${d.name}</strong></div><div class="sub">${d.family} • ${d.model} • ${d.white}</div><div class="sub">${d.nativeId?`Mapped ID: ${d.nativeId}`:\'No Eufy device mapped yet\'}${d.source?` • ${d.source}`:\'\'}</div></div>'
    )

    enhanced = r'''function applyDiscoveredDevices(devices){
  craumerDevices.forEach(d=>{
    d.discovered=false;
    d.nativeId='';
    d.source='';
    d.ip='';
    d.port55556=undefined;
    d.hasLocalKey=false;
  });
  devices.forEach((found)=>{
    const model=String(found.model||found.productId||found.product_code||found.productCode||'').toUpperCase();
    const name=String(found.name||found.alias_name||found.device_name||found.deviceName||'');
    const text=(model+' '+name+' '+String(found.category||'')).toUpperCase();
    let candidate=null;
    if(text.includes('T8L00') || text.includes('E120')) candidate=craumerDevices.find(d=>d.model==='T8L00' && !d.discovered);
    if(text.includes('T8L02') || text.includes('E22')) candidate=craumerDevices.find(d=>d.model==='T8L02' && !d.discovered);
    if(!candidate) return;
    candidate.discovered=true;
    candidate.name=name||candidate.name;
    candidate.ip=found.ip||found.localIp||'';
    candidate.port55556=found.port55556;
    candidate.nativeId=found.id||found.deviceId||found.device_id||'';
    candidate.source=found.source||'Eufy cloud';
    candidate.hasLocalKey=!!found.hasLocalKey;
  });
  const mapped={};
  craumerDevices.forEach(d=>{ if(d.discovered) mapped[d.id]={discovered:d.discovered,nativeId:d.nativeId,source:d.source,ip:d.ip,port55556:d.port55556,hasLocalKey:d.hasLocalKey,name:d.name}; });
  localStorage.setItem('craumerMappedDevices', JSON.stringify(mapped));
}

'''
    t, n = re.subn(r"function applyDiscoveredDevices\(devices\)\{.*?\n\}\n\n(?=(// Saved login restore\n)?if\(\$\('eufyConnect'\)\)|// Saved login restore)", enhanced, t, count=1, flags=re.S)
    if n != 1:
        raise SystemExit(f'v18 applyDiscoveredDevices anchor missing in {rel}')

    p.write_text(t)

# Back-end: make the Mega probe print raw summaries for every device-like object,
# not just objects matching our guessed T8L00/T8L02 identities.
p = root / 'android/app/src/main/java/com/craumer/lights/testv6/MainActivity.kt'
s = p.read_text()
old = r'''                var deviceish = 0
                for (obj in objects) {
                    val id = firstNonBlank(obj.optString("id"), obj.optString("device_id"), obj.optString("deviceId"), obj.optString("station_sn"), obj.optString("device_sn"), obj.optString("sn"))
                    val model = firstNonBlank(obj.optString("product_code"), obj.optString("productCode"), obj.optString("model"), obj.optString("device_model"), obj.optString("deviceModel"))
                    val name = firstNonBlank(obj.optString("alias_name"), obj.optString("name"), obj.optString("device_name"), obj.optString("nickname"))
                    if (id.isNotBlank() || model.isNotBlank() || name.isNotBlank()) deviceish++
                }
                out += "$label OK records=$deviceish identity hits=${if (hits.isEmpty()) "none" else hits.joinToString(",")}"'''
new = r'''                var deviceish = 0
                val rawSamples = mutableListOf<String>()
                for (obj in objects) {
                    val id = firstNonBlank(obj.optString("id"), obj.optString("device_id"), obj.optString("deviceId"), obj.optString("station_sn"), obj.optString("device_sn"), obj.optString("deviceSn"), obj.optString("sn"))
                    val model = firstNonBlank(obj.optString("product_code"), obj.optString("productCode"), obj.optString("model"), obj.optString("device_model"), obj.optString("deviceModel"), obj.optString("product_id"), obj.optString("productId"))
                    val name = firstNonBlank(obj.optString("alias_name"), obj.optString("name"), obj.optString("device_name"), obj.optString("deviceName"), obj.optString("nickname"))
                    val productName = firstNonBlank(obj.optString("product_name"), obj.optString("productName"), obj.optString("display_name"), obj.optString("displayName"))
                    val ip = firstNonBlank(obj.optString("ip"), obj.optString("local_ip"), obj.optString("localIp"), obj.optString("lan_ip"), obj.optString("lanIp"))
                    val home = firstNonBlank(obj.optString("home_id"), obj.optString("homeId"), obj.optString("house_id"), obj.optString("houseId"))
                    val room = firstNonBlank(obj.optString("room_id"), obj.optString("roomId"), obj.optString("room_name"), obj.optString("roomName"))
                    val localKey = listOf("local_code", "localKey", "local_key", "device_key", "deviceKey").any { obj.optString(it).isNotBlank() }
                    if (id.isNotBlank() || model.isNotBlank() || name.isNotBlank() || productName.isNotBlank() || ip.isNotBlank()) {
                        deviceish++
                        if (rawSamples.size < 20) {
                            val keyNames = mutableListOf<String>()
                            val itKeys = obj.keys()
                            while (itKeys.hasNext() && keyNames.size < 18) keyNames += itKeys.next()
                            val compactRaw = obj.toString().replace("\n", " ").take(650)
                            rawSamples += "#$deviceish name=${if (name.isBlank()) "?" else name} id=${if (id.isBlank()) "?" else id} model=${if (model.isBlank()) "?" else model} productName=${if (productName.isBlank()) "?" else productName} ip=${if (ip.isBlank()) "?" else ip} home=${if (home.isBlank()) "?" else home} room=${if (room.isBlank()) "?" else room} localKey=${if (localKey) "YES" else "no"} keys=${keyNames.joinToString("|")} raw=$compactRaw"
                        }
                    }
                }
                out += "$label OK records=$deviceish identity hits=${if (hits.isEmpty()) "none" else hits.joinToString(",")}" 
                rawSamples.forEach { out += "$label RAW $it" }'''
if old not in s:
    raise SystemExit('v18 Kotlin raw inventory anchor missing')
s = s.replace(old, new, 1)
p.write_text(s)
print('Applied v18 raw Eufy inventory diagnostics and automatic slot mapping')

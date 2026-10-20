#!/usr/bin/env python3
"""Only install signed Jason Home 2 Nano v1.1.62 on an idle authenticated 1.1.61 Nano.
Preserve NVS, factory updater, Oracle, BLE controller and all live assets.
"""
import json,time,subprocess,urllib.request,hashlib,os
info=json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]
env=dict(x.split('=',1) for x in info['Config']['Env'] if '=' in x)
base='http://127.0.0.1:8081'
def api(path,body=None,cookie=''):
    data=json.dumps(body).encode() if body is not None else None
    headers={'Content-Type':'application/json'}
    if cookie:headers['Cookie']=cookie
    req=urllib.request.Request(base+path,data=data,headers=headers,method='POST' if data is not None else 'GET')
    with urllib.request.urlopen(req,timeout=20) as res:return json.load(res),res.headers
# OTA is only permitted when the exact signed v1.1.62 channel is staged.
# An installation already at 1.1.62 exits without changing the Nano.
for waiting in range(60):
    signed,_=api('/api/curtain/firmware-manifest')
    if 'version=1.1.62\n' in signed.get('payload',''):break
    if waiting%6==0:print('WAITING_FOR_VERIFIED_SIGNED_161_BUILD',flush=True)
    time.sleep(5)
assert signed.get('schema')==1 and signed.get('signature')
manifest=dict(x.split('=',1) for x in signed['payload'].strip().splitlines())
assert manifest.get('version')=='1.1.62' and manifest.get('commit')==os.environ['GITHUB_SHA'], 'Signed version changed; no OTA'
with urllib.request.urlopen(base+'/api/curtain/firmware-runtime/1.1.62.bin',timeout=90) as res:
    digest=hashlib.sha256();total=0
    while True:
        d=res.read(65536)
        if not d:break
        digest.update(d);total+=len(d)
assert total==int(manifest['bytes']) and digest.hexdigest()==manifest['sha256']
print('SIGNED_IMAGE_VERIFIED',total,digest.hexdigest(),flush=True)
_,h=api('/api/session',{'token':env['JASON_HOME_API_TOKEN']})
cookie=h.get('Set-Cookie','').split(';')[0]
assert cookie.startswith('jh2=')
s,_=api('/api/curtain/status',cookie=cookie)
print('PRE_INSTALL',{'fw':s.get('firmware'),'online':s.get('online'),'queue':s.get('queued'),'ble':(s.get('curtain') or {}).get('connected')},flush=True)
if s.get('firmware')=='1.1.62':
    print('ALREADY_INSTALLED_NO_REPEAT',flush=True);raise SystemExit(0)
assert s.get('firmware')=='1.1.61' and s.get('online') is True, 'Physical preconditions have changed; abort OTA'
assert (s.get('curtain') or {}).get('connected') is True,'BLE disconnected; preserving firmware' 
assert s.get('relayStreaming') is not True,'Streaming active; do not reboot Nano'
for _ in range(60):
    if int(s.get('queued') or 0)==0:break
    time.sleep(1)
    s,_=api('/api/curtain/status',cookie=cookie)
assert int(s.get('queued') or 0)==0, 'Queued operations never drained; no OTA'
request,_=api('/api/curtain/call',{'action':'nanoFirmwareCheck','payload':{},'idempotencyKey':'jh2-162-20261020-status-repair-preflight'},cookie=cookie)
cid=int(request['commandId']);accepted=False
for _ in range(100):
    r,_=api('/api/curtain/command?id='+str(cid),cookie=cookie);c=r['command']
    if c.get('state') in ('applied','failed','expired','superseded'):
        print('DEVICE_SIGNATURE_PREFLIGHT',{'id':cid,'state':c.get('state'),'result':c.get('result')},flush=True)
        accepted=c.get('state')=='applied'
        break
    time.sleep(.6)
assert accepted, 'Nano declined signed image; no OTA'
request,_=api('/api/curtain/call',{'action':'nanoInstallUpdate','payload':{},'idempotencyKey':'jh2-162-20261020-status-repair-install-once'},cookie=cookie)
cid=int(request['commandId']);print('OTA_INSTALL_COMMAND',cid,flush=True)
accepted=False
for _ in range(150):
    r,_=api('/api/curtain/command?id='+str(cid),cookie=cookie);c=r['command']
    if c.get('state') in ('applied','failed','expired','superseded'):
        print('OTA_INSTALL_ACK',json.dumps({'id':cid,'state':c.get('state'),'result':c.get('result')},sort_keys=True),flush=True)
        accepted=c.get('state')=='applied'
        break
    time.sleep(.6)
assert accepted, 'Nano did not accept signed updater; do not retry automatically'
for i in range(110):
    time.sleep(3)
    s,_=api('/api/curtain/status',cookie=cookie)
    if s.get('firmware')=='1.1.62' and s.get('online') is True:
        c=s.get('curtain') or {}
        print('OTA_1_1_62_PHYSICAL_HEARTBEAT',json.dumps({'firmware':s.get('firmware'),'online':s.get('online'),'uptime':s.get('uptimeSeconds'),'bleConnected':c.get('connected'),'mtu':c.get('mtu'),'catalogUnique':c.get('nativeCatalogUnique'),'nativeTarget83928Count':c.get('nativeTarget83928Count'),'nativeDiscoveredDevicesCount':len(c.get('nativeDiscoveredDevices') or [])},sort_keys=True),flush=True)
        raise SystemExit(0)
    if i%10==0:print('OTA_WAITING',{'fw':s.get('firmware'),'online':s.get('online'),'elapsedSeconds':i*3},flush=True)
raise RuntimeError('OTA accepted but Nano v1.1.62 heartbeat not confirmed; manual recovery required before any repeat')

"""One-time secured Oracle-only Eufy account import and guarded Pool BLE ON probe.
Encrypted user identity decrypted only inside Oracle, not logged or committed.
"""
import base64,hashlib,json,os,subprocess,time,urllib.error,urllib.request
from pathlib import Path
root=Path('/root/.jh2-eufy-local-private-import')
private=root/'identity-onetime.key'
payload=Path('.github/private-import/eufy-account-20261109.enc.json')
assert private.is_file() and private.stat().st_mode & 0o077==0,"One-time private key missing or permissions insecure"
pkt=json.loads(payload.read_text())
assert pkt.get('schema')=='jh2-eufy-local-identity-rsa-oaep-sha256-v1'
cipher=base64.b64decode(pkt['encryptedAccountId'],validate=True)
assert len(cipher)==256 and len(pkt['fingerprintSha256'])==64
try:
 proc=subprocess.run(['openssl','pkeyutl','-decrypt','-inkey',str(private),
   '-pkeyopt','rsa_padding_mode:oaep','-pkeyopt','rsa_oaep_md:sha256',
   '-pkeyopt','rsa_mgf1_md:sha256'],input=cipher,stdout=subprocess.PIPE,
   stderr=subprocess.DEVNULL,check=True)
 identifier=proc.stdout
 assert len(identifier)==40 and all(33<=x<=126 for x in identifier)
 assert hashlib.sha256(identifier).hexdigest()==pkt['fingerprintSha256']
 d=json.loads(subprocess.check_output(['docker','inspect','jason-home-2-web'],text=True))[0]
 env=dict(v.split('=',1) for v in d['Config']['Env'] if '=' in v)
 token=env['JH2_UPSTREAM_TOKEN']
 def req(path,body=None):
  h={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
  r=urllib.request.Request('http://127.0.0.1:8081'+path,
     data=json.dumps(body).encode() if body is not None else None,
     headers=h,method='POST' if body is not None else 'GET')
  try:
   with urllib.request.urlopen(r,timeout=25) as response:return json.load(response)
  except urllib.error.HTTPError as err:
   raise RuntimeError('Local Eufy endpoint returned '+str(err.code)+': '+
      err.read(150).decode('utf8','replace')) from None
 st=req('/api/eufy/local-ble/status')
 assert st.get('nanoOnline') is True and st.get('nanoFirmware')=='2.0.15'
 assert (st.get('transport') or {}).get('supported') is True
 if st.get('configured') is not True:
  result=req('/api/eufy/local-ble/setup',{'accountId':identifier.decode('ascii')})
  assert result.get('ok') and result.get('configured')
 identifier=b'\x00'*len(identifier)
 print('JH2_LOCAL_EUFY_ACCOUNT_ID_PROVISIONED_PRIVATELY')
 st=req('/api/eufy/local-ble/status')
 assert st.get('configured') is True and st.get('nanoFirmware')=='2.0.15'
 # Start with a single harmless ON command, never a blanket All-lights OFF.
 result=req('/api/eufy/local-ble/command',{'target':'Pool','operation':'power','on':True})
 ids=result.get('commandIds')
 assert result.get('queued') and isinstance(ids,list) and len(ids)==1
 cmdid=ids[0]
 print('JH2_POOL_EUFY_BLE_ON_QUEUED',cmdid,flush=True)
 state=None
 for _ in range(45):
  time.sleep(2)
  st=req('/api/eufy/local-ble/status')
  matches=[x for x in (st.get('commands') or []) if x.get('id')==cmdid]
  if not matches:continue
  state=matches[0]
  if state.get('state') in ('applied','failed','expired','superseded'):break
 assert state,'No Nano Eufy BLE command receipt'
 detail=str(state.get('detail') or '')[:170]
 print('JH2_POOL_EUFY_BLE_COMMAND_RESULT',json.dumps({
  'name':'Pool','state':state.get('state'),'bleTransmitted':state.get('bleTransmitted'),
  'message':detail}),flush=True)
 if state.get('state')!='applied' or state.get('bleTransmitted') is not True:
  raise RuntimeError('Initial Eufy GATT write not verified; leave other lights untouched')
 print('JH2_LOCAL_EUFY_BLE_FIRST_GATT_ACK_PASS')
finally:
 # RSA import credential is single-use regardless of command outcome.
 try:subprocess.run(['shred','-u',str(private)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 except Exception:private.unlink(missing_ok=True)

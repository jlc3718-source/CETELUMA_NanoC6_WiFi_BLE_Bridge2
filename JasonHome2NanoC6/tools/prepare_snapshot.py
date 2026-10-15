#!/usr/bin/env python3
"""Read current Oracle settings for migration without changing automation."""
import argparse,base64,hashlib,json,sqlite3,time,urllib.request
from pathlib import Path
from convert_backup import convert
p=argparse.ArgumentParser();p.add_argument('--output',default='migration-private');a=p.parse_args()
env={}
for line in Path('/home/ubuntu/repo/JasonHomeServer/.env').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key,value=line.split('=',1);env[key]=value.strip().strip('"\'')
token=env['JASON_HOME_API_TOKEN']
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
request=urllib.request.Request('http://127.0.0.1:8080/api/backup/export',headers={'Authorization':'Bearer '+token})
oracle=json.load(opener.open(request,timeout=45))['backup']
db=sqlite3.connect('file:/opt/jason-home-2/data/jason-home-2.sqlite?mode=ro',uri=True)
def meta(key,fallback):
    row=db.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone();return json.loads(row[0]) if row else fallback
backup={'schema':2,'createdAt':int(time.time()),'oracle':oracle,'web2':{'presets':meta('presets',[]),'customSchedules':meta('custom_schedules',[]),'palette':meta('palette',{}),'eventOverrides':meta('event_overrides',{}),'target':meta('target',0)}}
cf_account=meta('cf_ai_account_id','');cf_box=meta('cf_ai_token_cipher',None);session_secret=meta('session_secret','')
db.close();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
catalog=json.loads((Path(__file__).resolve().parents[2]/'JasonHome2Server/catalog.json').read_text())
migration=convert(backup,catalog);encoded=json.dumps(migration,separators=(',',':')).encode()
(out/'Jason-Home-2-Oracle-before-NanoC6.json').write_text(json.dumps(backup,indent=2))
if len(encoded)>60000:raise SystemExit('Complete converted settings exceed 60 KB; source snapshot preserved. No Oracle state changed.')
(out/'Jason-Home-2-NanoC6-migration.json').write_bytes(encoded)
# Keep account credentials separate from portable backups and public releases.
private={'product':'jason-home-2-nanoc6-private','eufyEmail':env.get('EUFY_EMAIL',''),'eufyPassword':env.get('EUFY_PASSWORD','')}
source_db=Path('/home/ubuntu/repo/JasonHomeServer/data/jason-home.sqlite')
if source_db.exists():
    oracle_db=sqlite3.connect('file:'+str(source_db)+'?mode=ro',uri=True)
    def raw_meta(key):
        row=oracle_db.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone();return row[0] if row else ''
    install=raw_meta('install_id') or env.get('EUFY_INSTALL_ID') or hashlib.sha256(('jason-home-server:'+env.get('EUFY_EMAIL','')).encode()).hexdigest()[:32]
    private['eufyInstall']=install
    if raw_meta('eufy_session'):
        session=json.loads(raw_meta('eufy_session'))
        private['eufySession']={k:str(session.get(k,'')) for k in ('region','bootstrap','token','uid','accountUid')}
    oracle_db.close()
if cf_account and cf_box and session_secret:
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key=hashlib.sha256(('jason-home-ai:'+session_secret).encode()).digest()
        cf_token=AESGCM(key).decrypt(base64.b64decode(cf_box['iv']),base64.b64decode(cf_box['data'])+base64.b64decode(cf_box['tag']),None).decode()
        private.update(cfAccount=cf_account,cfToken=cf_token)
    except ImportError:print('Cloudflare token requires re-entry on the NanoC6; local decrypt library unavailable.')
(out/'Jason-Home-2-NanoC6-private-account.json').write_text(json.dumps(private))
print('Read-only snapshot prepared:',len(encoded),'bytes;',len(migration['state'].get('overrides',{})),'event overrides. Oracle automation unchanged.')

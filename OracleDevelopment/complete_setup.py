#!/usr/bin/env python3
"""Connection maintenance only. Never deploys or rewrites application source."""
import hashlib,json,os,pathlib,shutil,subprocess,time,urllib.request,uuid
ROOT=pathlib.Path('/opt/oracle-home-development');STATE=pathlib.Path('/var/lib/oracle-home-development')
SRC=pathlib.Path(__file__).parent
EXPECTED='6becac84e018dface7b3419ae6c2c633ea2d4f4c0945c20e002c0516d797f0db'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def run(*a,timeout=45):
 p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Fixed connection setup operation failed: '+(p.stderr+p.stdout)[-2000:])
 return p.stdout
def health(url):
 with urllib.request.urlopen(url,timeout=6) as r:return json.load(r)
def main():
 assert os.geteuid()==0
 fingerprint=os.environ.get('ORACLE_DEV_SETUP_FINGERPRINT','')
 if fingerprint:
  # Only this exact public request fingerprint can be approved. No key/token is exported.
  result=run(str(ROOT/'venv/bin/python'),str(ROOT/'oracle_dev.py'),'--config',str(ROOT/'config.json'),'--approve-request',fingerprint)
  print(result.strip());return
 assert health('http://127.0.0.1:8081/api/health')['ok']
 target=ROOT/'oracle_dev.py';desired=SRC/'oracle_dev.py'
 if sha(target)==sha(desired):print('CONNECTION_SOURCE_ALREADY_CURRENT');return
 assert sha(target)==EXPECTED,'Installed connection changed independently; refuse overwrite'
 backup=STATE/('connection-maintenance-'+uuid.uuid4().hex);backup.mkdir(mode=0o700)
 for name in ('oracle_dev.py','test_oracle_dev.py','config.json'):shutil.copy2(ROOT/name,backup/name)
 original_config=json.loads((ROOT/'config.json').read_text())
 try:
  for name in ('oracle_dev.py','test_oracle_dev.py'):
   temporary=ROOT/(name+'.setup-new');shutil.copyfile(SRC/name,temporary);temporary.chmod(0o600);os.replace(temporary,ROOT/name)
  config=json.loads((ROOT/'config.json').read_text());config['projects']={'jason-home-2':config['projects']['jason-home-2']}
  temporary=ROOT/'config.json.setup-new';temporary.write_text(json.dumps(config,indent=2));temporary.chmod(0o600);os.replace(temporary,ROOT/'config.json')
  assert config['projects']['jason-home-2']==original_config['projects']['jason-home-2']
  run(str(ROOT/'venv/bin/python'),'-m','unittest','discover','-s',str(ROOT),'-p','test_*.py')
  run('systemctl','restart','oracle-home-development.service')
  for i in range(20):
   try:
    h=health('http://127.0.0.1:8186/health');assert h['ok'] and h['version']=='1.0.3';break
   except Exception:
    if i==19:raise
    time.sleep(.25)
  assert health('http://127.0.0.1:8081/api/health')['ok']
  print(json.dumps({'ok':True,'connection':h['connection'],'version':h['version'],'authorizedProjects':['jason-home-2'],'applicationSourceChanged':False,'keysExported':False,'ownerApproval':'exact PKCE-bound request through authenticated Oracle administrator'}))
 except BaseException:
  for name in ('oracle_dev.py','test_oracle_dev.py','config.json'):shutil.copy2(backup/name,ROOT/name)
  run('systemctl','restart','oracle-home-development.service');raise
if __name__=='__main__':main()

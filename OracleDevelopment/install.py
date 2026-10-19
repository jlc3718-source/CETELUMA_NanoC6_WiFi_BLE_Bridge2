#!/usr/bin/env python3
"""One-time bootstrap only. Application changes use OAuth MCP after install."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,time,urllib.request
ROOT=pathlib.Path('/opt/oracle-home-development')
STATE=pathlib.Path('/var/lib/oracle-home-development')
HOST='oracle-home-dev.150.136.245.51.sslip.io'
SRC=pathlib.Path(__file__).parent
SITE=pathlib.Path('/etc/nginx/sites-available/oracle-home-development')
LINK=pathlib.Path('/etc/nginx/sites-enabled/oracle-home-development')
def run(*a,timeout=180):
 p=subprocess.run(a,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Installation step failed: '+a[0]+' '+(p.stderr+'\n'+p.stdout)[-3500:])
 return p.stdout
def put(p,text,mode=0o600):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text);p.chmod(mode)
def nginx_reload():run('nginx','-t');run('systemctl','reload','nginx')
def health():
 with urllib.request.urlopen('http://127.0.0.1:8081/api/health',timeout=8) as r:return json.load(r)['ok']
def main():
 assert os.geteuid()==0 and health(),'Existing Jason Home 2 must be healthy'
 nginx_before=pathlib.Path('/etc/nginx/sites-available/jason-home').read_bytes()
 ROOT.mkdir(mode=0o700,exist_ok=True);STATE.mkdir(mode=0o700,exist_ok=True)
 ROOT.chmod(0o700);STATE.chmod(0o700)
 for name in ('oracle_dev.py','test_oracle_dev.py'):shutil.copyfile(SRC/name,ROOT/name);(ROOT/name).chmod(0o600)
 shutil.copyfile(SRC.parent/'JasonHome2Server/tests/curtain-simple-animation.mjs',ROOT/'curtain-simple-animation.mjs');(ROOT/'curtain-simple-animation.mjs').chmod(0o600)
 # Python dependencies are isolated from existing applications.
 if not (ROOT/'venv/bin/pip').exists():
  probe=subprocess.run(['python3','-m','venv',str(ROOT/'venv')],capture_output=True,text=True)
  if probe.returncode:
   run('apt-get','update',timeout=180)
   run('apt-get','install','-y','--no-install-recommends','python3-venv',timeout=180)
   run('python3','-m','venv',str(ROOT/'venv'))
 py=str(ROOT/'venv/bin/python');run(py,'-m','pip','install','--disable-pip-version-check','tinycss2==1.4.0','certbot==5.8.0',timeout=300)
 run(py,'-m','unittest','discover','-s',str(ROOT),'-p','test_*.py',timeout=40)
 info=json.loads(run('docker','inspect','jason-home-2-web'))[0]
 # Exact live source allowlist. No environment, certificates, data or DB files.
 candidates=run('docker','exec','jason-home-2-web','find','/app','-maxdepth','2','-type','f').splitlines()
 files=[]
 for p in candidates:
  rel=p.removeprefix('/app/')
  if rel=='nano_remote.html' or re.fullmatch(r'[A-Za-z0-9_]+\.mjs',rel) or re.fullmatch(r'web/[A-Za-z0-9_]+\.(?:html|js|css)',rel):files.append(rel)
 assert 'web/curtain_loop_animation.js' in files and 'server.mjs' in files
 config={'origin':'https://'+HOST,'hosts':[HOST,HOST+':443','127.0.0.1:8186'],'state':str(STATE),'animation_test':str(ROOT/'curtain-simple-animation.mjs'),'projects':{
  'jason-home-2':{'enabled':True,'container':'jason-home-2-web','image':info['Config']['Image'],'files':sorted(files),'health':'http://127.0.0.1:8081/api/health','origin':'http://127.0.0.1:8081'}}}
 put(ROOT/'config.json',json.dumps(config,indent=2))
 put(pathlib.Path('/etc/systemd/system/oracle-home-development.service'),f'''[Unit]
Description=Restricted Oracle Home Development MCP
After=network-online.target docker.service
Requires=docker.service
[Service]
Type=simple
ExecStart={py} {ROOT}/oracle_dev.py --config {ROOT}/config.json
Restart=on-failure
RestartSec=3
User=root
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths={STATE}
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
[Install]
WantedBy=multi-user.target
''',0o644)
 run('systemctl','daemon-reload');run('systemctl','enable','oracle-home-development.service');run('systemctl','restart','oracle-home-development.service')
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:8186/health',timeout=3) as r:assert json.load(r)['ok']
   break
  except Exception:
   if attempt==19:raise
   time.sleep(.25)
 # Use a hostname certificate because clients in this environment reject raw IP TLS.
 # The existing IP certificate, vhost and all application addresses are preserved.
 webroot=ROOT/'acme-webroot';webroot.mkdir(exist_ok=True,mode=0o755);ROOT.chmod(0o755)
 challenge=webroot/'.well-known/acme-challenge';challenge.mkdir(parents=True,exist_ok=True)
 http=f'''server {{
 listen 80;
 server_name {HOST};
 location ^~ /.well-known/acme-challenge/ {{ root {webroot}; }}
 location / {{ return 404; }}
}}
'''
 previous=SITE.read_bytes() if SITE.exists() else None
 previous_link=LINK.is_symlink()
 try:
  put(SITE,http,0o644)
  if not LINK.exists():LINK.symlink_to(SITE)
  nginx_reload()
  tls=ROOT/'tls';tls.mkdir(exist_ok=True,mode=0o700)
  run(str(ROOT/'venv/bin/certbot'),'certonly','--webroot','-w',str(webroot),'-d',HOST,'--cert-name','oracle-home-development','--config-dir',str(tls/'config'),'--work-dir',str(tls/'work'),'--logs-dir',str(tls/'logs'),'--non-interactive','--agree-tos','--register-unsafely-without-email',timeout=240)
  cert=tls/'config/live/oracle-home-development/fullchain.pem';key=tls/'config/live/oracle-home-development/privkey.pem'
  assert cert.exists() and key.exists()
  https=f'''server {{
 listen 443 ssl;
 server_name {HOST};
 ssl_certificate {cert};
 ssl_certificate_key {key};
 ssl_protocols TLSv1.2 TLSv1.3;
 client_max_body_size 2m;
 access_log off;
 add_header Strict-Transport-Security "max-age=31536000" always;
 location / {{
  proxy_pass http://127.0.0.1:8186;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_http_version 1.1;
  proxy_read_timeout 180s;
  proxy_buffering off;
 }}
}}
'''
  put(SITE,http+https,0o644);nginx_reload()
  # Renew only this new certificate. Existing TLS renewal infrastructure is untouched.
  put(pathlib.Path('/etc/systemd/system/oracle-home-development-tls.service'),f'''[Unit]
Description=Renew Oracle Home Development hostname certificate
[Service]
Type=oneshot
ExecStart={ROOT}/venv/bin/certbot renew --config-dir {tls}/config --work-dir {tls}/work --logs-dir {tls}/logs --quiet --deploy-hook "/usr/sbin/nginx -s reload"
''',0o644)
  put(pathlib.Path('/etc/systemd/system/oracle-home-development-tls.timer'),'''[Unit]
Description=Automatic Oracle Home Development TLS renewal
[Timer]
OnCalendar=*-*-* 04,16:15:00
RandomizedDelaySec=1800
Persistent=true
[Install]
WantedBy=timers.target
''',0o644)
  run('systemctl','daemon-reload');run('systemctl','enable','--now','oracle-home-development-tls.timer')
  assert health() and pathlib.Path('/etc/nginx/sites-available/jason-home').read_bytes()==nginx_before
  # Live harmless comment deployment and injected-failure rollback, using the new engine.
  result=json.loads(run(py,str(ROOT/'oracle_dev.py'),'--config',str(ROOT/'config.json'),'--self-test',timeout=90))
  assert result['ok'] and result['controlledFailure']['rollbackVerified']
  put(STATE/'installation-verification.json',json.dumps({'installed':True,'endpoint':'https://'+HOST+'/mcp','tls':True,'originalNginxUnchanged':True,'selfTest':result,'chatgptRegistrationVerified':False},indent=2))
  print(json.dumps({'installed':True,'endpoint':'https://'+HOST+'/mcp','directDeploymentTest':True,'automaticRollbackVerified':True,'jasonHome2Files':len(files),'andersonEditable':False,'chatgptRegistrationVerified':False}))
 except BaseException:
  if previous is not None:SITE.write_bytes(previous)
  elif SITE.exists():SITE.unlink()
  if not previous_link and LINK.is_symlink():LINK.unlink()
  nginx_reload()
  print('NEW_DEVELOPMENT_VHOST_ROLLED_BACK_EXISTING_APPLICATION_UNCHANGED')
  raise
 print('EXISTING_PROXY_ROUTES',json.dumps(re.findall(r'(?m)^\s*(?:location[^\n]+|proxy_pass[^\n]+)',nginx_before.decode())))
if __name__=='__main__':main()

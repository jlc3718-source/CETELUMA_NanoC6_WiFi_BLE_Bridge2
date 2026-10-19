import json,pathlib,re,subprocess,urllib.request
def run(*a):return subprocess.check_output(a,text=True,stderr=subprocess.DEVNULL)
names=run('docker','ps','--format','{{.Names}}').splitlines()
containers=[]
for name in names:
 if any(x in name for x in ('jason','anderson')):
  i=json.loads(run('docker','inspect',name))[0]
  containers.append({'name':name,'image':i['Config']['Image'],'ports':i['NetworkSettings']['Ports'],'mounts':[{'source':x['Source'],'target':x['Destination']} for x in i['Mounts']]})
nginx=run('nginx','-T')
certs=sorted(set(re.findall(r'(?m)^\s*ssl_certificate\s+([^;]+);',nginx)))
print(json.dumps({'containers':containers,'nginx_names':re.findall(r'(?m)^\s*server_name\s+([^;]+);',nginx),'certificates':[{'path':p,'metadata':run('openssl','x509','-in',p,'-noout','-subject','-issuer','-ext','subjectAltName').strip()} for p in certs],'nginx_sites':[str(p) for p in pathlib.Path('/etc/nginx/sites-enabled').glob('*')],'certbot':pathlib.Path('/usr/bin/certbot').exists()},indent=2))
for name in names:
 if name=='jason-home-2-web':
  print('JH2_APP_FILES',run('docker','exec',name,'find','/app','-maxdepth','2','-type','f','-name','*.mjs')[:8000])
for p in pathlib.Path('/opt').glob('*'):
 if any(x in p.name.lower() for x in ('jason','anderson','dev','mcp')):print('OPT_PROJECT',str(p))
try:
 i=json.loads(run('docker','inspect','jason-home'))[0]
 env=dict(x.split('=',1) for x in i['Config']['Env'] if '=' in x)
 req=urllib.request.Request('http://127.0.0.1:8081/api/session',data=json.dumps({'token':env['JASON_HOME_API_TOKEN']}).encode(),headers={'content-type':'application/json'})
 with urllib.request.urlopen(req,timeout=15) as r:cookie=r.headers['set-cookie'].split(';')[0]
 req=urllib.request.Request('http://127.0.0.1:8081/api/curtain/status',headers={'cookie':cookie})
 with urllib.request.urlopen(req,timeout=15) as r:st=json.load(r)
 print('CURTAIN_SAFE_STATUS',json.dumps({k:st.get(k) for k in ('online','firmware','queued','lastSeenAt','bridgeId','assetStorage','commandTransport')}))
 bridge=st.get('status') or st.get('bridge') or {}
 print('CURTAIN_STATUS_KEYS',list(st.keys()))
 print('CURTAIN_NESTED_SAFE',json.dumps({k:bridge.get(k) for k in ('firmware','version','connected','streaming','animationSpeed','lastCommandId','uptimeSeconds')}))
except Exception as e:print('STATUS_ERROR',type(e).__name__)

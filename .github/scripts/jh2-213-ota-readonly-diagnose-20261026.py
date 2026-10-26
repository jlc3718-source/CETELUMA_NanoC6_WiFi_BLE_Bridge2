import os,json,urllib.request,subprocess
env=dict(v.split('=',1) for v in json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]['Config']['Env'] if '=' in v)
cookie=''
def api(path,body=None):
 global cookie
 request=urllib.request.Request('http://127.0.0.1:8081'+path,
  data=json.dumps(body).encode() if body is not None else None,
  headers={'Content-Type':'application/json',**({'Cookie':cookie} if cookie else {})},
  method='POST' if body is not None else 'GET')
 with urllib.request.urlopen(request,timeout=25) as resp:
  if path=='/api/session':cookie=resp.headers.get('Set-Cookie','').split(';')[0]
  return json.load(resp)
api('/api/session',{'token':env['JASON_HOME_API_TOKEN']})
for idx in (16802,16803):
 try:
  c=api('/api/curtain/command?id='+str(idx)).get('command') or {}
  print('JH2_213_OTA_COMMAND',json.dumps({'id':idx,'state':c.get('state'),
  'action':c.get('action'),'result':c.get('result')}),flush=True)
 except Exception as e:print('JH2_213_OTA_DIAG_ERROR',str(e)[:150])
s=api('/api/curtain/status')
print('JH2_213_OTA_DIAGNOSTIC',json.dumps({'firmware':s.get('firmware'),
 'online':s.get('online'),'queued':s.get('queued'),
 'signedOta':s.get('signedOta'),'mtu':(s.get('curtain') or {}).get('mtu'),
 'connected':(s.get('curtain') or {}).get('connected')}),flush=True)

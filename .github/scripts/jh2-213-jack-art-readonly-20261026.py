import json,subprocess,urllib.request
env=dict(v.split('=',1) for v in json.loads(subprocess.check_output(['docker','inspect','jason-home'],text=True))[0]['Config']['Env'] if '=' in v)
session=urllib.request.Request('http://127.0.0.1:8081/api/session',data=json.dumps({'token':env['JASON_HOME_API_TOKEN']}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(session,timeout=15) as r:cookie=r.headers['Set-Cookie'].split(';')[0]
def api(path):
 with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8081'+path,headers={'Cookie':cookie}),timeout=20) as r:return json.load(r)
data=api('/api/curtain/internet-art')
print('JH2_213_ART_LIST_TOP_LEVEL',list(data.keys()),flush=True)
rows=data.get('items',data.get('art',[]))
print('JH2_213_ART_NUM',len(rows),flush=True)
matches=[{k:r.get(k) for k in ('id','name','kind','frame_count','category','source','bytes')} for r in rows if any(w in (str(r.get('name',''))+' '+str(r.get('category',''))).lower() for w in ('pumpkin','jack','lantern'))]
print('JH2_213_JACK_ART_REFS',json.dumps(matches[:60]),flush=True)
status=api('/api/curtain/status')
print('JH2_213_CURTAIN_READY',json.dumps({'firmware':status.get('firmware'),'online':status.get('online'),'connected':(status.get('curtain') or {}).get('connected'),'mtu':(status.get('curtain') or {}).get('mtu'),'queued':status.get('queued'),'streaming':status.get('relayStreaming')}),flush=True)

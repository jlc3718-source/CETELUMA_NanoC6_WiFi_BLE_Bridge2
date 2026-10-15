#!/usr/bin/env python3
"""Run on the existing Oracle host only when ready for physical cutover."""
import argparse,json,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('owner',choices=['nano','oracle']);a=p.parse_args()
token=next(line.split('=',1)[1].strip() for line in Path('/home/ubuntu/repo/JasonHomeServer/.env').read_text().splitlines() if line.startswith('JASON_HOME_API_TOKEN='))
owner='direct' if a.owner=='nano' else 'oracle'
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
request=urllib.request.Request('http://127.0.0.1:8080/api/automation/ownership',json.dumps({'owner':owner}).encode(),{'Content-Type':'application/json','Authorization':'Bearer '+token})
result=json.load(opener.open(request,timeout=90));assert result.get('ok') and result.get('owner')==owner
print('Oracle automation paused; activate NanoC6 locally.' if owner=='direct' else 'Oracle automation resumed. Keep NanoC6 paused.')

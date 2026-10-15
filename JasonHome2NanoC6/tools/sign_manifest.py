#!/usr/bin/env python3
"""Sign the separate, product-bound Jason Home 2 NanoC6 update channel."""
import argparse,base64,json,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--key',required=True);p.add_argument('--release',required=True);p.add_argument('--output',required=True);a=p.parse_args()
m=json.loads(Path(a.release).read_text());version=m['version'];name=f'jh2-runtime-{version}.bin';entry=m['files'][name]
assert m['product']=='jason-home-2-nanoc6' and 1024<entry['bytes']<=0x290000 and len(m['commit'])==40
url=f'https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/jason-home-2-nanoc6-v{version}/{name}'
payload=f"product=jason-home-2-nanoc6\nversion={version}\nbytes={entry['bytes']}\nsha256={entry['sha256']}\ncommit={m['commit']}\nurl={url}\n"
public=Path(__file__).resolve().parents[2]/'remote-update/anderson_ota_signing_public.pem'
with tempfile.TemporaryDirectory() as td:
    d=Path(td);(d/'payload').write_text(payload)
    subprocess.run(['openssl','dgst','-sha256','-sign',a.key,'-out',str(d/'signature'),str(d/'payload')],check=True)
    subprocess.run(['openssl','dgst','-sha256','-verify',str(public),'-signature',str(d/'signature'),str(d/'payload')],check=True)
    result={'schema':1,'payload':payload,'signature':base64.b64encode((d/'signature').read_bytes()).decode()}
Path(a.output).write_text(json.dumps(result,indent=2)+'\n')

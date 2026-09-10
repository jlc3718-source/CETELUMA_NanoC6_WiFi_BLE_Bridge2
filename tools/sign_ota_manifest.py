#!/usr/bin/env python3
import argparse,base64,json,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];PUBLIC_KEY=ROOT/'remote-update/anderson_ota_signing_public.pem'
def hx(s,n):return len(s)==n and all(c in '0123456789abcdefABCDEF' for c in s)
p=argparse.ArgumentParser();p.add_argument('--key',required=True);p.add_argument('--version',required=True);p.add_argument('--bytes',required=True,type=int);p.add_argument('--sha256',required=True);p.add_argument('--commit',required=True);p.add_argument('--url',required=True);p.add_argument('--output',required=True);a=p.parse_args()
if not hx(a.sha256,64) or not hx(a.commit,40) or a.bytes<=0 or a.bytes>=0x1E0000:raise SystemExit('Invalid OTA manifest inputs')
expected=f'https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v{a.version}/and_{a.version}.bin'
if a.url!=expected:raise SystemExit('Unexpected OTA release URL')
payload=f'version={a.version}\nbytes={a.bytes}\nsha256={a.sha256.lower()}\ncommit={a.commit.lower()}\nurl={a.url}\n';key=Path(a.key)
with tempfile.TemporaryDirectory() as td:
    t=Path(td);data=t/'payload';sig=t/'sig';pub=t/'pub.pem';data.write_text(payload);subprocess.run(['openssl','dgst','-sha256','-sign',str(key),'-out',str(sig),str(data)],check=True);subprocess.run(['openssl','pkey','-in',str(key),'-pubout','-out',str(pub)],check=True,stdout=subprocess.DEVNULL)
    if pub.read_text().strip()!=PUBLIC_KEY.read_text().strip():raise SystemExit('Signing key does not match Anderson OTA public key')
    subprocess.run(['openssl','dgst','-sha256','-verify',str(PUBLIC_KEY),'-signature',str(sig),str(data)],check=True,stdout=subprocess.DEVNULL);signature=base64.b64encode(sig.read_bytes()).decode()
Path(a.output).write_text(json.dumps({'schema':1,'payload':payload,'signature':signature},indent=2)+'\n')

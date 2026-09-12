#!/usr/bin/env python3
# Publication gate: the prepared signed manifest must match the exact verified build artifact.
import argparse, base64, json, subprocess, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PUBLIC_KEY = ROOT / 'remote-update/anderson_ota_signing_public.pem'


def is_hex(value, length):
    return len(value) == length and all(c in '0123456789abcdefABCDEF' for c in value)


p = argparse.ArgumentParser(description='Verify an Anderson signed OTA manifest against exact release metadata.')
p.add_argument('--manifest', required=True)
p.add_argument('--version', required=True)
p.add_argument('--bytes', required=True, type=int)
p.add_argument('--sha256', required=True)
p.add_argument('--commit', required=True)
p.add_argument('--url', required=True)
p.add_argument('--public-key', default=str(DEFAULT_PUBLIC_KEY))
a = p.parse_args()

if not is_hex(a.sha256, 64) or not is_hex(a.commit, 40) or a.bytes <= 0 or a.bytes >= 0x1E0000:
    raise SystemExit('Invalid expected OTA metadata')
expected_url = f'https://github.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/releases/download/anderson-v{a.version}/and_{a.version}.bin'
if a.url != expected_url:
    raise SystemExit('Unexpected OTA release URL')
expected_payload = (
    f'version={a.version}\n'
    f'bytes={a.bytes}\n'
    f'sha256={a.sha256.lower()}\n'
    f'commit={a.commit.lower()}\n'
    f'url={a.url}\n'
)

manifest = json.loads(Path(a.manifest).read_text())
if manifest.get('schema') != 1 or manifest.get('payload') != expected_payload:
    raise SystemExit('Signed OTA manifest payload does not exactly match the verified release')
try:
    signature = base64.b64decode(manifest['signature'], validate=True)
except Exception as exc:
    raise SystemExit('OTA signature is not valid base64') from exc
if not signature:
    raise SystemExit('OTA signature is empty')

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    payload_path = td / 'payload.txt'
    signature_path = td / 'signature.bin'
    payload_path.write_text(expected_payload)
    signature_path.write_bytes(signature)
    subprocess.run(
        ['openssl', 'dgst', '-sha256', '-verify', a.public_key, '-signature', str(signature_path), str(payload_path)],
        check=True,
        stdout=subprocess.DEVNULL,
    )

print(f'Verified signed OTA manifest for Anderson Home {a.version}')

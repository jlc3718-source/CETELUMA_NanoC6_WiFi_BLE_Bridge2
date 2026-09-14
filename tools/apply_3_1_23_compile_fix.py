from pathlib import Path
p=Path('firmware/src/RemoteUpdate.cpp')
s=p.read_text()
old='d["manifestUrl"]=OTA_MANIFEST_URL;'
new='d["manifestUrl"]=OTA_RELEASE_API_URL;d["manifestFallbackUrl"]=OTA_MANIFEST_FALLBACK_URL;'
if s.count(old)!=1:
    raise SystemExit(f'expected one stale manifest telemetry reference, found {s.count(old)}')
s=s.replace(old,new,1)
p.write_text(s)
notes=Path('firmware/RELEASE_NOTES_v3.1.23.md')
text=notes.read_text()
line='- Fixes firmware-status telemetry to report the Release API discovery endpoint and raw-manifest fallback without referencing the retired manifest constant.\n'
if line not in text:
    text += ('\n' if not text.endswith('\n') else '') + line
notes.write_text(text)
print('v3.1.23 compile telemetry fix applied')

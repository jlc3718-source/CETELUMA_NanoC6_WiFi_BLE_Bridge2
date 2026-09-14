from pathlib import Path
p=Path('firmware/src/RemoteUpdate.cpp')
s=p.read_text()
old='d["manifestUrl"]=OTA_MANIFEST_URL;'
new='d["manifestUrl"]=OTA_RELEASE_API_URL;'
if old not in s:
    raise SystemExit('status manifest URL anchor missing')
s=s.replace(old,new,1)
p.write_text(s)
print('Fixed v3.1.23 OTA status manifest URL')

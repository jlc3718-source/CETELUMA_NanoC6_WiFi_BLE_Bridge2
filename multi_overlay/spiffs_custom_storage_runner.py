from pathlib import Path
import subprocess
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
here=Path(__file__).resolve().parent

# The proven baseline gained extra startup calls after later overlays. Give the storage
# transformer its historical setup anchor, then place the SPIFFS mount at the real store.begin().
s=main.read_text()
marker_start='/*__AH_SPIFFS_SETUP_SHIM__\n'
marker_end='\n__AH_SPIFFS_SETUP_SHIM_END__*/\n'
historical='  store.begin();scheduler=new Scheduler(&store.get());connectWiFi();setupMdns();ble.begin(&store.get());\n'
s += '\n'+marker_start+historical+marker_end
main.write_text(s)

subprocess.check_call([sys.executable,str(here/'spiffs_custom_storage.py'),str(root)])

s=main.read_text()
a=s.find(marker_start)
b=s.find(marker_end,a)
if a<0 or b<0:
    raise SystemExit('SPIFFS setup shim marker missing after transform')
s=s[:a]+s[b+len(marker_end):]
mount='customFsReady=SPIFFS.begin(true);if(customFsReady)migrateLegacyCustomStorage();else Serial.println("Custom storage SPIFFS mount failed");'
if mount not in s:
    anchor='  store.begin();'
    if anchor not in s: raise SystemExit('real store.begin anchor missing')
    s=s.replace(anchor,anchor+mount,1)
main.write_text(s)
print('Mounted SPIFFS custom storage in evolved startup sequence')

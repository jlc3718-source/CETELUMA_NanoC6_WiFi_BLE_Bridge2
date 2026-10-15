#!/usr/bin/env python3
"""Build a checked install bundle from the two compiled ESP32-C6 images."""
import hashlib,json,shutil,struct,subprocess,sys,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];HERE=ROOT/'JasonHome2NanoC6'
version=(HERE/'VERSION').read_text().strip()
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
out=HERE/'release';out.mkdir(exist_ok=True)
runtime=HERE/'.pio/build/runtime';boot=HERE/'.pio/build/boot'
copies={f'jh2-runtime-{version}.bin':runtime/'firmware.bin',f'jh2-boot-{version}.bin':boot/'firmware.bin',
        'bootloader.bin':runtime/'bootloader.bin','partitions.bin':runtime/'partitions.bin',
        'boot_app0.bin':Path.home()/'.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin',
        'littlefs.bin':runtime/'littlefs.bin'}
for name,source in copies.items():shutil.copyfile(source,out/name)
image=out/f'jh2-runtime-{version}.bin'
if image.stat().st_size<=0x120000:
    image.write_bytes(image.read_bytes()+b'\xff'*(0x120010-image.stat().st_size))
assert (out/f'jh2-boot-{version}.bin').stat().st_size<=0x120000,'Updater exceeds its partition'
assert (out/f'jh2-runtime-{version}.bin').stat().st_size<=0x290000,'Runtime exceeds its partition'
parts=[];table=(out/'partitions.bin').read_bytes()
for offset in range(0,len(table),32):
    if table[offset:offset+2]!=b'\xaaP':break
    _,kind,sub,start,size,label,flags=struct.unpack_from('<HBBII16sI',table,offset)
    parts.append({'type':kind,'subtype':sub,'offset':start,'bytes':size,'label':label.split(b'\0')[0].decode()})
assert [(x['label'],x['offset'],x['bytes']) for x in parts]==[('nvs',0x9000,0x5000),('otadata',0xe000,0x2000),('boot',0x10000,0x120000),('runtime',0x130000,0x290000),('storage',0x3c0000,0x40000)]
assert [x['subtype'] for x in parts if x['type']==0]==[0,16],'Unexpected additional runtime slot'
assert struct.unpack_from('<I',(out/'boot_app0.bin').read_bytes())[0]==1,'Initial boot must select ota_0/runtime'
for name in [f'jh2-runtime-{version}.bin',f'jh2-boot-{version}.bin','bootloader.bin']:
    data=(out/name).read_bytes();assert data[0]==0xe9 and struct.unpack_from('<H',data,12)[0]==13,'Not an ESP32-C6 image'
    subprocess.run([sys.executable,'-m','esptool','--chip','esp32c6','image-info',str(out/name)],check=True,stdout=subprocess.DEVNULL)
full=out/f'jh2-full-install-{version}.bin'
subprocess.run([sys.executable,'-m','esptool','--chip','esp32c6','merge-bin','--output',str(full),
               '--flash-mode','dio','--flash-freq','80m','--flash-size','4MB','--pad-to-size','4MB',
               '0x0',str(out/'bootloader.bin'),'0x8000',str(out/'partitions.bin'),'0xe000',str(out/'boot_app0.bin'),
               '0x10000',str(out/f'jh2-boot-{version}.bin'),'0x130000',str(out/f'jh2-runtime-{version}.bin'),
               '0x3c0000',str(out/'littlefs.bin')],check=True)
assert full.stat().st_size==0x400000
for name in ['flash.py','convert_backup.py']:shutil.copyfile(HERE/'tools'/name,out/name)
shutil.copyfile(ROOT/'JasonHome2Server/catalog.json',out/'catalog.json')
shutil.copyfile(HERE/'README.md',out/'INSTALL.md')
shutil.copyfile(HERE/'TESTING.md',out/'TESTING.md')
shutil.copyfile(HERE/'asset-manifest.json',out/'asset-manifest.json')
(out/'install-windows.cmd').write_text('@echo off\ncd /d "%~dp0"\npy -3 -m pip install esptool==5.5.0\nif errorlevel 1 goto end\npy -3 flash.py\n:end\npause\n')
manifest={'product':'jason-home-2-nanoc6','version':version,'commit':commit,'status':'installation-candidate',
          'flash_bytes':0x400000,'remote_url':'http://craumejl.tplinkdns.com','external_tcp_port':80,
          'runtime_copies':1,'rollback':False,'partitions':parts,'physically_verified':False,'files':{}}
for path in sorted(out.iterdir()):
    if path.is_file() and path.name not in ['release.json','SHA256SUMS','latest.json'] and not path.name.endswith(('.zip','.apk')):
        data=path.read_bytes();manifest['files'][path.name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
(out/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'SHA256SUMS').write_text(''.join(f"{v['sha256']}  {k}\n" for k,v in manifest['files'].items()))
archive=out/f'Jason-Home-2-NanoC6-{version}-Install.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(out.iterdir()):
        if p.is_file() and p.suffix not in ['.zip','.apk']:z.write(p,p.name)
subprocess.run([sys.executable,str(out/'flash.py'),'--verify-only'],check=True)
print('Package:',archive,'runtime',manifest['files'][f'jh2-runtime-{version}.bin']['bytes'],'boot',manifest['files'][f'jh2-boot-{version}.bin']['bytes'])

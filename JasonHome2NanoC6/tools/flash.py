#!/usr/bin/env python3
"""Verify the release, then install or repair Jason Home 2 on a 4 MB NanoC6."""
import argparse,hashlib,json,subprocess,sys
from pathlib import Path

def verify(root):
    manifest=json.loads((root/'release.json').read_text())
    if manifest['product']!='jason-home-2-nanoc6' or manifest['flash_bytes']!=0x400000:
        raise ValueError('Wrong product or flash layout')
    for name,entry in manifest['files'].items():
        if Path(name).name!=name:raise ValueError('Invalid release filename')
        data=(root/name).read_bytes()
        if len(data)!=entry['bytes'] or hashlib.sha256(data).hexdigest()!=entry['sha256']:
            raise ValueError('Checksum mismatch: '+name)
    return manifest

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',help='Example: COM5, /dev/ttyACM0, /dev/cu.usbmodem...')
    parser.add_argument('--mode',choices=['install','runtime'],default='install')
    parser.add_argument('--verify-only',action='store_true')
    parser.add_argument('--yes',action='store_true')
    args=parser.parse_args();root=Path(__file__).resolve().parent
    manifest=verify(root);version=manifest['version']
    print('Verified Jason Home 2 NanoC6',version,'source',manifest['commit'])
    if args.verify_only:return
    import serial.tools.list_ports
    port=args.port
    if not port:
        ports=list(serial.tools.list_ports.comports())
        for i,p in enumerate(ports,1):print(i,p.device,p.description)
        if len(ports)==1:port=ports[0].device
        elif ports:port=ports[int(input('NanoC6 port number: '))-1].device
        else:raise ValueError('No serial port. Hold the front button while connecting USB, then retry.')
    if args.mode=='install':
        print('Full installation replaces all software and NanoC6 settings on',port)
        files=['0x0',str(root/f'jh2-full-install-{version}.bin')]
    else:
        print('Runtime repair keeps Wi-Fi and settings. Requires this exact Jason Home 2 partition layout.')
        files=['0xe000',str(root/'boot_app0.bin'),'0x130000',str(root/f'jh2-runtime-{version}.bin')]
    if not args.yes and input('Type FLASH to continue: ').strip()!='FLASH':return
    cmd=[sys.executable,'-m','esptool','--chip','esp32c6','--port',port,'--baud','460800',
         'write-flash','--flash-size','4MB','--flash-mode','dio','--flash-freq','80m',*files]
    subprocess.run(cmd,check=True)
    print('Flashed and verified. Disconnect/reconnect USB if the device remains in download mode.')

if __name__=='__main__':
    try:main()
    except (ValueError,FileNotFoundError,IndexError,ImportError) as error:sys.exit(str(error))

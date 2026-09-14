#!/usr/bin/env python3
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
version=(ROOT/'FIRMWARE_VERSION.txt').read_text().strip()
if version!='3.1.14':
    raise SystemExit(f'Expected 3.1.14 before collision-safe bump, found {version}')
subprocess.run(['python','tools/release.py','bump'],cwd=ROOT,check=True)
notes=ROOT/'firmware/RELEASE_NOTES_v3.1.15.md'
notes.write_text('''# Anderson Home v3.1.15\n\n- Removes the shared BLE write timer that forced controller B to trail controller A.\n- Preserves the 18 ms safety gap independently on each controller.\n- Prefers BLE write-without-response when supported so paired commands can be queued back-to-back.\n- Keeps reliable reassert/retry behavior for dropped frames.\n- Uses v3.1.15 because an older historical v3.1.14 tag already exists.\n''')
print('Prepared Anderson Home v3.1.15 synchronization release')

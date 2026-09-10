#!/usr/bin/env python3
"""Prepare, package, and retrieve an Anderson Home APP-only release."""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request
import zipfile
from html.parser import HTMLParser

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'firmware/web/index.html'
MAIN = ROOT / 'firmware/src/main.cpp'
SLOT = 0x1E0000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def version():
    value = (ROOT / 'FIRMWARE_VERSION.txt').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('Invalid FIRMWARE_VERSION.txt')
    return value


def bump():
    old = version()
    major, minor, patch = map(int, old.split('.'))
    new = f'{major}.{minor}.{patch + 1}'
    replacements = [(MAIN, f'VERSION="{old}"', f'VERSION="{new}"'),
                    (UI, f'>v{old}<', f'>v{new}<'),
                    (ROOT / 'README.md', f'**v{old}**', f'**v{new}**')]
    changes = []
    for path, before, after in replacements:
        text = path.read_text()
        if text.count(before) != 1:
            raise ValueError(f'Expected one version marker in {path.relative_to(ROOT)}')
        changes.append((path, text.replace(before, after)))
    for path, text in changes:
        path.write_text(text)
    (ROOT / 'FIRMWARE_VERSION.txt').write_text(new + '\n')
    print(new)


class PageIds(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        value = dict(attrs).get('id')
        if value:
            if value in self.ids:
                raise ValueError(f'Duplicate HTML id: {value}')
            self.ids.add(value)


def check():
    ver, html, source = version(), UI.read_text(), MAIN.read_text()
    if f'VERSION="{ver}"' not in source or f'>v{ver}<' not in html:
        raise ValueError('Firmware/UI version mismatch; use tools/release.py bump')
    PageIds().feed(html)
    scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', html, re.S | re.I)
    if not scripts:
        raise ValueError('Web UI has no scripts')
    subprocess.run(['node', '--check'], input='\n'.join(scripts), text=True, check=True)
    partitions = {}
    for line in (ROOT / 'firmware/partitions_ota.csv').read_text().splitlines():
        if line.strip() and not line.lstrip().startswith('#'):
            row = [s.strip() for s in line.split(',')]
            partitions[row[0]] = (int(row[3], 0), int(row[4], 0))
    if partitions.get('app0') != (0x10000, SLOT) or partitions.get('app1') != (0x1F0000, SLOT):
        raise ValueError('OTA partition layout changed; this is not a routine APP-only release')
    print(f'v{ver}: version, HTML, JavaScript, and OTA layout checks passed')


def prepare():
    check()
    packed = gzip.compress(UI.read_bytes(), compresslevel=9, mtime=0)
    lines = ['#pragma once', '#include <Arduino.h>',
             f'static const size_t WEB_UI_GZ_LEN={len(packed)};',
             'static const uint8_t WEB_UI_GZ[] PROGMEM = {']
    lines += ['  ' + ','.join(f'0x{b:02x}' for b in packed[i:i+20]) + ','
              for i in range(0, len(packed), 20)]
    text = '\n'.join(lines + ['};', ''])
    target = ROOT / 'firmware/include/WebUIGzip.h'
    if not target.exists() or target.read_text() != text:
        target.write_text(text)
    print(f'Web UI: {UI.stat().st_size} bytes -> {len(packed)} bytes')


def validate_app(data):
    if not data or data[0] != 0xE9 or len(data) >= SLOT:
        raise ValueError('Invalid or oversized APP-only firmware')
    if gzip.compress(UI.read_bytes(), compresslevel=9, mtime=0) not in data:
        raise ValueError('Firmware does not contain this exact web UI')


def package(full):
    ver = version()
    build = ROOT / 'firmware/.pio/build/m5stack-nanoc6'
    app = (build / 'firmware.bin').read_bytes()
    validate_app(app)
    folder = ROOT / 'release'
    folder.mkdir(exist_ok=True)
    files = {f'and_{ver}.bin': app}
    if full:
        files[f'and_{ver}_full.bin'] = (build / 'firmware.factory.bin').read_bytes()
    manifest = {'version': ver, 'commit': git('rev-parse', 'HEAD'),
                'ota_slot_bytes': SLOT, 'ui_sha256': sha(UI.read_bytes()), 'files': {}}
    for name, data in files.items():
        (folder / name).write_bytes(data)
        manifest['files'][name] = {'bytes': len(data), 'sha256': sha(data)}
    (folder / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    if os.environ.get('GITHUB_ENV'):
        with open(os.environ['GITHUB_ENV'], 'a') as f:
            f.write(f'VERSION={ver}\n')
    print(json.dumps(manifest, indent=2))


def download(args):
    # The public artifact URL is resolved from the successful GitHub run.
    # Verify GitHub's archive digest before trusting any extracted content.
    if not args.url.startswith('https://'):
        raise ValueError('Artifact downloads require HTTPS')
    with urllib.request.urlopen(args.url, timeout=45) as response:
        archive = response.read(25 * 1024 * 1024 + 1)
    if len(archive) > 25 * 1024 * 1024:
        raise ValueError('Unexpectedly large firmware artifact')
    if sha(archive) != args.digest.removeprefix('sha256:'):
        raise ValueError('Artifact SHA-256 does not match GitHub')
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        manifest = json.loads(z.read('release.json'))
        if manifest['version'] != version() or manifest['commit'] != args.commit:
            raise ValueError('Artifact was built from a different release/commit')
        name = f'and_{version()}.bin'
        data = z.read(name)
    if sha(data) != manifest['files'][name]['sha256']:
        raise ValueError('APP-only checksum mismatch')
    validate_app(data)
    folder = Path(args.output).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    target.write_bytes(data)
    print(json.dumps({'file': str(target), 'bytes': len(data), 'sha256': sha(data),
                      'version': version(), 'commit': args.commit}))


def payload(base):
    entries = []
    names = git('diff', '--name-status', '--no-renames', base, 'HEAD')
    for line in names.splitlines():
        status, path = line.split('\t', 1)
        entry = {'path': path, 'mode': '100644', 'type': 'blob'}
        if status == 'D':
            entry['sha'] = None
        else:
            entry['content'] = (ROOT / path).read_text()
        entries.append(entry)
    print(json.dumps({'base_tree_sha': git('rev-parse', base + '^{tree}'),
                      'tree_elements': entries}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('bump', 'check', 'prepare'):
        sub.add_parser(command)
    p = sub.add_parser('package')
    p.add_argument('--full', action='store_true')
    p = sub.add_parser('payload')
    p.add_argument('--base', required=True)
    p = sub.add_parser('download')
    for key in ('url', 'digest', 'commit', 'output'):
        p.add_argument('--' + key, required=True)
    args = parser.parse_args()
    if args.command == 'bump': bump()
    elif args.command == 'check': check()
    elif args.command == 'prepare': prepare()
    elif args.command == 'package': package(args.full)
    elif args.command == 'payload': payload(args.base)
    elif args.command == 'download': download(args)

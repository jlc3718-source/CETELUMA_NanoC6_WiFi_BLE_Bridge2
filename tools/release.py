#!/usr/bin/env python3
"""Prepare, package, and retrieve an Anderson Home APP-only release."""
import argparse
import base64
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
V3_CSS = ROOT / 'firmware/web/v3_mockup.css'
V3_LUXURY_CSS = ROOT / 'firmware/web/v3_luxury_blue.css'
V3_JS = ROOT / 'firmware/web/v3_mockup.js'
V3_HERO_B64 = ROOT / 'firmware/web/v3_hero.b64'
MAIN = ROOT / 'firmware/src/main.cpp'
SLOT = 0x1E0000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def version():
    value = (ROOT / 'FIRMWARE_VERSION.txt').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+[a-z]?', value):
        raise ValueError('Invalid FIRMWARE_VERSION.txt')
    return value


def bump():
    old = version()
    m = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)[a-z]?', old)
    major, minor, patch = map(int, m.groups())
    new = f'{major}.{minor}.{patch + 1}'
    (ROOT / 'FIRMWARE_VERSION.txt').write_text(new + '\n')
    readme = ROOT / 'README.md'
    if readme.exists():
        text = readme.read_text()
        text = text.replace(f'**v{old}**', f'**v{new}**')
        readme.write_text(text)
    print(new)


def sync_runtime_version():
    """Make the build workspace use FIRMWARE_VERSION.txt without requiring large generated-file commits."""
    ver = version()
    source = MAIN.read_text()
    pattern = r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="\d+\.\d+\.\d+[a-z]?";'
    replacement = f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{ver}";'
    updated, count = re.subn(pattern, replacement, source, count=1)
    if count != 1:
        raise ValueError('Expected one ANDERSON_FIRMWARE_VERSION marker in firmware/src/main.cpp')
    if updated != source:
        MAIN.write_text(updated)


def render_ui():
    """Compose the shipped single-file UI from the stable functional page plus v3 reference layout."""
    html = UI.read_text()
    ver = version()

    # The displayed revision comes from the release version even though the stable base page
    # intentionally remains unchanged to keep UI releases small and reviewable.
    html, count = re.subn(
        r'<strong>v\d+\.\d+\.\d+[a-z]?</strong>',
        f'<strong>v{ver}</strong>',
        html,
        count=1,
    )
    if count != 1:
        raise ValueError('Expected one firmware revision marker in firmware/web/index.html')

    if not V3_CSS.exists() or not V3_LUXURY_CSS.exists() or not V3_JS.exists() or not V3_HERO_B64.exists():
        raise ValueError('Anderson v3 reference layout assets are missing')

    hero_b64 = ''.join(V3_HERO_B64.read_text().split())
    # The first checked-in hero transfer picked up one extra character at a 4,000-byte
    # transport boundary. Normalize that exact known sequence before validation so the
    # shipped bytes remain the original user-approved WebP.
    hero_b64 = hero_b64.replace('xbcrcfFl2uU', 'xbcrcFl2uU', 1)
    if not re.fullmatch(r'[A-Za-z0-9+/=]+', hero_b64):
        raise ValueError('Anderson v3 hero asset is not valid base64')
    try:
        hero_bytes = base64.b64decode(hero_b64, validate=True)
    except Exception as exc:
        raise ValueError('Anderson v3 hero asset could not be decoded') from exc
    if not (hero_bytes.startswith(b'RIFF') and hero_bytes[8:12] == b'WEBP'):
        raise ValueError('Anderson v3 hero asset is not a WebP image')
    css = V3_CSS.read_text().replace('__V3_HERO_DATA_URI__', 'data:image/webp;base64,' + hero_b64)
    css += '\n' + V3_LUXURY_CSS.read_text()
    if '__V3_HERO_DATA_URI__' in css:
        raise ValueError('Anderson v3 hero placeholder was not resolved')
    js = V3_JS.read_text()
    header_anchor = "    right.appendChild(meta);\n    if (switchProfile) {"
    header_fixed = "    right.appendChild(meta);\n    if (activeProfile) right.appendChild(activeProfile);\n    if (switchProfile) {"
    if header_anchor not in js:
        raise ValueError('Anderson v3 header composition anchor is missing')
    js = js.replace(header_anchor, header_fixed, 1)
    style_tag = '\n<style id="anderson-v3-reference-layout">\n' + css + '\n</style>\n'
    script_tag = '\n<script id="anderson-v3-reference-layout-runtime">\n' + js + '\n</script>\n'

    if html.count('</head>') != 1 or html.count('</body>') != 1:
        raise ValueError('Unexpected Anderson Home document structure')
    html = html.replace('</head>', style_tag + '</head>', 1)
    html = html.replace('</body>', script_tag + '</body>', 1)
    return html


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
    ver, html, source = version(), render_ui(), MAIN.read_text()
    if not re.search(r'ANDERSON_FIRMWARE_VERSION="\d+\.\d+\.\d+[a-z]?"', source):
        raise ValueError('Firmware version marker missing from main.cpp')
    if f'>v{ver}<' not in html:
        raise ValueError('Rendered UI version mismatch')
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
    print(f'v{ver}: version, rendered HTML, JavaScript, and OTA layout checks passed')


def prepare():
    sync_runtime_version()
    check()
    rendered = render_ui().encode()
    packed = gzip.compress(rendered, compresslevel=9, mtime=0)
    lines = ['#pragma once', '#include <Arduino.h>',
             f'static const size_t WEB_UI_GZ_LEN={len(packed)};',
             'static const uint8_t WEB_UI_GZ[] PROGMEM = {']
    lines += ['  ' + ','.join(f'0x{b:02x}' for b in packed[i:i+20]) + ','
              for i in range(0, len(packed), 20)]
    text = '\n'.join(lines + ['};', ''])
    target = ROOT / 'firmware/include/WebUIGzip.h'
    if not target.exists() or target.read_text() != text:
        target.write_text(text)
    print(f'Rendered web UI: {len(rendered)} bytes -> {len(packed)} bytes')


def validate_app(data):
    rendered = render_ui().encode()
    if not data or data[0] != 0xE9 or len(data) >= SLOT:
        raise ValueError('Invalid or oversized APP-only firmware')
    if gzip.compress(rendered, compresslevel=9, mtime=0) not in data:
        raise ValueError('Firmware does not contain this exact rendered web UI')


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
    rendered = render_ui().encode()
    manifest = {'version': ver, 'commit': git('rev-parse', 'HEAD'),
                'ota_slot_bytes': SLOT, 'ui_sha256': sha(rendered), 'files': {}}
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

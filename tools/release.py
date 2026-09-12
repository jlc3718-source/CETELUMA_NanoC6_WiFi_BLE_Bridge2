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
from functools import lru_cache

import rcssmin
import zopfli.gzip

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'firmware/web/index.html'
V3_CSS = ROOT / 'firmware/web/v3_mockup.css'
V3_JS = ROOT / 'firmware/web/v3_mockup.js'
RECOVERY_UI = ROOT / 'firmware/web/recovery.html'
MAIN = ROOT / 'firmware/src/main.cpp'
BUILD_IDENTITY = ROOT / 'firmware/include/BuildIdentity.h'
SLOT = 0x1E0000
ZOPFLI_ITERATIONS = 50


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
    source = MAIN.read_text()
    source, count = re.subn(r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="\d+\.\d+\.\d+[a-z]?";', f'static constexpr const char* ANDERSON_FIRMWARE_VERSION="{new}";', source, count=1)
    if count != 1:
        raise ValueError('Expected one ANDERSON_FIRMWARE_VERSION marker in firmware/src/main.cpp')
    MAIN.write_text(source)
    readme = ROOT / 'README.md'
    if readme.exists():
        text = readme.read_text()
        text = text.replace(f'**v{old}**', f'**v{new}**')
        readme.write_text(text)
    print(new)


def validate_runtime_version():
    """Require committed source and FIRMWARE_VERSION.txt to describe the same image."""
    ver = version()
    source = MAIN.read_text()
    match = re.search(r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="(\d+\.\d+\.\d+[a-z]?)";', source)
    if not match:
        raise ValueError('Expected one ANDERSON_FIRMWARE_VERSION marker in firmware/src/main.cpp')
    if match.group(1) != ver:
        raise ValueError(f'Committed runtime version {match.group(1)} does not match FIRMWARE_VERSION.txt {ver}')


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

    if not V3_CSS.exists() or not V3_JS.exists():
        raise ValueError('Anderson v3 reference layout assets are missing')

    css = V3_CSS.read_text()
    js = V3_JS.read_text()
    style_tag = '\n<style id="anderson-v3-reference-layout">\n' + css + '\n</style>\n'
    script_tag = '\n<script id="anderson-v3-reference-layout-runtime">\n' + js + '\n</script>\n'

    if html.count('</head>') != 1 or html.count('</body>') != 1:
        raise ValueError('Unexpected Anderson Home document structure')
    html = html.replace('</head>', style_tag + '</head>', 1)
    html = html.replace('</body>', script_tag + '</body>', 1)
    return minify_html(html)


@lru_cache(maxsize=4)
def minify_html(html):
    """Minify embedded code only; preserve document text, IDs, and whitespace layout."""
    pattern = r'(<(script|style)\b[^>]*>)(.*?)(</\2\s*>)'
    blocks = list(re.finditer(pattern, html, re.S | re.I))
    scripts = [m[3] for m in blocks if m[2].lower() == 'script']
    result = subprocess.run(
        ['node', str(ROOT / 'tools/minify_web.js')],
        input=json.dumps(scripts), text=True, check=True, capture_output=True,
    )
    minimized = json.loads(result.stdout)
    if len(minimized) != len(scripts):
        raise ValueError('Web minifier returned an unexpected script count')
    javascript = iter(minimized)

    def replace(match):
        body = (next(javascript) if match[2].lower() == 'script'
                else rcssmin.cssmin(match[3], keep_bang_comments=True))
        return match[1] + body + match[4]

    return re.sub(pattern, replace, html, flags=re.S | re.I)


def rendered_pages():
    return {'WEB_UI': render_ui().encode(),
            'RECOVERY_UI': minify_html(RECOVERY_UI.read_text()).encode()}


@lru_cache(maxsize=4)
def compress_page(rendered):
    """High-effort standard gzip; decompression stays in the existing browser."""
    packed = zopfli.gzip.compress(rendered, numiterations=ZOPFLI_ITERATIONS, blocksplittingmax=0)
    if gzip.decompress(packed) != rendered:
        raise ValueError('Compressed web page failed its lossless round-trip check')
    return packed


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
    runtime = re.search(r'ANDERSON_FIRMWARE_VERSION="(\d+\.\d+\.\d+[a-z]?)"', source)
    if not runtime:
        raise ValueError('Firmware version marker missing from main.cpp')
    if runtime.group(1) != ver:
        raise ValueError(f'Firmware source version {runtime.group(1)} does not match {ver}')
    if f'>v{ver}<' not in html:
        raise ValueError('Rendered UI version mismatch')
    for name, page in rendered_pages().items():
        page = page.decode()
        PageIds().feed(page)
        scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', page, re.S | re.I)
        if not scripts:
            raise ValueError(f'{name} has no scripts')
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
    validate_runtime_version()
    check()
    commit = git('rev-parse', 'HEAD')
    BUILD_IDENTITY.write_text('#pragma once\n#define ANDERSON_BUILD_COMMIT "' + commit + '"\n')
    lines = ['#pragma once', '#include <Arduino.h>']
    for name, rendered in rendered_pages().items():
        packed = compress_page(rendered)
        lines += [f'static const size_t {name}_GZ_LEN={len(packed)};',
                  f'static const uint8_t {name}_GZ[] PROGMEM = {{']
        lines += ['  ' + ','.join(f'0x{b:02x}' for b in packed[i:i+20]) + ','
                  for i in range(0, len(packed), 20)]
        lines += ['};']
        print(f'{name}: {len(rendered)} bytes -> {len(packed)} bytes (Zopfli gzip, {ZOPFLI_ITERATIONS} iterations)')
    text = '\n'.join(lines + [''])
    target = ROOT / 'firmware/include/WebUIGzip.h'
    if not target.exists() or target.read_text() != text:
        target.write_text(text)


def validate_app(data):
    if not data or data[0] != 0xE9 or len(data) >= SLOT:
        raise ValueError('Invalid or oversized APP-only firmware')
    for name, rendered in rendered_pages().items():
        if compress_page(rendered) not in data:
            raise ValueError(f'Firmware does not contain the exact rendered {name}')


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
    manifest['web_assets'] = {
        name: {'bytes': len(page), 'sha256': sha(page),
               'gzip_bytes': len(compress_page(page)),
               'gzip_sha256': sha(compress_page(page))}
        for name, page in rendered_pages().items()
    }
    manifest['web_compression'] = f'zopfli-0.2.3.post1-gzip-{ZOPFLI_ITERATIONS}-unlimited-blocks'
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

def deliver(args):
    """Resume the canonical release-current build/publish path and emit a receipt."""
    source=args.source_sha or git('rev-parse','HEAD'); receipt=ROOT/'.anderson-delivery.json'
    state={'source_sha':source,'version':version(),'branch':'codex/release-current'}
    if receipt.exists():
        try:
            prior=json.loads(receipt.read_text())
            if prior.get('source_sha')==source:state.update(prior)
        except Exception:pass
    def gh(*a):return subprocess.check_output(['gh',*a],text=True).strip()
    if git('rev-parse','HEAD')!=source:raise ValueError('Working tree must be at --source-sha')
    run=state.get('build_run_id')
    if not run:
        subprocess.run(['gh','workflow','run','compile-anderson-home-multi.yml','--ref','codex/release-current'],check=True)
        import time
        for _ in range(30):
            time.sleep(2);raw=gh('run','list','--workflow','compile-anderson-home-multi.yml','--branch','codex/release-current','--limit','10','--json','databaseId,headSha,status,conclusion');rows=json.loads(raw);hit=next((x for x in rows if x['headSha']==source),None)
            if hit:run=hit['databaseId'];break
        if not run:raise RuntimeError('Could not resolve build run for source SHA')
        state['build_run_id']=run;receipt.write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps(state,indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('bump', 'check', 'prepare'):
        sub.add_parser(command)
    p = sub.add_parser('package')
    p.add_argument('--full', action='store_true')
    p = sub.add_parser('payload')
    p.add_argument('--base', required=True)
    p = sub.add_parser('deliver')
    p.add_argument('--source-sha')
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
    elif args.command == 'deliver': deliver(args)

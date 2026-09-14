#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(rel):
    return (ROOT / rel).read_text()


def write(rel, text):
    (ROOT / rel).write_text(text)


def replace_once(rel, old, new):
    text = read(rel)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one occurrence in {rel!s}: {old!r}; found {count}")
    write(rel, text.replace(old, new, 1))


# Exact production baseline guard. This release is compression-only and must start
# from the published v3.1.24 source.
if read('FIRMWARE_VERSION.txt').strip() != '3.1.24':
    raise SystemExit('Refusing to apply v3.1.25 compression: baseline is not v3.1.24')

write('FIRMWARE_VERSION.txt', '3.1.25\n')

main = read('firmware/src/main.cpp')
main, count = re.subn(
    r'static constexpr const char\* ANDERSON_FIRMWARE_VERSION="3\.1\.24";',
    'static constexpr const char* ANDERSON_FIRMWARE_VERSION="3.1.25";',
    main,
    count=1,
)
if count != 1:
    raise SystemExit('Expected one v3.1.24 runtime version marker in firmware/src/main.cpp')
write('firmware/src/main.cpp', main)

# Embedded web payload: preserve the same gzip/content-encoding path, but push
# Zopfli much harder. Unlimited block splitting was already enabled.
replace_once('tools/release.py', 'ZOPFLI_ITERATIONS = 50', 'ZOPFLI_ITERATIONS = 1000')

# JavaScript: retain public/global names and function names for compatibility,
# but allow substantially more lossless compression-analysis passes.
replace_once('tools/minify_web.js', 'compress: { passes: 3 },', 'compress: { passes: 10 },')

# Apply safe whole-program size flags to every project translation unit. These
# complement -Oz and --gc-sections without LTO or semantic-changing unsafe opts.
pio = read('firmware/platformio.ini')
needle = '    -Oz\n'
extra = (
    '    -Oz\n'
    '    -ffunction-sections\n'
    '    -fdata-sections\n'
    '    -fmerge-constants\n'
    '    -fno-ident\n'
)
if needle not in pio:
    raise SystemExit('Could not find -Oz build flag in firmware/platformio.ini')
for flag in ('-ffunction-sections', '-fdata-sections', '-fmerge-constants', '-fno-ident'):
    if flag in pio:
        raise SystemExit(f'Compression flag already present unexpectedly: {flag}')
pio = pio.replace(needle, extra, 1)
write('firmware/platformio.ini', pio)

# Bring the human-readable project identity in sync without touching behavior.
readme = read('README.md')
readme, n = re.subn(r'Current firmware: \*\*v[^*]+\*\*\.', 'Current firmware: **v3.1.25**.', readme, count=1)
if n != 1:
    raise SystemExit('README current-firmware marker not found')
readme = re.sub(r'Zopfli gzip \(\d+ iterations, unlimited block splitting\)',
                'Zopfli gzip (1000 iterations, unlimited block splitting)', readme)
write('README.md', readme)

notes = '''# Anderson Home v3.1.25 — maximum safe compression\n\nCompression-only production release based on the exact v3.1.24 source.\n\n- Preserves all controller behavior, NVS data, BLE protocol, schedules/events, profiles/PINs, UI behavior, recovery, and signed OTA compatibility.\n- Keeps the existing 4 MB flash / dual APP-slot map and APP-only routine update format.\n- Keeps `-Oz`, disabled exceptions/RTTI/unwind tables, and linker garbage collection.\n- Adds explicit function/data sections, constant merging, and compiler ident suppression so dead sections can be discarded consistently.\n- Increases Terser compression analysis from 3 to 10 passes while preserving public/global bindings and function names.\n- Increases deterministic Zopfli gzip effort from 50 to 1000 iterations with unlimited block splitting for both embedded web pages.\n- LTO and unsafe semantic-changing compiler transforms remain intentionally disabled.\n'''
write('firmware/RELEASE_NOTES_v3.1.25.md', notes)

print('Applied Anderson Home v3.1.25 maximum-safe compression changes')

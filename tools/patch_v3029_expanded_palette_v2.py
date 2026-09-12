from pathlib import Path

src = Path('tools/patch_v3029_expanded_palette.py').read_text()
src = src.replace(
'''ids = re.findall(r'\\{"evt(\\d{3})"', event)
assert len(ids) == 210, len(ids)
assert ids == [f"{i:03d}" for i in range(1, 211)]
''',
'''definitions = re.findall(r'\\{"evt(\\d{3})"[^\\n]*?Effect::', event)
assert len(definitions) == 210, len(definitions)
assert definitions == [f"{i:03d}" for i in range(1, 211)]
''')
src = src.replace(
'''assert len(re.findall(r'\\{"evt\\d{3}"', updated_event)) == 210''',
'''assert len(re.findall(r'\\{"evt\\d{3}"[^\\n]*?Effect::', updated_event)) == 210''')
assert 'assert len(ids) == 210' not in src
exec(compile(src, 'patch_v3029_expanded_palette_v2', 'exec'))

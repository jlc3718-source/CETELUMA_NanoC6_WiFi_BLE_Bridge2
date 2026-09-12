from pathlib import Path
import ast, re

patch_text=Path('tools/patch_v3029_expanded_palette.py').read_text()
m=re.search(r'COLORS = (\{.*?\})\nassert len\(COLORS\)',patch_text,re.S)
assert m, 'COLORS mapping not found'
colors=ast.literal_eval(m.group(1))
assert len(colors)==210 and set(colors)==set(range(1,211))

event=Path('firmware/src/EventCatalog.cpp').read_text()
for i in range(1,211):
    line=next((x for x in event.splitlines() if x.startswith(f'{{"evt{i:03d}"')),None)
    assert line, f'missing evt{i:03d}'
    cm=re.search(r'C([1-6])\(([^)]*)\),(\d+)\s*\},',line)
    assert cm, f'colors not found evt{i:03d}'
    got=[x.strip().replace('0x','').upper() for x in cm.group(2).split(',')]
    assert int(cm.group(1))==len(colors[i])==int(cm.group(3)), (i,cm.groups(),colors[i])
    assert got==colors[i], (i,got,colors[i])

palette=[
('Red','FF0000'),('Orange','FF0D00'),('Pink','FF0024'),('Yellow','FFFF44'),('Green','28FF00'),('Cyan','00BD4C'),('Blue','0D00FF'),('Purple','5B00E6'),('White','FFFFFA'),
('Teal','00B4B4'),('Sky Blue','0096FF'),('Amber Gold','FFA000'),('Lavender','B464FF'),('Navy Blue','001478'),('Burgundy','87002D'),('Silver Gray','A0A5AF')]
cc=Path('firmware/src/ColorCorrection.cpp').read_text()
for name,h in palette:
    assert f'{{0x{h},0x{h}}}' in cc, (name,h)

web_path=Path('firmware/web/index.html')
web=web_path.read_text()
for name,h in palette:
    assert f"name:'{name}'" in web and f"output:'#{h}'" in web, (name,h)
old_s="const suggestions=['#FF0000','#FF0D00','#FF0024','#FFFF44','#28FF00','#00BD4C','#0D00FF','#5B00E6','#FFFFFA'];"
old_q="const quick=['#FF0000','#FF0D00','#FF0024','#FFFF44','#28FF00','#00BD4C','#0D00FF','#5B00E6','#FFFFFA'];"
if old_s in web: web=web.replace(old_s,"const suggestions=[...MASTER_FAVORITE_COLORS];",1)
if old_q in web: web=web.replace(old_q,"const quick=[...MASTER_FAVORITE_COLORS];",1)
assert 'const suggestions=[...MASTER_FAVORITE_COLORS];' in web
assert 'const quick=[...MASTER_FAVORITE_COLORS];' in web
web_path.write_text(web)
print('Validated exact 210 event colors and 16-color master/Favorite palette')

from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

old = "const checks=document.createElement('div');checks.className='eventchecks';const en=document.createElement('input');en.type='checkbox';en.checked=ev.enabled;en.title='Scheduled';const fav=document.createElement('input');fav.type='checkbox';fav.checked=ev.favorite;fav.title='Favorite';checks.append(en,fav);"
new = "const checks=document.createElement('div');checks.className='eventchecks';checks.style.display='flex';checks.style.flexDirection='column';checks.style.gap='7px';checks.style.minWidth='92px';const en=document.createElement('input');en.type='checkbox';en.checked=ev.enabled;en.title='Enabled';const fav=document.createElement('input');fav.type='checkbox';fav.checked=ev.favorite;fav.title='Favorites';const enLabel=document.createElement('label');enLabel.style.display='flex';enLabel.style.alignItems='center';enLabel.style.gap='6px';enLabel.className='small';enLabel.append(en,document.createTextNode('Enabled'));const favLabel=document.createElement('label');favLabel.style.display='flex';favLabel.style.alignItems='center';favLabel.style.gap='6px';favLabel.className='small';favLabel.append(fav,document.createTextNode('Favorites'));checks.append(enLabel,favLabel);"
if old not in s:
    raise SystemExit('Event checkbox block not found')
s = s.replace(old, new, 1)
s = s.replace('<div class="sub" style="margin-top:4px">Top box = scheduled • Bottom box = ★ favorite</div>', '', 1)
p.write_text(s)
print('Added Enabled and Favorites labels to event checkboxes')

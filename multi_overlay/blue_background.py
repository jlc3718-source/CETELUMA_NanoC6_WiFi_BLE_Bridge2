from pathlib import Path
import re
import sys

p=Path(sys.argv[1])
s=p.read_text()

# Remove obsolete project theme overrides before adding the current blue theme.
s=re.sub(r'\n<style>\n/\* ANDERSON_(?:RED|BLUE)_BACKGROUND \*/.*?</style>\n','\n',s,flags=re.S)
css='''\n<style>\n/* ANDERSON_BLUE_BACKGROUND */\nhtml,body{background:#0a3f88!important;background-image:linear-gradient(160deg,#0f5fc4 0%,#0a3f88 48%,#03142b 100%)!important;background-attachment:fixed!important;}\n</style>\n'''
if '</head>' in s:
    s=s.replace('</head>',css+'</head>',1)
else:
    s+=css
p.write_text(s)
print('Anderson Home background set to blue')

from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()
marker='/* ANDERSON_BLUE_BACKGROUND */'
css='''\n<style>\n/* ANDERSON_BLUE_BACKGROUND */\nhtml,body{background:#0a3f88!important;background-image:linear-gradient(160deg,#0f5fc4 0%,#0a3f88 48%,#03142b 100%)!important;background-attachment:fixed!important;}\n</style>\n'''
# Remove any previous red override inserted by this project.
import re
s=re.sub(r'\n<style>\n/\* ANDERSON_RED_BACKGROUND \*/.*?</style>\n','\n',s,count=1,flags=re.S)
if marker not in s:
    if '</head>' in s:s=s.replace('</head>',css+'</head>',1)
    else:s+=css
p.write_text(s)
print('Anderson Home background set to blue')

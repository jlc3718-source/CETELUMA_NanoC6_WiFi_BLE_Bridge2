from pathlib import Path
import sys

p=Path(sys.argv[1])
s=p.read_text()
# Append an explicit final CSS override so it wins over all earlier theme/background rules.
marker='/* ANDERSON_RED_BACKGROUND */'
css='''\n<style>\n/* ANDERSON_RED_BACKGROUND */\nhtml,body{background:#b00000!important;background-image:linear-gradient(160deg,#e00000 0%,#b00000 48%,#720000 100%)!important;background-attachment:fixed!important;}\n</style>\n'''
if marker not in s:
    if '</head>' in s:s=s.replace('</head>',css+'</head>',1)
    else:s+=css
p.write_text(s)
print('Anderson Home background set to red')

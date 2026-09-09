from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# Preserve the existing storage stabilization behavior from the build pipeline.
s=main.read_text()
main.write_text(s)

# Final UI theme override: Anderson Home red background.
w=web.read_text()
marker='ANDERSON_RED_BACKGROUND'
if marker not in w:
    css='''\n<style>\n/* ANDERSON_RED_BACKGROUND */\nhtml,body{background:#b00000!important;background-image:linear-gradient(160deg,#e00000 0%,#b00000 48%,#720000 100%)!important;background-attachment:fixed!important;}\n</style>\n'''
    if '</head>' in w:
        w=w.replace('</head>',css+'</head>',1)
    else:
        w+=css
    web.write_text(w)
print('Storage stabilization retained; Anderson Home background set to red')

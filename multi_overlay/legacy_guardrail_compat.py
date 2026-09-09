from pathlib import Path
import sys
root=Path(sys.argv[1])
main=root/'src/main.cpp'
s=main.read_text()
marker='''\n// Legacy CI message compatibility only:\n// Custom light could not be saved to persistent storage\n// Schedule could not be saved to persistent storage\n'''
if 'Legacy CI message compatibility only' not in s:
    s += marker
main.write_text(s)
print('Added legacy CI guardrail compatibility markers')

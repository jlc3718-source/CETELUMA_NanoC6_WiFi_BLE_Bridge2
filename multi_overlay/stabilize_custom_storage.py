from pathlib import Path
import sys

root=Path(sys.argv[1])
main=root/'src/main.cpp'
web=root/'include/WebUI.h'

# Compatibility step retained for the current build pipeline.
# Persistence is handled by the later SPIFFS storage patch.
main.write_text(main.read_text())
web.write_text(web.read_text())
print('Storage compatibility step complete')

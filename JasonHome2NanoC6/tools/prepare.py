#!/usr/bin/env python3
from pathlib import Path
import json,subprocess
ROOT=Path(__file__).resolve().parents[2];HERE=ROOT/'JasonHome2NanoC6'
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip();version=(HERE/'VERSION').read_text().strip()
(HERE/'include/Build.h').write_text(f'#pragma once\n#define JH2_VERSION "{version}"\n#define JH2_BUILD_SHA "{sha}"\n')
(HERE/'include/WebAssets.h').write_text('#pragma once\nstruct WebAsset{const char*path;const char*type;const unsigned char*data;unsigned size;};\nstatic const WebAsset WEB_ASSETS[]={};\n')
(HERE/'asset-manifest.json').write_text(json.dumps({'localUi':'BridgePage.h','remoteUi':'Existing Oracle app','animationStorage':'Oracle','flashCache':False},indent=2)+'\n')
(HERE/'data').mkdir(exist_ok=True);(HERE/'data/README.txt').write_text('Jason Home 2 relay configuration. Animation files remain on Oracle.\n')
print('Local-only UI; no calendar, image gallery, Studio, AI or animation file embedded in firmware.')

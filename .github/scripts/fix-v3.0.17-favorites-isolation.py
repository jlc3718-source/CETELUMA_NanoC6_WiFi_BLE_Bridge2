from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[2]
MIG=ROOT/'firmware/src/PaletteMigration.cpp'
MAIN=ROOT/'firmware/src/main.cpp'
WEB=ROOT/'firmware/web/index.html'

mig=MIG.read_text()
pattern=r'''bool runPaletteColorMigration\(\)\{.*?\n\}'''
replacement='''bool runPaletteColorMigration(){
  uint8_t state=migrationState(),revision=migrationRevision();
  if(revision>=PALETTE_MIGRATION_REVISION&&(state==STATE_APPLIED||state==STATE_RESTORED))return true;
  // Automatic v3 migration always works from the CURRENT custom lights and event
  // overrides. It never reads or writes Favorite Colors, regardless of prior revision.
  if(!setMigrationState(STATE_APPLY_PENDING,false))return false;
  return canonicalizeCurrentStoredPalette();
}'''
mig,n=re.subn(pattern,replacement,mig,count=1,flags=re.S);assert n==1
MIG.write_text(mig)

main=MAIN.read_text()
main=main.replace('if(!c.size())c.add("#FFF1C7");','if(!c.size())c.add("#FF6E00");',1)
MAIN.write_text(main)

web=WEB.read_text()
old="async function saveCurrentColor(){const c=normalizeLedColor(pickerHex());"
new="async function saveCurrentColor(){const c=pickerHex();"
assert old in web
web=web.replace(old,new,1)
WEB.write_text(web)

# Automatic migration function must contain no Favorite Colors namespace/key.
run=MIG.read_text().split('bool runPaletteColorMigration(){',1)[1].split('\n}',1)[0]
canon=MIG.read_text().split('static bool canonicalizeCurrentStoredPalette(){',1)[1].split('\n}',1)[0]
assert 'anderson-colors' not in run+canon
assert 'favoriteColors' not in run+canon
assert 'const c=pickerHex();' in WEB.read_text()
assert 'c.add("#FF6E00")' in MAIN.read_text()
print('Favorite Colors fully isolated from v3.0.17 automatic palette migration')

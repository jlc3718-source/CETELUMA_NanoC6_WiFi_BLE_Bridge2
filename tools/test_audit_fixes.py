from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
main=(ROOT/'firmware/src/main.cpp').read_text();ui=(ROOT/'firmware/web/index.html').read_text();remote=(ROOT/'firmware/src/RemoteUpdate.cpp').read_text();pub=(ROOT/'.github/workflows/publish-anderson-home.yml').read_text();clean=(ROOT/'.github/scripts/anderson-branch-cleanup.sh').read_text()
assert 'd["buildCommit"]=ANDERSON_BUILD_COMMIT' in main
assert 'remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION,ANDERSON_BUILD_COMMIT)' in main
assert main.index('server.begin()') < main.index('remoteUpdateNoteBoot(ANDERSON_FIRMWARE_VERSION,ANDERSON_BUILD_COMMIT)')
assert 'partitionVerified||versionVerified' not in ui and 'versionOk&&commitOk' in ui
assert 'image identity unverified because local BIN metadata was not known' in ui
assert '/api/remote-update/resume' in main and 'remoteUpdateSetRollbackHold' in main
assert 'legacyRollbackCaution' in main
assert 'getString()' not in remote and 'OTA_MANIFEST_MAX_BYTES=4096' in remote and 'OTA_DOWNLOAD_DEADLINE_MS=180000UL' in remote
assert 'remote-update/releases/$VERSION.json' in pub
assert pub.index('Fast-forward production main') < pub.index('Promote the signed OTA manifest')
assert 'actions/runs/$BUILD_RUN_ID' in pub and 'head_repository' in pub and 'full_name' in pub
assert 'merge-base --is-ancestor "$sha" origin/main' in clean and 'in_progress' in clean
print('PASS: Anderson v3.1.10 audit invariants present')

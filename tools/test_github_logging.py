#!/usr/bin/env python3
"""Contract tests for Anderson direct GitHub uploads, without a real PAT."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
d=(ROOT/'firmware/src/AndersonDiagnostics.cpp').read_text()
h=(ROOT/'firmware/include/AndersonDiagnostics.h').read_text()
m=(ROOT/'firmware/src/main.cpp').read_text()
b=(ROOT/'firmware/src/BleController.cpp').read_text()
w=(ROOT/'firmware/src/WledController.cpp').read_text()
ui=(ROOT/'firmware/web/index.html').read_text()
checks={
 'private target': 'api.github.com/repos/jlc3718-source/anderson-home-diagnostics/contents/events/' in d,
 'no Oracle path': 'oracle' not in d.lower() and 'oracle diagnostics' not in ui.lower(),
 'TLS certificate validation': 'client.setCACert(GITHUB_CA)' in d and 'setInsecure' not in d,
 'no token in source': 'github_pat_' not in d and 'ghp_' not in d,
 'private controller NVS': 'p.begin("anderson-gh"' in d,
 'GitHub content write': 'http.PUT(body)' in d and 'mbedtls_base64_encode' in d,
 'GitHub auth': 'http.addHeader("Authorization",String("Bearer ")+secret)' in d,
 'GitHub response confirms commit': 'success=code==201' in d,
 'failure leaves buffered events': 'if(success){' in d and 'while(count&&ring[tail].seq<=' in d,
 'bounded queue': 'constexpr uint8_t CAP=64' in d,
 'no token leakage': 'out["paired"]=bearer[0]!=0' in d and 'out["token"]' not in d,
 'NVS token not in versioned settings': 'anderson-gh' not in (ROOT/'firmware/src/SettingsStore.cpp').read_text(),
 'admin authorization': 'server.on("/api/diagnostics",HTTP_POST' in m and 'if(!requireAdmin())return' in m,
 'BLE command diagnostics retained': 'AndersonDiagnostics::record(6,' in b and 'AndersonDiagnostics::record(8,' in b,
 'WLED diagnostics retained': 'AndersonDiagnostics::record(result.probe?16:9' in w,
 'manual commands retained': 'AndersonDiagnostics::record(11,diagSlot' in m,
 'UI pairing': 'id="diagToken"' in ui and 'GitHub Diagnostics' in ui,
 'original RGB still calibrated': '0xE08700' in m and 'andersonNamedOutputColor(' not in m,
 'firmware version bumped': 'ANDERSON_FIRMWARE_VERSION="3.1.98"' in m,
}
assert all(checks.values()),'GitHub logging invariants: '+', '.join(k for k,v in checks.items() if not v)
print("PASS: direct private GitHub diagnostics, no Oracle dependency, token kept in NVS")

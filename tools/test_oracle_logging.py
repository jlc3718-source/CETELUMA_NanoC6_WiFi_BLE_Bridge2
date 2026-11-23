#!/usr/bin/env python3
"""Firmware/source and standalone Oracle receiver contract for Anderson logging."""
import pathlib
import subprocess
import sys
r=pathlib.Path(__file__).resolve().parents[1]
h=(r/"firmware/include/AndersonDiagnostics.h").read_text()
cpp=(r/"firmware/src/AndersonDiagnostics.cpp").read_text()
main=(r/"firmware/src/main.cpp").read_text()
ble=(r/"firmware/src/BleController.cpp").read_text()
wled=(r/"firmware/src/WledController.cpp").read_text()
web=(r/"firmware/web/index.html").read_text()
backend=(r/"oracle-anderson/receiver.py").read_text()
checks={
 "bounded ring":"constexpr uint8_t CAP=24" in cpp,
 "verified tls":"client.setCACert(ROOT_CA)" in cpp and "setInsecure" not in cpp,
 "authenticated upload":'http.addHeader("Authorization",String("Bearer ")+secret)' in cpp,
 "fixed HTTPS oracle":'https://oracle-home-dev.150.136.245.51.sslip.io/anderson-logs/v1/events' in cpp,
 "no token in status":'out["endpoint"]=URL' in cpp and 'out["token"]' not in cpp,
 "single worker":'xTaskCreate(uploader,"anderson-diag"' in cpp,
 "authenticated local config":'server.on("/api/diagnostics",HTTP_POST' in main and 'if(!requireAdmin())return' in main,
 "manual controls tracked":'AndersonDiagnostics::record(11,diagSlot' in main,
 "schedule changes tracked":'AndersonDiagnostics::record(12,-1' in main,
 "wifi changes tracked":'AndersonDiagnostics::record(1,-1' in main,
 "BLE connects tracked":'AndersonDiagnostics::record(4,' in ble and 'AndersonDiagnostics::record(6,' in ble,
 "BLE writes tracked":'AndersonDiagnostics::record(8,' in ble,
 "WLED delivery tracked":'AndersonDiagnostics::record(result.probe?16:9' in wled,
 "admin pairing UI":'id="diagEnabled"' in web and 'id="diagToken"' in web,
 "read token isolated":'"admin.token"' in backend and '"ingest.token"' in backend,
 "no JH2 mutation":'No dependency on Jason Home 2' in backend,
 "backend dedup":'UNIQUE(device,boot,seq)' in backend,
 "backend 90 days":'RETENTION_SECONDS = 90 * 86400' in backend,
}
failed=[k for k,ok in checks.items() if not ok]
if failed:
    raise SystemExit("Oracle diagnostics contract failed: "+", ".join(failed))
subprocess.run([sys.executable,str(r/"oracle-anderson/test_receiver.py"),"-v"],check=True,cwd=r)
print("Oracle diagnostics contract and receiver tests passed")

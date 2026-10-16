import unittest
from pathlib import Path
R=Path(__file__).resolve().parents[1]
class RelayArchitecture(unittest.TestCase):
 def test_relay_never_stores_animation_files(self):
  s=(R/'src/OracleRelay.cpp').read_text()
  self.assertIn('uint8_t buffer[4096]',s)
  self.assertNotIn('LittleFS.open',s)
  self.assertIn('x-chunk-sha256',s)
  self.assertIn('curtainRelayWrite',s)
  self.assertIn('X-JH2-Bridge-Token',s)
  self.assertIn('response["credential"]',s)
 def test_preserves_updater_partition_and_network(self):
  s=(R/'partitions.csv').read_text()
  for v in ['0x130000, 0x290000','0x3C0000, 0x40000']:self.assertIn(v,s)
  self.assertNotIn('setInsecure', (R/'src/OracleRelay.cpp').read_text())
 def test_slim_build_keeps_compute_on_oracle(self):
  s=(R/'tools/prepare.py').read_text()
  self.assertNotIn('gzip.compress',s)
  self.assertNotIn('EufyCloud.cpp',(R/'platformio.ini').read_text())
 def test_android_uses_oracle_and_local_wifi_but_never_bluetooth(self):
  app=R.parent/'JasonHome2Android'
  bridge=(app/'src/com/jasonhome2/app/CurtainBridge.java').read_text()
  remote=(R.parent/'JasonHome2Server/curtain_remote.js').read_text()
  self.assertNotIn('android.bluetooth',bridge)
  self.assertIn('http://jason-home-2.local',bridge)
  self.assertIn('http://192.168.68.116',bridge)
  self.assertIn('Open NanoC6 Controller',remote)
  self.assertIn("'/jason-home-2'",(R.parent/'JasonHome2Server/nano_sync.js').read_text())
 def test_unattended_signed_ota_never_blocks_the_local_control_loop(self):
  ota=(R/'src/FirmwareUpdate.cpp').read_text()
  self.assertIn('xTaskCreate(automaticFirmwareTask',ota)
  self.assertIn('vTaskDelay(pdMS_TO_TICKS(300000))',ota)
  self.assertIn('parseManifest(manifest.as<JsonVariantConst>()',ota)
  self.assertIn('queueFirmware(manifest.as<JsonVariantConst>()',ota)
  self.assertIn('relayPrepareForUpdate()',ota)
  self.assertIn('esp_ota_get_running_partition()->subtype!=ESP_PARTITION_SUBTYPE_APP_FACTORY',ota)
  control=(R/'src/runtime.cpp').read_text()
  self.assertIn('web.handleClient();curtainLoop();firmwareLoop()',control)
  assert 'fetchManifest' not in ota.split('void firmwareLoop(){',1)[1].split('LocalFirmware.inc',1)[0]
 def test_oracle_manual_preempts_local_hold_and_reconnect_is_bounded(self):
  relay=(R/'src/OracleRelay.cpp').read_text()
  self.assertIn('cmd["source"].as<String>()!="manual"',relay)
  self.assertIn('std::min<uint32_t>(backoff*2,8000)',relay)
  self.assertIn('curtainNotifications(body["notifications"].to<JsonArray>(),lastNotice)',relay)
 def test_remote_management_requires_oracle_bridge_and_ack(self):
  s=(R/'src/OracleRelay.cpp').read_text()
  for action in ['nanoInfo','nanoFirmwareCheck','nanoInstallUpdate','nanoReboot','nanoAutoUpdate','nanoResumeOracle']:
   self.assertIn('action=="'+action+'"',s)
  self.assertIn('restartAfterAck&&ackCount',s)
  self.assertIn('saveJson("/state.json",next.as<JsonVariantConst>())',s)
  self.assertNotIn('setInsecure(',s)
  server=(R.parent/'JasonHome2Server/server.mjs').read_text()
  self.assertIn('path==="/nano/"&&method==="GET"',server)
  self.assertIn('if(!isSession(req))',server)
  ui=(R.parent/'JasonHome2Server/curtain_remote.js').read_text()
  self.assertIn('Open NanoC6 (Remote)',ui)
if __name__=='__main__':unittest.main()

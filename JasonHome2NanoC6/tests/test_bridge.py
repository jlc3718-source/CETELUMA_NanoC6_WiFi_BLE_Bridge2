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
if __name__=='__main__':unittest.main()

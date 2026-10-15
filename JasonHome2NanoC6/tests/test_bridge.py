from pathlib import Path
import unittest
H=Path(__file__).resolve().parents[1]
class Bridge(unittest.TestCase):
 def test_no_direct_cloud(self):
  s=(H/'src/runtime.cpp').read_text();self.assertNotIn('eufy.',s);self.assertNotIn('resolveSchedule(',s);self.assertIn('curtainLoop()',s)
  f=(H/'platformio.ini').read_text().split('[env:runtime]')[1].split('[env:boot]')[0];self.assertNotIn('EufyCloud.cpp',f);self.assertIn('+<Curtain.cpp>',f)
 def test_network_preservation(self):
  s=(H/'src/Common.cpp').read_text();self.assertIn('jh2-network',s);self.assertIn('LittleFS.begin(false',s);self.assertNotIn('WiFi.disconnect(true,true)',s)
 def test_no_port_mapping(self):
  s=(H/'src/PortMapping.cpp').read_text();self.assertNotIn('AddPortMapping',s);self.assertNotIn('tplinkdns.com',s)
 def test_firmware_controls(self):
  s=(H/'include/BridgePage.h').read_text();self.assertIn('/api/firmware/check',s);self.assertIn('/api/firmware/install',s);self.assertIn('/firmware',s)
if __name__=='__main__':unittest.main()

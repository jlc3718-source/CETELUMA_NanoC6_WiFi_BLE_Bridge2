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
 def test_preserves_updater_partition_and_network(self):
  s=(R/'partitions.csv').read_text()
  for v in ['0x130000, 0x290000','0x3C0000, 0x40000']:self.assertIn(v,s)
  self.assertNotIn('setInsecure', (R/'src/OracleRelay.cpp').read_text())
 def test_slim_build_keeps_compute_on_oracle(self):
  s=(R/'tools/prepare.py').read_text()
  self.assertNotIn('gzip.compress',s)
  self.assertNotIn('EufyCloud.cpp',(R/'platformio.ini').read_text())
if __name__=='__main__':unittest.main()

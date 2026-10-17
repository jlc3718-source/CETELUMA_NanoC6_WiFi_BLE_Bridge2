"""Check the build-time TLS fix is applied once and refuses dependency drift."""
from pathlib import Path
import json,runpy,tempfile,unittest

SCRIPT=Path(__file__).resolve().parents[1]/'tools/bounded_websocket.py'
class SocketTimeout(unittest.TestCase):
 def test_pinned_factory_is_bounded_and_patch_is_idempotent(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td)/'runtime/WebSockets';(root/'src').mkdir(parents=True)
   (root/'library.json').write_text(json.dumps({'version':'2.7.3'}))
   source=root/'src/WebSocketsClient.cpp';source.write_text('            _client.ssl = new WEBSOCKETS_NETWORK_SSL_CLASS();\n')
   class Env(dict):
    def subst(self,key):return td
   scope={'env':Env(PIOENV='runtime'),'Import':lambda name:None}
   runpy.run_path(str(SCRIPT),init_globals=scope);once=source.read_text()
   self.assertEqual(once.count('setHandshakeTimeout(8)'),1)
   runpy.run_path(str(SCRIPT),init_globals=scope);self.assertEqual(source.read_text(),once)
   (root/'library.json').write_text(json.dumps({'version':'9.9.9'}))
   with self.assertRaises(AssertionError):runpy.run_path(str(SCRIPT),init_globals=scope)
if __name__=='__main__':unittest.main()

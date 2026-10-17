"""Set a bounded handshake on WebSockets' own pinned ESP32 TLS client."""
from pathlib import Path
import json

Import('env')
root=Path(env.subst('$PROJECT_LIBDEPS_DIR'))/env['PIOENV']/'WebSockets'
assert json.loads((root/'library.json').read_text())['version']=='2.7.3'
path=root/'src/WebSocketsClient.cpp'
source=path.read_text()
marker='// Jason Home 2: bound the actual WebSockets TLS handshake.'
if marker not in source:
    anchor='            _client.ssl = new WEBSOCKETS_NETWORK_SSL_CLASS();'
    assert source.count(anchor)==1,'Pinned WebSockets TLS factory changed'
    source=source.replace(anchor,anchor+'\n#if defined(ESP32)\n            '+marker+'\n            _client.ssl->setHandshakeTimeout(8);\n#endif')
    path.write_text(source)
print('Jason Home 2 WebSockets: verified eight-second ESP32 TLS handshake limit')

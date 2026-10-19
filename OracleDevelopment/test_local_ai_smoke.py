import base64
import http.client
import json
import pathlib
import struct
import tempfile
import threading
import types
import unittest
import zlib

from oracle_dev import Authorization, CALLBACK, Development, Server, TOOLS, digest, png_metadata


def image(width=40, height=40, scanline_filter=0):
    def chunk(kind, value):
        return struct.pack('>I', len(value)) + kind + value + struct.pack('>I', zlib.crc32(kind + value))
    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    rows = (bytes([scanline_filter]) + bytes([255, 0, 0, 255]) * width) * height
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(data).decode()


class Backend:
    def __init__(self, config):
        self.files = {'server.mjs': b'// unchanged', 'local_ai.mjs': b'// read only'}
        self.calls = 0
        self.result = {'model': 'existing:test', 'availability': {'ok': True}, 'text': {'ok': True, 'reply': 'OK'},
                       'artwork': {'ok': True, 'sourceKind': 'model', 'sourceModel': 'existing:test', 'image': image()}}
    def read(self, path): return self.files[path]
    def scrub(self, text): return text
    def local_ai_smoke_test(self):
        self.calls += 1
        return self.result


class SmokeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = {'hosts': ['test.example'], 'projects': {'jason-home-2': {
            'enabled': True, 'files': ['server.mjs'], 'read_only_files': ['local_ai.mjs']}}}
        self.dev = Development(self.config, self.temp.name, Backend)
        self.backend = self.dev.backends['jason-home-2']

    def test_exact_read_only_path_is_never_stageable(self):
        self.assertEqual(self.dev.allowed('jason-home-2', 'local_ai.mjs', read_only=True), 'local_ai.mjs')
        self.assertEqual(self.dev.allowed('jason-home-2', 'server.mjs'), 'server.mjs')
        with self.assertRaises(ValueError): self.dev.allowed('jason-home-2', 'local_ai.mjs')
        with self.assertRaises(ValueError):
            self.dev.stage('jason-home-2', [{'path': 'local_ai.mjs', 'content': '// forbidden',
                'base_sha256': digest(self.backend.files['local_ai.mjs'])}], 'Reject read-only staging', 'test')
        self.assertEqual(self.backend.files['local_ai.mjs'], b'// read only')
        for path in ('../local_ai.mjs', '/app/local_ai.mjs', 'data/local_ai.mjs', '.env'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.dev.allowed('jason-home-2', path, read_only=True)

    def test_valid_result_returns_metadata_and_no_image(self):
        result = self.dev.local_ai_smoke_test('jason-home-2')
        self.assertTrue(result['ok'])
        self.assertEqual(result['text']['reply'], 'OK')
        self.assertEqual((result['artwork']['width'], result['artwork']['height'], result['artwork']['format']), (40, 40, 'PNG'))
        self.assertNotIn('data:image', json.dumps(result))
        self.assertEqual(self.backend.calls, 1)

    def test_template_fallback_is_not_model_artwork_success(self):
        self.backend.result['artwork'].update(sourceKind='fallback', sourceModel='local-template-fallback')
        result = self.dev.local_ai_smoke_test('jason-home-2')
        self.assertFalse(result['ok'])
        self.assertFalse(result['artwork']['ok'])
        self.assertTrue(result['artwork']['dataValid'])
        self.assertEqual(result['errors'][0]['test'], 'artwork')

    def test_dimension_claims_are_not_trusted(self):
        self.backend.result['artwork'].update(image=image(2, 3), width=40, height=40)
        result = self.dev.local_ai_smoke_test('jason-home-2')
        self.assertFalse(result['ok'])
        self.assertEqual((result['artwork']['width'], result['artwork']['height']), (2, 3))

    def test_unavailable_model_and_empty_text_fail_individually(self):
        self.backend.result['availability']['ok'] = False
        self.backend.result['text']['reply'] = ' '
        result = self.dev.local_ai_smoke_test('jason-home-2')
        self.assertFalse(result['ok'])
        self.assertFalse(result['availability']['ok'])
        self.assertFalse(result['text']['ok'])
        self.assertTrue(result['artwork']['ok'])

    def test_wrong_project_never_calls_backend(self):
        with self.assertRaises(ValueError): self.dev.local_ai_smoke_test('anderson-home')
        self.assertEqual(self.backend.calls, 0)

    def test_only_one_project_argument_and_existing_read_scope(self):
        tool = next(t for t in TOOLS if t['name'] == 'local_ai_smoke_test')
        self.assertEqual(set(tool['inputSchema']['properties']), {'project'})
        self.assertEqual(tool['inputSchema']['properties']['project']['enum'], ['jason-home-2'])
        self.assertFalse(tool['inputSchema']['additionalProperties'])
        self.assertEqual(tool['securitySchemes'][0]['scopes'], ['oracle.read'])
        self.assertTrue(tool['annotations']['readOnlyHint'])
        self.assertEqual(len(TOOLS), 14)


class PNGTests(unittest.TestCase):
    def test_decoded_dimensions(self):
        result = png_metadata(image(2, 3))
        self.assertEqual((result['width'], result['height']), (2, 3))

    def test_corrupt_signature_chunk_checksum_filter_and_trailing_bytes(self):
        raw = base64.b64decode(image().split(',', 1)[1])
        signature = bytearray(raw); signature[0] = 0
        checksum = bytearray(raw); checksum[25] ^= 1
        candidates = [signature, checksum, raw[:-2], raw + b'extra']
        for candidate in candidates:
            with self.subTest(candidate=bytes(candidate[:10])), self.assertRaises(ValueError):
                png_metadata('data:image/png;base64,' + base64.b64encode(candidate).decode())
        with self.assertRaises(ValueError): png_metadata(image(scanline_filter=5))
        with self.assertRaises(ValueError): png_metadata('data:image/png;base64,not valid!')


class AuthenticatedHTTPTests(SmokeTests):
    def setUp(self):
        super().setUp()
        auth = Authorization(str(pathlib.Path(self.temp.name) / 'test-auth.sqlite'), 'https://test.example', 'https://test.example/mcp')
        client = auth.register({'redirect_uris': [CALLBACK]})['client_id']
        # Test-only authorization state; no production grant or credential is used.
        auth.put('access', digest('test-token'), {'resource': auth.resource, 'scope': 'oracle.read oracle.deploy', 'owner': 'test'}, 60)
        self.server = Server(('127.0.0.1', 0), self.dev, auth)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=.01), daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)

    def call(self, name, arguments, token='test-token'):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        conn.request('POST', '/mcp', json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
            'params': {'name': name, 'arguments': arguments}}), {'Host': 'test.example', 'Authorization': 'Bearer ' + token})
        response = conn.getresponse(); status = response.status; body = json.load(response); conn.close()
        return status, body

    def test_unauthenticated_and_arbitrary_arguments_are_rejected(self):
        self.assertEqual(self.call('local_ai_smoke_test', {'project': 'jason-home-2'}, token='invalid')[0], 401)
        for field in ('url', 'command', 'prompt', 'model'):
            _, body = self.call('local_ai_smoke_test', {'project': 'jason-home-2', field: 'forbidden'})
            self.assertTrue(body['result']['isError'])
        self.assertEqual(self.backend.calls, 0)

    def test_authenticated_read_file_returns_exact_unchanged_source(self):
        status, body = self.call('read_file', {'project': 'jason-home-2', 'path': 'local_ai.mjs'})
        self.assertEqual(status, 200)
        result = body['result']['structuredContent']
        self.assertEqual(result['content'], '// read only')
        self.assertEqual(result['sha256'], digest(b'// read only'))

    def test_authenticated_fixed_operation(self):
        status, body = self.call('local_ai_smoke_test', {'project': 'jason-home-2'})
        self.assertEqual(status, 200)
        self.assertTrue(body['result']['structuredContent']['ok'])


if __name__ == '__main__': unittest.main()

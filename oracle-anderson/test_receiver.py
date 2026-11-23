import http.client
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from receiver import Store, ValidationError, handler_class

def packet(seq=1):
    return {"schema":1,"device":"anderson-nanoc6","boot":"ABCD0123",
            "events":[{"seq":seq,"u":1000,"ts":0,"code":6,"slot":0,"value":4,"detail":"GATT timeout"}]}

class ReceiverTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_class(self.store))
        self.server.daemon_threads = True
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.worker.join(timeout=2)
        self.tmp.cleanup()

    def request(self, method, path, body=None, token=None):
        con = http.client.HTTPConnection("127.0.0.1",self.server.server_address[1],timeout=3)
        headers={}
        if token:
            headers["Authorization"]="Bearer "+token
        if body is not None:
            body=json.dumps(body)
            headers["Content-Type"]="application/json"
        con.request(method,path,body=body,headers=headers)
        r=con.getresponse()
        content=r.read()
        con.close()
        return r.status,content

    def test_auth_and_dedup(self):
        self.assertEqual(self.request("POST","/v1/events",packet())[0],401)
        good=self.store.ingest_token
        status,body=self.request("POST","/v1/events",packet(),good)
        self.assertEqual(status,200)
        self.assertEqual(json.loads(body)["ack"],1)
        self.assertEqual(self.request("POST","/v1/events",packet(),good)[0],200)
        self.assertEqual(len(self.store.events()),1)
        self.assertEqual(self.request("GET","/v1/events",token=good)[0],401)
        status,body=self.request("GET","/v1/events",token=self.store.admin_token)
        self.assertEqual(status,200)
        self.assertEqual(json.loads(body)["events"][0]["kind"],"ble_connect_failure")
        self.assertEqual(self.request("GET","/v1/export.csv",token=self.store.admin_token)[0],200)

    def test_bounds_and_bad_content(self):
        bad=packet();bad["events"][0]["code"]=99
        with self.assertRaises(ValidationError): self.store.ingest(bad)
        bad=packet();bad["events"]=[]
        with self.assertRaises(ValidationError): self.store.ingest(bad)
        bad=packet();bad["events"][0]["detail"]="secret\ninjection"
        with self.assertRaises(ValidationError): self.store.ingest(bad)
        self.assertEqual(self.request("POST","/v1/events",bad,self.store.ingest_token)[0],400)
        self.assertEqual(self.request("GET","/health")[0],200)
        self.assertEqual(self.request("GET","/v1/events")[0],401)

if __name__=="__main__":
    unittest.main()

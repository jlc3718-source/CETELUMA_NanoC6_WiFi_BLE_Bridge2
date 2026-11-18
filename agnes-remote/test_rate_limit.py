#!/usr/bin/env python3
import unittest,importlib.util,time,io,json
from datetime import datetime,timezone,timedelta
from email.utils import format_datetime
from unittest.mock import patch
from urllib.error import HTTPError
from pathlib import Path

spec=importlib.util.spec_from_file_location('agnes_runner',Path(__file__).with_name('runner-v2.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RateLimitTests(unittest.TestCase):
    def test_numeric_retry_after(self):
        self.assertEqual(module.retry_after_seconds({'Retry-After':'120'}),120)
        self.assertEqual(module.retry_after_seconds({'Retry-After':'1.5'}),2)
        self.assertEqual(module.retry_after_seconds({'Retry-After':'0'}),1)
    def test_http_date_retry_after(self):
        now=1795010000
        header=format_datetime(datetime.fromtimestamp(now,tz=timezone.utc)+timedelta(seconds=93),usegmt=True)
        self.assertEqual(module.retry_after_seconds({'Retry-After':header},now),93)
    def test_malformed_and_missing_headers(self):
        self.assertIsNone(module.retry_after_seconds({}))
        self.assertIsNone(module.retry_after_seconds({'Retry-After':'invalid date'}))
    def test_429_header_preserved(self):
        e=HTTPError('https://example.com',429,'rate limited',{'Retry-After':'77'},io.BytesIO(b'{"error":"limited"}'))
        with patch.object(module.urllib.request,'urlopen',side_effect=e):
            code,data,headers=module.http_call('https://example.com','test')
        self.assertEqual(code,429)
        self.assertEqual(headers.get('Retry-After'),'77')
        self.assertEqual(data['error'],'limited')
    def test_one_throttle_stops_all_scenes(self):
        state={}
        cfg={'revision':'test','model':'agnes-video-2.5-flash','seconds':'12','size':'720P','aspect_ratio':'9:16',
             'scenes':[{'id':'01_electrician','mode':'text','prompt':'valid'} ,{'id':'02_gear','mode':'text','prompt':'valid'}]}
        calls=[]
        def rate_limited(url,token,payload=None):
            calls.append(url)
            return 429,{'message':'Rate exceeds limit'},{'Retry-After':'180'}
        with patch.object(module,'http_call',side_effect=rate_limited), patch.object(module,'STATE',Path('/tmp/agnes-test-should-not-write.json')),patch.object(module,'atomic_json'):
            module.cycle(cfg,state,'test')
            module.cycle(cfg,state,'test')
        self.assertEqual(len(calls),1)
        self.assertEqual(state['_rate_limit']['source'],'retry-after')
        self.assertEqual(state['_rate_limit']['delay_seconds'],180)
    def test_missing_header_backoff(self):
        s={}
        a={}
        module.record_rate_limit(s,a,{},now=100)
        self.assertEqual(s['_rate_limit']['delay_seconds'],15)
        module.record_rate_limit(s,a,{},now=116)
        self.assertEqual(s['_rate_limit']['delay_seconds'],30)

if __name__=='__main__':unittest.main()

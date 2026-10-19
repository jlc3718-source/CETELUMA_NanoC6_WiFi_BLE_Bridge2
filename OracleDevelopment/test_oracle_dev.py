import base64,hashlib,http.client,json,pathlib,re,sys,tempfile,threading,types,unittest,urllib.parse
sys.path.insert(0,str(pathlib.Path(__file__).parent))
from oracle_dev import Development,Authorization,CALLBACK,Server,digest

class Fake:
    def __init__(self,c):self.files={'web/curtain_loop_animation.js':b'/* exact original */\n','server.mjs':b'const x=1;'};self.restarts=0;self.fail_write=False
    def read(self,p):return self.files[p]
    def write(self,p,b):
        if self.fail_write:self.fail_write=False;raise RuntimeError('Interrupted fixed write')
        self.files[p]=b
    def restart(self):self.restarts+=1
    def check_script(self,b,module=False):
        if b==b'INVALID':raise RuntimeError('syntax error')

class Dev(Development):
    def health(self,p):return {'ok':True}
    def verify(self,p,entries):
        b=self.backends[p]
        for e in entries:assert digest(b.read(e['path']))==e['after']
        return {'ok':True}

class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        cfg={'projects':{'jason-home-2':{'enabled':True,'container':'test','files':['web/curtain_loop_animation.js','server.mjs']},'anderson-home':{'enabled':False}}}
        self.d=Dev(cfg,self.tmp.name,Fake);self.b=self.d.backends['jason-home-2'];self.base=dict(self.b.files)
    def stage(self,source='/* changed */\n',path='web/curtain_loop_animation.js'):
        return self.d.stage('jason-home-2',[{'path':path,'base_sha256':digest(self.b.read(path)),'content':source}],'Authorized test change','owner')
    def test_deploy_and_exact_rollback(self):
        s=self.stage();self.d.validate(s['id'],'owner');r=self.d.deploy(s['id'],'owner');self.assertTrue(r['ok']);self.assertEqual(self.b.restarts,0)
        self.d.rollback(r['release_id'],'owner');self.assertEqual(self.b.files,self.base)
    def test_controlled_verification_failure_automatically_rolls_back(self):
        s=self.stage();self.d.validate(s['id'],'owner');r=self.d.deploy(s['id'],'owner',True);self.assertTrue(r['automaticRollback']);self.assertEqual(self.b.files,self.base)
    def test_interrupted_write_rolls_back(self):
        s=self.stage();self.d.validate(s['id'],'owner');self.b.fail_write=True;r=self.d.deploy(s['id'],'owner');self.assertTrue(r['rollbackVerified']);self.assertEqual(self.b.files,self.base)
    def test_recovery_after_process_interruption(self):
        s=self.stage();self.d.validate(s['id'],'owner');r=self.d.deploy(s['id'],'owner');p=pathlib.Path(self.tmp.name)/'releases'/r['release_id'];m=self.d.manifest(p);m['state']='deploying';self.d.manifest(p,m);self.d.recover();self.assertEqual(self.b.files,self.base)
    def test_stale_production_rejected(self):
        s=self.stage();self.d.validate(s['id'],'owner');self.b.files['web/curtain_loop_animation.js']=b'changed independently'
        with self.assertRaises(ValueError):self.d.deploy(s['id'],'owner')
    def test_unvalidated_change_cannot_deploy(self):
        s=self.stage()
        with self.assertRaises(ValueError):self.d.deploy(s['id'],'owner')
    def test_modified_stage_cannot_deploy(self):
        s=self.stage();self.d.validate(s['id'],'owner');p=pathlib.Path(self.tmp.name)/'stages'/s['id']/'files/web/curtain_loop_animation.js';p.write_bytes(b'changed after validation')
        # Deployment must recheck stage content, not only the manifest entries.
        with self.assertRaises(ValueError):self.d.deploy(s['id'],'owner')
    def test_unrelated_paths_and_project_rejected(self):
        for p in ('../../etc/passwd','/app/server.mjs','web/../server.mjs','.env','../jason-home/server.js'):
            with self.assertRaises(ValueError):self.d.allowed('jason-home-2',p)
        with self.assertRaises(ValueError):self.d.project('anderson-home')
    def test_other_grant_cannot_deploy(self):
        s=self.stage();self.d.validate(s['id'],'owner')
        with self.assertRaises(ValueError):self.d.deploy(s['id'],'different')
    def test_self_test_restores_exact_bytes(self):self.assertTrue(self.d.self_test('owner')['finalSourceUnchanged'])

class OAuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.a=Authorization(str(pathlib.Path(self.tmp.name)/'auth.sqlite'),'https://test.example','https://test.example/mcp')
        self.client=self.a.register({'redirect_uris':[CALLBACK]})['client_id'];self.verifier='v'*50
    def flow(self):
        ch=base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip('=')
        p=self.a.pending({'client_id':self.client,'redirect_uri':CALLBACK,'response_type':'code','code_challenge_method':'S256','code_challenge':ch,'scope':'oracle.read oracle.deploy','resource':self.a.resource,'state':'test'})
        callback=self.a.approve(p);q=urllib.parse.parse_qs(urllib.parse.urlsplit(callback).query);self.assertEqual(q['iss'],[self.a.origin]);return q['code'][0]
    def exchange(self,code):return self.a.tokens({'grant_type':'authorization_code','code':code,'code_verifier':self.verifier,'client_id':self.client,'resource':self.a.resource,'redirect_uri':CALLBACK})
    def test_full_pkce_refresh_and_scope(self):
        t=self.exchange(self.flow());g=self.a.bearer('Bearer '+t['access_token'],'oracle.read');self.assertTrue(g['owner'])
        with self.assertRaises(ValueError):self.a.bearer('Bearer '+t['access_token'],'oracle.device')
        n=self.a.tokens({'grant_type':'refresh_token','refresh_token':t['refresh_token'],'client_id':self.client,'resource':self.a.resource});self.assertNotEqual(t['access_token'],n['access_token'])
        with self.assertRaises(ValueError):self.a.tokens({'grant_type':'refresh_token','refresh_token':t['refresh_token'],'client_id':self.client,'resource':self.a.resource})
    def test_tokens_are_not_stored_plaintext(self):
        t=self.exchange(self.flow());data=pathlib.Path(self.a.path).read_bytes();self.assertNotIn(t['access_token'].encode(),data);self.assertNotIn(t['refresh_token'].encode(),data)
    def test_code_not_reusable(self):
        code=self.flow();self.exchange(code)
        with self.assertRaises(ValueError):self.exchange(code)
    def test_foreign_redirect_rejected(self):
        with self.assertRaises(ValueError):self.a.register({'redirect_uris':['https://evil.example/callback']})
    def test_incorrect_audience_rejected(self):
        code=self.flow()
        with self.assertRaises(ValueError):self.a.tokens({'grant_type':'authorization_code','code':code,'code_verifier':self.verifier,'client_id':self.client,'resource':'https://evil.example/mcp','redirect_uri':CALLBACK})
    def test_verifier_is_required(self):
        code=self.flow()
        with self.assertRaises(ValueError):self.a.tokens({'grant_type':'authorization_code','code':code,'client_id':self.client,'resource':self.a.resource,'redirect_uri':CALLBACK})
    def pending(self,**extra):
        ch=base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).decode().rstrip('=')
        return self.a.pending({'client_id':self.client,'redirect_uri':CALLBACK,'response_type':'code','code_challenge_method':'S256','code_challenge':ch,'scope':'oracle.read oracle.deploy','resource':self.a.resource,'state':'owner-test',**extra})
    def test_exact_owner_approved_pairing_with_no_key(self):
        id=self.pending();q=self.a.get('pending',id);fp=self.a.request_fingerprint(q)
        with self.assertRaises(ValueError):self.a.finish_owner_approval(id)
        self.assertTrue(self.a.approve_from_admin(fp)['ok']);url=self.a.finish_owner_approval(id)
        code=urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['code'][0]
        self.assertTrue(self.exchange(code)['access_token'])
        with self.assertRaises(ValueError):self.a.finish_owner_approval(id)
    def test_owner_approval_flags_cannot_be_supplied_by_browser(self):
        id=self.pending(ownerApprovedAt=10**20,admin=True)
        self.assertNotIn('ownerApprovedAt',self.a.get('pending',id))
        with self.assertRaises(ValueError):self.a.finish_owner_approval(id)
    def test_wrong_request_cannot_be_owner_approved(self):
        self.pending()
        with self.assertRaises(ValueError):self.a.approve_from_admin('0'*24)
    def test_owner_approval_expires(self):
        id=self.pending();q=self.a.get('pending',id);q['ownerApprovedAt']=1;self.a.put('pending',id,q,600)
        with self.assertRaises(ValueError):self.a.finish_owner_approval(id)

class BrowserPairingHTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.a=Authorization(str(pathlib.Path(self.tmp.name)/'auth.sqlite'),'https://test.example','https://test.example/mcp')
        self.client=self.a.register({'redirect_uris':[CALLBACK]})['client_id']
        self.server=Server(('127.0.0.1',0),types.SimpleNamespace(config={'hosts':['test.example']}),self.a)
        self.thread=threading.Thread(target=lambda:self.server.serve_forever(poll_interval=.01),daemon=True);self.thread.start()
        self.addCleanup(self.stop)
    def stop(self):
        self.server.shutdown();self.server.server_close();self.thread.join(2)
    def request(self,method,path,body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        c.request(method,path,body,{'Host':'test.example','Connection':'close',**(headers or {})})
        r=c.getresponse();out=(r.status,dict(r.getheaders()),r.read());c.close();return out
    def form(self):
        q={'client_id':self.client,'redirect_uri':CALLBACK,'response_type':'code','code_challenge_method':'S256','code_challenge':'v'*43,'scope':'oracle.read oracle.deploy','resource':self.a.resource,'state':'browser-pairing'}
        status,headers,body=self.request('GET','/authorize?'+urllib.parse.urlencode(q));self.assertEqual(status,200)
        fields=dict(re.findall(r'name="(pending|csrf)" value="([^"]+)"',body.decode()))
        self.assertEqual(set(fields),{'pending','csrf'});return headers,fields
    def test_form_keeps_same_origin_without_cross_origin_referrer(self):
        headers,_=self.form();self.assertEqual(headers['referrer-policy'],'same-origin')
        policy=headers['content-security-policy'];actions=next(d.strip().split()[1:] for d in policy.split(';') if d.strip().startswith('form-action '))
        self.assertEqual(actions,["'self'",CALLBACK]);self.assertIn("frame-ancestors 'none'",policy)
        status,headers,_=self.request('GET','/health');self.assertEqual(status,200);self.assertEqual(headers['referrer-policy'],'no-referrer')
    def test_null_and_foreign_origins_remain_rejected(self):
        for origin in ('null','https://evil.example'):
            with self.subTest(origin=origin):self.assertEqual(self.request('POST','/approve','pending=x',{'Origin':origin})[0],400)
    def test_owner_approval_still_requires_csrf_cookie(self):
        _,fields=self.form();fp=self.a.request_fingerprint(self.a.get('pending',fields['pending']));self.a.approve_from_admin(fp)
        status,_,body=self.request('POST','/approve',urllib.parse.urlencode(fields),{'Origin':self.a.origin})
        self.assertEqual(status,400);self.assertIn(b'Invalid CSRF token',body)
    def test_browser_form_completes_only_exact_approved_request_once(self):
        headers,fields=self.form();self.a.approve_from_admin(self.a.request_fingerprint(self.a.get('pending',fields['pending'])))
        request_headers={'Origin':self.a.origin,'Cookie':headers['set-cookie'].split(';')[0],'Content-Type':'application/x-www-form-urlencoded'}
        status,response,_=self.request('POST','/approve',urllib.parse.urlencode(fields),request_headers)
        self.assertEqual(status,303);q=urllib.parse.parse_qs(urllib.parse.urlsplit(response['location']).query)
        self.assertEqual(q['iss'],[self.a.origin]);self.assertEqual(q['state'],['browser-pairing']);self.assertTrue(q['code'])
        self.assertEqual(response['referrer-policy'],'no-referrer')
        self.assertEqual(self.request('POST','/approve',urllib.parse.urlencode(fields),request_headers)[0],400)

if __name__=='__main__':unittest.main()

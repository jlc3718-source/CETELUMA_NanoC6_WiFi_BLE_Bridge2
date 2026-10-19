#!/usr/bin/env python3
"""Restricted Oracle project development MCP. No command/shell tool exists.

The HTTP service only accepts named operations and exact allowlisted files.
Secrets, database files, firmware and original Jason Home are excluded.
"""
import base64,contextlib,fcntl,hashlib,hmac,html,http.cookies,http.server,json,os,pathlib,re,secrets,sqlite3,subprocess,tempfile,threading,time,urllib.parse,urllib.request,uuid
from html.parser import HTMLParser

NAME='Jason Home 2 Oracle Development'
VERSION='1.0.3'
SCOPES={'oracle.read','oracle.deploy','oracle.device'}
CALLBACK='https://chatgpt.com/connector_platform_oauth_redirect'
MAX_BODY=2_000_000
MAX_FILE=500_000

def require(ok,message):
    if not ok:raise ValueError(message)
def digest(b):return hashlib.sha256(b if isinstance(b,bytes) else b.encode()).hexdigest()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':')).encode()
def safe_id(v):
    require(isinstance(v,str) and re.fullmatch(r'[a-f0-9]{32}',v),'Invalid operation identifier')
    return v
def redacted(text):
    text=re.sub(r'(?i)(authorization|cookie|password|api[_-]?key|access[_-]?token|refresh[_-]?token|bridge[_-]?token|secret)(["\s:=]+)[^\s,;}]+',r'\1\2[REDACTED]',str(text))
    return re.sub(r'\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_.-]{30,})\b','[REDACTED]',text)
def run(*args,data=None,timeout=40):
    # All callers use fixed executables/arguments; HTTP input is never a command.
    p=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
    if p.returncode:raise RuntimeError('Fixed operation failed: '+redacted(p.stderr.decode(errors='replace')[-1500:]))
    return p.stdout
def atomic(path,data,mode=0o600):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.new-')
    try:
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,mode);os.replace(tmp,path)
        d=os.open(path.parent,os.O_DIRECTORY);os.fsync(d);os.close(d)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

class DockerProject:
    def __init__(self,config):self.config=config
    def read(self,path):
        # The path has already been selected from the root-owned allowlist.
        return run('docker','exec',self.config['container'],'cat','/app/'+path)
    def write(self,path,data):
        # Atomic replacement within the existing container filesystem, not a shell.
        script="const fs=require('fs');const p=process.argv[1];if(fs.lstatSync(p).isSymbolicLink())throw Error('symlink');const t=p+'.oracle-dev-tmp';const s=fs.statSync(p);fs.writeFileSync(t,fs.readFileSync(0),{mode:s.mode&511});fs.chownSync(t,s.uid,s.gid);fs.renameSync(t,p);"
        run('docker','exec','--user','0','-i',self.config['container'],'node','-e',script,'/app/'+path,data=data)
    def restart(self):run('docker','restart',self.config['container'],timeout=70)
    def check_script(self,source,module=False):
        # Syntax checking does not execute staged JavaScript.
        args=['docker','exec','-i',self.config['container'],'node']
        if module:args+=['--input-type=module']
        return run(*args,'--check',data=source)
    def logs(self,lines):return redacted(run('docker','logs','--tail',str(lines),self.config['container']).decode(errors='replace'))
    def scrub(self,text):
        for name in (self.config['container'],'jason-home'):
            info=json.loads(run('docker','inspect',name))[0]
            for item in info['Config']['Env']:
                key,_,value=item.partition('=')
                if re.search(r'TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY',key,re.I) and len(value)>=8:text=text.replace(value,'[REDACTED]')
        return text

class HtmlCheck(HTMLParser):
    def __init__(self):super().__init__(convert_charrefs=False);self.in_script=False;self.scripts=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and not dict(attrs).get('src'):self.in_script=True;self.scripts.append('')
    def handle_endtag(self,tag):
        if tag=='script':self.in_script=False
    def handle_data(self,data):
        if self.in_script:self.scripts[-1]+=data

class Development:
    def __init__(self,config,state,backend_factory=DockerProject):
        self.config=config;self.root=pathlib.Path(state);self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.backends={p:backend_factory(c) for p,c in config['projects'].items() if c.get('enabled')}
        self.mutex=threading.RLock();self.session=''
    def project(self,name):
        require(name in self.backends,'Project has no verified editable Oracle application; inspect connection_status')
        return self.config['projects'][name],self.backends[name]
    def allowed(self,name,path):
        c,_=self.project(name)
        require(isinstance(path,str) and path in c['files'],'File is outside the authorized project allowlist')
        require(not any(p in path.split('/') for p in ('.','..','')) and not path.startswith('/'),'Invalid file path')
        return path
    def app(self,path,body=None):
        # Only fixed /api paths chosen by the implementation may reach the app.
        require(path.startswith('/api/'),'Invalid internal API path')
        def request(cookie):
            data=None if body is None else canonical(body)
            req=urllib.request.Request('http://127.0.0.1:8081'+path,data=data,headers={'content-type':'application/json','cookie':cookie})
            with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
        try:return request(self.session)
        except urllib.error.HTTPError as e:
            if e.code!=401:raise
        # Existing credential stays server-side. It is not included in results.
        info=json.loads(run('docker','inspect','jason-home'))[0]
        env=dict(v.split('=',1) for v in info['Config']['Env'] if '=' in v)
        req=urllib.request.Request('http://127.0.0.1:8081/api/session',data=canonical({'token':env['JASON_HOME_API_TOKEN']}),headers={'content-type':'application/json'})
        with urllib.request.urlopen(req,timeout=15) as r:self.session=r.headers['set-cookie'].split(';')[0]
        return request(self.session)
    def health(self,name):
        c,_=self.project(name)
        with urllib.request.urlopen(c['health'],timeout=8) as r:
            v=json.load(r);require(r.status==200 and v.get('ok') is True,'Application health verification failed')
        return {k:v.get(k) for k in ('ok','service','build')}
    def wait_health(self,name):
        last=None
        for _ in range(20):
            try:return self.health(name)
            except Exception as e:last=e;time.sleep(.5)
        raise RuntimeError('Application did not recover') from last
    def status(self,name):
        c,b=self.project(name);out={'project':name,'health':self.health(name),'files':len(c['files'])}
        if name=='jason-home-2':
            v=self.app('/api/curtain/status');cur=v.get('curtain') or {}
            out['curtain']={k:v.get(k) for k in ('online','firmware','queued','uptimeSeconds','relayStreaming','nanoAnimationSpeedPercent','lastSeen')}
            out['curtain']['device']={k:cur.get(k) for k in ('connected','mtu','nanoLocalCacheSupported','nanoLocalCacheAvailableBytes','nanoLocalCacheBytes','nanoLocalCacheSha256','streaming','nativeAssetActive')}
        return out
    @contextlib.contextmanager
    def locked(self):
        with self.mutex:
            with open(self.root/'deploy.lock','a') as f:
                fcntl.flock(f,fcntl.LOCK_EX)
                try:yield
                finally:fcntl.flock(f,fcntl.LOCK_UN)
    def manifest(self,folder,value=None):
        p=folder/'manifest.json'
        if value is None:return json.loads(p.read_text())
        atomic(p,canonical(value))
    def stage(self,name,changes,reason,owner):
        c,b=self.project(name)
        require(isinstance(reason,str) and 5<=len(reason)<=1000,'Describe the authorized change')
        require(isinstance(changes,list) and 1<=len(changes)<=12,'Use 1–12 affected files')
        require(len({x.get('path') for x in changes})==len(changes),'Duplicate target file')
        stage=uuid.uuid4().hex;folder=self.root/'stages'/stage;folder.mkdir(parents=True,mode=0o700)
        entries=[]
        try:
            for change in changes:
                require(set(change)=={'path','base_sha256','content'},'Unexpected change fields')
                path=self.allowed(name,change['path']);live=b.read(path)
                require(change['base_sha256']==digest(live),'Production changed; reread '+path)
                require(isinstance(change['content'],str),'Only UTF-8 source changes are accepted')
                data=change['content'].encode();require(0<len(data)<=MAX_FILE,'Invalid source size')
                require(b'\x00' not in data,'Binary files are excluded')
                atomic(folder/'files'/path,data)
                entries.append({'path':path,'before':digest(live),'after':digest(data),'bytes':len(data)})
            m={'id':stage,'project':name,'owner':owner,'reason':reason,'files':entries,'state':'staged','created':time.time()}
            self.manifest(folder,m);return m
        except BaseException:
            # Unfinished stage has no deployable manifest and cannot touch production.
            raise
    def get_stage(self,id,owner):
        folder=self.root/'stages'/safe_id(id);m=self.manifest(folder)
        require(m['owner']==owner,'Stage belongs to a different authorization grant')
        require(time.time()-m['created']<86400,'Stage expired; reread production')
        return folder,m
    def validate(self,id,owner):
        folder,m=self.get_stage(id,owner);_,b=self.project(m['project'])
        checks=[]
        for e in m['files']:
            path=e['path'];source=(folder/'files'/path).read_bytes();require(digest(source)==e['after'],'Stage hash mismatch')
            if path.endswith(('.js','.mjs')):b.check_script(source,path.endswith('.mjs'));checks.append(path+': JavaScript syntax passed')
            elif path.endswith('.html'):
                parser=HtmlCheck();parser.feed(source.decode());parser.close()
                for s in parser.scripts:
                    if s.strip():b.check_script(s.encode(),True)
                require(re.search(rb'<(?:!doctype|html|main|section)',source,re.I),'No HTML document content')
                checks.append(path+': HTML and inline JavaScript passed')
            elif path.endswith('.css'):
                import tinycss2
                errors=[v for v in tinycss2.parse_stylesheet(source.decode(),skip_comments=True,skip_whitespace=True) if v.type=='error']
                require(not errors,'CSS parse failed');checks.append(path+': CSS parse passed')
            else:raise ValueError('Unsupported source extension')
        if self.config.get('animation_test') and any(e['path'] in ('web/curtain_loop_animation.js','web/curtain_ai_animation.html','curtain_asset.mjs') for e in m['files']):
            c,b=self.project(m['project'])
            (self.root/'sandbox').mkdir(exist_ok=True,mode=0o700)
            with tempfile.TemporaryDirectory(prefix='oracle-component-',dir=self.root/'sandbox') as tmp:
                work=pathlib.Path(tmp);work.chmod(0o755);(work/'tests').mkdir(mode=0o755)
                for path in ('curtain_loop_animation.js','curtain_ai_animation.html','curtain_asset.mjs'):
                    live_path=path if path.endswith('.mjs') else 'web/'+path
                    changed=next((e for e in m['files'] if e['path']==live_path),None)
                    data=(folder/'files'/live_path).read_bytes() if changed else b.read(live_path)
                    (work/path).write_bytes(data);(work/path).chmod(0o644)
                test=work/'tests/curtain-simple-animation.mjs';test.write_bytes(pathlib.Path(self.config['animation_test']).read_bytes());test.chmod(0o644)
                run('docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','64','--memory','192m','--cpus','1','--user','65534:65534','--mount','type=bind,src='+str(work)+',dst=/work,readonly','--workdir','/work','--entrypoint','/usr/bin/env',c['image'],'-i','PATH=/usr/local/bin:/usr/bin:/bin','node','--test','tests/curtain-simple-animation.mjs',timeout=45)
            checks.append('Isolated animation behavior, restoration and sparse-packet tests passed')
        m['validated']=digest(canonical(m['files']));m['checks']=checks;self.manifest(folder,m)
        return {'stage_id':id,'ok':True,'checks':checks,'files':m['files']}
    def verify(self,name,files):
        c,b=self.project(name);health=self.wait_health(name)
        for e in files:
            require(digest(b.read(e['path']))==e['after'],'Running file hash mismatch')
            if e['path'].startswith('web/'):
                # Validate the actual authenticated HTTP response, not just the disk copy.
                if not self.session:self.app('/api/curtain/status')
                req=urllib.request.Request(c['origin']+'/'+e['path'][4:],headers={'cookie':self.session})
                with urllib.request.urlopen(req,timeout=10) as r:
                    require(r.status==200 and digest(r.read())==e['after'],'Served web asset differs from deployed source')
        return {'health':health,'sourceHashes':True,'authenticatedHttp':True}
    def restore(self,folder,m):
        _,b=self.project(m['project'])
        for e in m['files']:
            data=(folder/'before'/e['path']).read_bytes();require(digest(data)==e['before'],'Invalid rollback backup')
            current=digest(b.read(e['path']))
            require(current in (e['before'],e['after']),'Independent production changes prevent automatic restoration')
            if current!=e['before']:b.write(e['path'],data)
        if m['restart']:b.restart()
        self.verify(m['project'],[{**e,'after':e['before']} for e in m['files']])
        m['state']='rolled_back';m['rollbackVerified']=True;m['finished']=time.time();self.manifest(folder,m)
    def deploy(self,id,owner,injected_failure=False):
        with self.locked():
            folder,stage=self.get_stage(id,owner);name=stage['project'];c,b=self.project(name)
            require(stage['state']=='staged','Stage already consumed')
            require(stage.get('validated')==digest(canonical(stage['files'])),'Validate this exact stage first')
            self.health(name)
            for e in stage['files']:
                require(digest(b.read(e['path']))==e['before'],'Production changed after staging')
                require(digest((folder/'files'/e['path']).read_bytes())==e['after'],'Staged file changed after validation')
            release=uuid.uuid4().hex;backup=self.root/'releases'/release;backup.mkdir(parents=True,mode=0o700)
            m={k:stage[k] for k in ('project','reason','files','owner','created')};m.update(id=release,stage_id=id,state='prepared',restart=any(not e['path'].startswith('web/') for e in m['files']))
            for e in m['files']:atomic(backup/'before'/e['path'],b.read(e['path']));atomic(backup/'after'/e['path'],(folder/'files'/e['path']).read_bytes())
            self.manifest(backup,m) # Durable journal exists BEFORE the first production write.
            try:
                m['state']='deploying';self.manifest(backup,m)
                for e in m['files']:b.write(e['path'],(backup/'after'/e['path']).read_bytes())
                if m['restart']:b.restart()
                m['verification']=self.verify(name,m['files'])
                if injected_failure:raise RuntimeError('Controlled post-deployment verification failure')
                m['state']='verified';m['finished']=time.time();self.manifest(backup,m)
                stage['state']='deployed';stage['release']=release;self.manifest(folder,stage)
                return {'ok':True,'release_id':release,'project':name,'changed':m['files'],'restarted':m['restart'],'verification':m['verification']}
            except BaseException as e:
                m['failure']=redacted(str(e))
                try:self.restore(backup,m)
                except BaseException as rollback_error:
                    m['state']='rollback_failed';m['rollbackError']=redacted(str(rollback_error));self.manifest(backup,m);raise RuntimeError('Deployment failed and rollback needs administrator recovery') from rollback_error
                return {'ok':False,'release_id':release,'error':m['failure'],'automaticRollback':True,'rollbackVerified':True,'changed':m['files']}
    def rollback(self,id,owner):
        with self.locked():
            folder=self.root/'releases'/safe_id(id);m=self.manifest(folder)
            require(m['owner']==owner,'Release belongs to another authorization grant')
            require(m['state']=='verified','Only verified releases may be manually rolled back')
            _,b=self.project(m['project'])
            for e in m['files']:require(digest(b.read(e['path']))==e['after'],'Newer production changes prevent this rollback')
            self.restore(folder,m);return {'ok':True,'release_id':id,'rollbackVerified':True}
    def recover(self):
        # Process termination or reboot during an update also triggers rollback.
        with self.locked():
            for p in (self.root/'releases').glob('*/manifest.json'):
                m=json.loads(p.read_text())
                if m['state'] in ('prepared','deploying','rollback_failed'):self.restore(p.parent,m)
    def self_test(self,owner):
        path='web/curtain_loop_animation.js';_,b=self.project('jason-home-2');base=b.read(path)
        reason='Authorized harmless comment deployment and automatic rollback test'
        stage=self.stage('jason-home-2',[{'path':path,'base_sha256':digest(base),'content':base.decode()+'\n/* Oracle development connection verification '+uuid.uuid4().hex+' */\n'}],reason,owner)
        self.validate(stage['id'],owner);result=self.deploy(stage['id'],owner)
        require(result['ok'],'Direct deployment test failed');self.rollback(result['release_id'],owner)
        stage=self.stage('jason-home-2',[{'path':path,'base_sha256':digest(base),'content':base.decode()+'\n/* Controlled rollback verification */\n'}],reason,owner)
        self.validate(stage['id'],owner);failure=self.deploy(stage['id'],owner,True)
        require(not failure['ok'] and failure['rollbackVerified'],'Automatic rollback test failed')
        require(b.read(path)==base,'Self-test did not restore exact source')
        return {'ok':True,'directDeployment':result,'controlledFailure':failure,'finalSourceUnchanged':True}
    def command(self,action,payload):
        require(action in ('asset','assetSpeed'),'Device action is outside the animation scope')
        return self.app('/api/curtain/call',{'action':action,'payload':payload,'idempotencyKey':'oracle-dev-'+uuid.uuid4().hex})
    def publish(self,frames,delays,speed,name):
        require(isinstance(frames,list) and 3<=len(frames)<=24,'Use 3–24 frames')
        decoded=[base64.b64decode(f,validate=True) for f in frames]
        require(all(len(f)==6400 for f in decoded),'Frames must be exact 40×40 RGBA')
        require(decoded[0]==decoded[-1],'First and last frames must be identical')
        counts=[]
        for i,f in enumerate(decoded[1:],1):
            changed=[p for p in range(1600) if f[p*4:p*4+3]!=decoded[0][p*4:p*4+3]]
            require(len(changed)<=25,'Each frame may edit only one 5×5 region')
            if changed:require(max(p%40 for p in changed)-min(p%40 for p in changed)<5 and max(p//40 for p in changed)-min(p//40 for p in changed)<5,'Changed pixels exceed a 5×5 patch')
            counts.append(sum(f[p*4:p*4+3]!=decoded[i-1][p*4:p*4+3] for p in range(1600)))
        require(max(counts)<=25 and max(counts)>0,'Animation needs a visible small pixel change')
        require(isinstance(delays,list) and len(delays)==len(frames) and all(type(x)==int and 40<=x<=60000 for x in delays),'Invalid frame timing')
        require(type(speed)==int and 25<=speed<=300,'Speed must be 25–300 percent')
        require(isinstance(name,str) and 1<=len(name)<=80,'Invalid animation name')
        st=self.app('/api/curtain/status');c=st.get('curtain') or {}
        require(st.get('online') and st.get('firmware')=='1.1.55' and c.get('connected') and c.get('nanoLocalCacheSupported'),'Verified Nano 1.1.55 and connected BLE required')
        require(st.get('queued')==0,'Wait for existing user commands to finish')
        asset=self.app('/api/curtain/assets',{'name':name,'frames':frames,'delays':delays,'loop':True,'seamlessAnimation':True})
        require(asset['bytes']<=c.get('nanoLocalCacheAvailableBytes',0),'Package does not fit Nano cache')
        speed_command=self.command('assetSpeed',{'percent':speed})
        return {'ok':True,'asset':{k:asset.get(k) for k in ('sha256','bytes','frames','format')},'speedCommand':speed_command,'publishCommand':self.command('asset',{'sha256':asset['sha256']}),'maxChangedPixels':max(counts),'visualOutput':'unconfirmed'}

class Authorization:
    def __init__(self,path,origin,resource):
        self.path=path;self.origin=origin;self.resource=resource;self.lock=threading.RLock()
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, data TEXT, expires REAL, PRIMARY KEY(kind,id))')
        os.chmod(path,0o600)
    @contextlib.contextmanager
    def db(self):
        with self.lock:
            with sqlite3.connect(self.path) as db:yield db
    def put(self,kind,id,data,seconds):
        with self.db() as db:db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)',(kind,id,json.dumps(data),time.time()+seconds))
    def get(self,kind,id,pop=False):
        with self.db() as db:
            row=db.execute('SELECT data,expires FROM records WHERE kind=? AND id=?',(kind,id)).fetchone()
            require(row and row[1]>time.time(),'Authorization has expired or is invalid')
            if pop:db.execute('DELETE FROM records WHERE kind=? AND id=?',(kind,id))
            return json.loads(row[0])
    def register(self,value):
        require(value.get('redirect_uris')==[CALLBACK],'Only the documented ChatGPT callback is allowed')
        require(value.get('token_endpoint_auth_method','none')=='none','Use PKCE public-client authentication')
        id=secrets.token_urlsafe(32);data={'client_id':id,'redirect_uris':[CALLBACK],'token_endpoint_auth_method':'none','grant_types':['authorization_code','refresh_token'],'response_types':['code'],'scope':' '.join(sorted(SCOPES))}
        self.put('client',id,data,3650*86400);return data
    def pending(self,q):
        self.get('client',q.get('client_id',''))
        require(q.get('redirect_uri')==CALLBACK and q.get('response_type')=='code','Invalid authorization request')
        require(q.get('code_challenge_method')=='S256' and re.fullmatch(r'[A-Za-z0-9_-]{43}',q.get('code_challenge','')),'PKCE S256 is required')
        require(q.get('resource')==self.resource,'Incorrect token audience')
        requested=set(q.get('scope','').split());require(requested and requested<=SCOPES,'Invalid requested scopes')
        # Never copy user-supplied owner-approval flags into server-owned state.
        clean={k:q[k] for k in ('client_id','redirect_uri','response_type','code_challenge_method','code_challenge','resource','state') if k in q}
        clean['scope']=' '.join(sorted(requested))
        clean['requestNonce']=secrets.token_hex(16)
        id=secrets.token_urlsafe(32);self.put('pending',id,clean,600);return id
    def request_fingerprint(self,q):
        # Public comparison identifier. It is not a bearer token or OAuth code.
        return digest(canonical({k:q.get(k,'') for k in ('client_id','code_challenge','resource','state','scope','requestNonce')}))[:24]
    def approve_from_admin(self,fingerprint):
        require(isinstance(fingerprint,str) and re.fullmatch(r'[a-f0-9]{24}',fingerprint),'Invalid request fingerprint')
        with self.db() as db:
            candidates=[(id,json.loads(data),expires) for id,data,expires in db.execute("SELECT id,data,expires FROM records WHERE kind='pending' AND expires>?",(time.time(),)).fetchall()]
            matches=[(id,q,expires) for id,q,expires in candidates if hmac.compare_digest(self.request_fingerprint(q),fingerprint)]
            require(len(matches)==1,'No unique active connection request matches this fingerprint')
            id,q,expires=matches[0];q['ownerApprovedAt']=time.time()
            db.execute("UPDATE records SET data=? WHERE kind='pending' AND id=?",(json.dumps(q),id))
        return {'ok':True,'requestFingerprint':fingerprint,'approvalLifetimeSeconds':300}
    def finish_owner_approval(self,id):
        q=self.get('pending',id);stamp=q.get('ownerApprovedAt')
        require(type(stamp) in (int,float) and 0<=time.time()-stamp<=300,'This exact request still needs approval from the authenticated Oracle administrator')
        return self.approve(id)
    def approve(self,id):
        q=self.get('pending',id,True);code=secrets.token_urlsafe(48)
        self.put('code',digest(code),{**q,'owner':uuid.uuid4().hex},120)
        return CALLBACK+'?'+urllib.parse.urlencode({'code':code,'state':q.get('state',''),'iss':self.origin})
    def tokens(self,data):
        kind=data.get('grant_type')
        require(kind in ('authorization_code','refresh_token'),'Unsupported grant')
        if kind=='authorization_code':
            q=self.get('code',digest(data.get('code','')),True)
            require(data.get('redirect_uri')==CALLBACK,'Invalid callback')
            verifier=data.get('code_verifier','');require(re.fullmatch(r'[A-Za-z0-9._~-]{43,128}',verifier),'Invalid PKCE verifier')
            actual=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
            require(hmac.compare_digest(actual,q['code_challenge']),'PKCE verification failed')
        else:q=self.get('refresh',digest(data.get('refresh_token','')),True)
        require(q['client_id']==data.get('client_id') and data.get('resource')==self.resource,'Client or resource mismatch')
        self.get('client',q['client_id'])
        access=secrets.token_urlsafe(48);refresh=secrets.token_urlsafe(64)
        grant={k:q[k] for k in ('client_id','owner','scope')};grant['resource']=self.resource
        self.put('access',digest(access),grant,3600);self.put('refresh',digest(refresh),grant,90*86400)
        return {'access_token':access,'refresh_token':refresh,'token_type':'Bearer','expires_in':3600,'scope':q['scope']}
    def bearer(self,header,scope):
        require(header.startswith('Bearer '),'OAuth bearer token required')
        v=self.get('access',digest(header[7:]));require(v['resource']==self.resource and scope in v['scope'].split(),'Insufficient token scope')
        return v

def tool(name,description,properties,required,scope,readonly=True):
    return {'name':name,'description':description,'inputSchema':{'type':'object','properties':properties,'required':required,'additionalProperties':False},'annotations':{'readOnlyHint':readonly,'destructiveHint':not readonly,'openWorldHint':False},'securitySchemes':[{'type':'oauth2','scopes':[scope]}]}
S={'type':'string'};P={'type':'string','enum':['jason-home-2']}
TOOLS=[
 tool('connection_status','Inspect Oracle Home Development connection, project coverage and deployment restrictions.',{},[],'oracle.read'),
 tool('project_status','Read the live Oracle application health, version and Nano 1.1.55 status.',{'project':P},['project'],'oracle.read'),
 tool('list_files','List exact authorized application source paths and live SHA-256 hashes. No credentials or databases.',{'project':P},['project'],'oracle.read'),
 tool('read_file','Read a current authorized project file before modifying it; return source and SHA-256.',{'project':P,'path':S},['project','path'],'oracle.read'),
 tool('read_logs','Read redacted recent application diagnostics.',{'project':P,'lines':{'type':'integer','minimum':1,'maximum':200}},['project'],'oracle.read'),
 tool('stage_changes','Stage specifically user-authorized source edits away from production, with exact live base hashes.',{'project':P,'reason':S,'changes':{'type':'array','minItems':1,'maxItems':12,'items':{'type':'object','properties':{'path':S,'base_sha256':S,'content':S},'required':['path','base_sha256','content'],'additionalProperties':False}}},['project','reason','changes'],'oracle.deploy',False),
 tool('validate_stage','Validate the exact staged HTML, JavaScript, CSS or server code before deployment.',{'stage_id':S},['stage_id'],'oracle.deploy',False),
 tool('deploy_stage','Back up, deploy only staged files, reload affected service if needed, verify live health/HTTP and automatically roll back failures.',{'stage_id':S},['stage_id'],'oracle.deploy',False),
 tool('rollback_release','Restore an authorized release backup and verify health; refuses to overwrite subsequent changes.',{'release_id':S},['release_id'],'oracle.deploy',False),
 tool('deployment_self_test','Perform the user-requested safe direct deployment test: inert JS comment, HTTP verification, restoration, controlled verification failure and automatic rollback.',{},[],'oracle.deploy',False),
 tool('deployment_history','Read exact changed-file hashes, validation and rollback evidence for recent releases.',{},[],'oracle.read'),
 tool('publish_animation','Only when the user authorizes curtain playback: publish one complete 3–24 frame 40×40 package to existing Nano 1.1.55. Only 5×5 edits, no firmware flash.',{'frames':{'type':'array','items':S},'delays':{'type':'array','items':{'type':'integer'}},'speed':{'type':'integer'},'name':S},['frames','delays','speed','name'],'oracle.device',False),
 tool('animation_command_status','Read ACK/result for a specific animation delivery command; this is separate from physical visual confirmation.',{'command_id':{'type':'integer','minimum':1}},['command_id'],'oracle.read')
]

class Server(http.server.ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,addr,dev,auth):self.dev=dev;self.auth=auth;self.rates={};self.rate_lock=threading.Lock();super().__init__(addr,Handler)

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass # Never log callback URLs, credentials or tokens.
    def response(self,status,body=None,headers=None,ctype='application/json'):
        data=b'' if body is None else (body if isinstance(body,bytes) else canonical(body))
        self.send_response(status)
        for k,v in {'content-type':ctype,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",**(headers or {})}.items():self.send_header(k,v)
        self.send_header('content-length',str(len(data)));self.end_headers();self.wfile.write(data)
    def limit(self,kind,max_count=60):
        ip=self.headers.get('X-Real-IP',self.client_address[0]);key=(kind,ip,int(time.time()//60))
        with self.server.rate_lock:
            # Bound memory as well as request rates.
            if len(self.server.rates)>10000:self.server.rates.clear()
            self.server.rates[key]=self.server.rates.get(key,0)+1
            require(self.server.rates[key]<=max_count,'Request rate limit exceeded')
    def body(self):
        require(not self.headers.get('Transfer-Encoding'),'Chunked requests are unsupported')
        n=int(self.headers.get('content-length','0'));require(0<n<=MAX_BODY,'Invalid request size')
        return self.rfile.read(n)
    def challenged(self):
        self.response(401,{'error':'OAuth authorization required'}, {'WWW-Authenticate':'Bearer resource_metadata="'+self.server.auth.origin+'/.well-known/oauth-protected-resource", scope="oracle.read oracle.deploy oracle.device"'})
    def check_origin(self):
        require(self.headers.get('Host') in self.server.dev.config['hosts'],'Unexpected Host')
        origin=self.headers.get('Origin');require(not origin or origin in ('https://chatgpt.com',self.server.auth.origin),'Unexpected Origin')
    def do_GET(self):
        try:self.get()
        except Exception:self.response(400,{'error':'Invalid or expired request'})
    def get(self):
        self.check_origin();a=self.server.auth;p=urllib.parse.urlsplit(self.path);q={k:v[0] for k,v in urllib.parse.parse_qs(p.query).items()}
        if p.path=='/.well-known/oauth-authorization-server':
            return self.response(200,{'issuer':a.origin,'authorization_endpoint':a.origin+'/authorize','token_endpoint':a.origin+'/token','registration_endpoint':a.origin+'/register','revocation_endpoint':a.origin+'/revoke','response_types_supported':['code'],'grant_types_supported':['authorization_code','refresh_token'],'token_endpoint_auth_methods_supported':['none'],'code_challenge_methods_supported':['S256'],'scopes_supported':sorted(SCOPES),'authorization_response_iss_parameter_supported':True})
        if p.path in ('/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'):
            return self.response(200,{'resource':a.resource,'authorization_servers':[a.origin],'scopes_supported':sorted(SCOPES),'bearer_methods_supported':['header'],'resource_name':NAME})
        if p.path=='/health':return self.response(200,{'ok':True,'connection':NAME,'version':VERSION})
        if p.path=='/authorize':
            self.limit('authorize',20);pending=a.pending(q);csrf=secrets.token_urlsafe(32)
            a.put('csrf',digest(csrf),{'pending':pending},600)
            fingerprint=a.request_fingerprint(a.get('pending',pending))
            page='<!doctype html><html><meta name="viewport" content="width=device-width"><title>Connect Jason Home 2 Oracle Development</title><style>body{font:17px system-ui;background:#101827;color:#eef4ff;max-width:620px;margin:10vh auto;padding:24px}button{padding:14px;width:100%;box-sizing:border-box;margin:16px 0;background:#58b9ff;border:0;border-radius:10px;font:inherit}code{display:block;padding:16px;background:#21324a;font-size:20px}</style><h1>Jason Home 2 Oracle Development</h1><p>Connect ChatGPT to the authorized Jason Home 2 development tools.</p><p>This exact request must be approved through the existing authenticated Oracle administration channel. Credentials remain on Oracle; no API key needs to be entered here.</p><p>Connection request:</p><code id="request-fingerprint">'+fingerprint+'</code><form method="post" action="/approve"><input type="hidden" name="pending" value="'+html.escape(pending)+'"><input type="hidden" name="csrf" value="'+html.escape(csrf)+'"><button type="submit">Complete approved connection</button></form><p>Administrator approval expires after five minutes and applies only to this request. Disconnect the plugin in ChatGPT to stop using the connection.</p></html>'
            # Keep the browser's same-origin form POST Origin intact while
            # suppressing cross-origin referrers, including the OAuth redirect.
            return self.response(200,page.encode(),{'referrer-policy':'same-origin','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' "+CALLBACK+"; frame-ancestors 'none'; base-uri 'none'",'set-cookie':'oracle_dev_csrf='+csrf+'; Path=/; Max-Age=600; Secure; HttpOnly; SameSite=Lax'},'text/html; charset=utf-8')
        if p.path=='/mcp':return self.response(405,{'error':'Use Streamable HTTP POST'},{'Allow':'POST'})
        self.response(404,{'error':'Not found'})
    def do_POST(self):
        try:self.post()
        except Exception as e:self.response(400,{'error':redacted(str(e))[:300]})
    def post(self):
        self.check_origin();p=urllib.parse.urlsplit(self.path).path;a=self.server.auth;d=self.server.dev
        self.limit('requests',180)
        if p in ('/token','/approve','/revoke'):
            data={k:v[0] for k,v in urllib.parse.parse_qs(self.body().decode(),keep_blank_values=True).items()}
            if p=='/token':
                try:return self.response(200,a.tokens(data))
                except Exception:return self.response(400,{'error':'invalid_grant'})
            if p=='/revoke':
                for kind in ('access','refresh'):
                    with a.db() as db:db.execute('DELETE FROM records WHERE kind=? AND id=?',(kind,digest(data.get('token',''))))
                return self.response(200,{})
            self.limit('approval',8)
            cookie=http.cookies.SimpleCookie(self.headers.get('cookie',''));cv=cookie.get('oracle_dev_csrf')
            require(cv and hmac.compare_digest(cv.value,data.get('csrf','')),'Invalid CSRF token')
            saved=a.get('csrf',digest(cv.value),True);require(saved['pending']==data.get('pending'),'Authorization session mismatch')
            location=a.finish_owner_approval(data['pending']);return self.response(303,None,{'location':location,'set-cookie':'oracle_dev_csrf=; Path=/; Max-Age=0; Secure; HttpOnly'})
        if p=='/register':self.limit('register',10);return self.response(201,a.register(json.loads(self.body())))
        if p!='/mcp':return self.response(404,{'error':'Not found'})
        try:grant=a.bearer(self.headers.get('authorization',''),'oracle.read')
        except Exception:return self.challenged()
        req=json.loads(self.body());require(isinstance(req,dict) and req.get('jsonrpc')=='2.0','Invalid JSON-RPC request')
        id=req.get('id');method=req.get('method');params=req.get('params') or {}
        if id is None:return self.response(202)
        if method=='initialize':
            result={'protocolVersion':params.get('protocolVersion','2025-06-18'),'capabilities':{'tools':{'listChanged':False}},'serverInfo':{'name':NAME,'version':VERSION},'instructions':'Use Oracle Home Development for routine Oracle application work. Read current project files, stage only the user-authorized edits, validate, deploy, and verify. Deployments back up exact source and automatically roll back failure. Never use GitHub for routine web work. Firmware, APK builds, credentials, databases and original Jason Home are excluded. Physical curtain output requires separate visual confirmation.'}
        elif method=='ping':result={}
        elif method=='tools/list':result={'tools':TOOLS}
        elif method=='tools/call':
            name=params.get('name');t=next((t for t in TOOLS if t['name']==name),None);require(t,'Unknown tool')
            try:
                a.bearer(self.headers.get('authorization',''),t['securitySchemes'][0]['scopes'][0]);args=params.get('arguments') or {}
                require(isinstance(args,dict) and set(args)<=set(t['inputSchema']['properties']) and set(t['inputSchema']['required'])<=set(args),'Invalid tool arguments')
                out=self.call(name,args,grant['owner']);result={'content':[{'type':'text','text':json.dumps(out)}],'structuredContent':out,'isError':False}
            except Exception as e:result={'content':[{'type':'text','text':redacted(str(e))[:1500]}],'isError':True}
        else:return self.response(200,{'jsonrpc':'2.0','id':id,'error':{'code':-32601,'message':'Method not found'}})
        self.response(200,{'jsonrpc':'2.0','id':id,'result':result})
    def call(self,name,v,owner):
        d=self.server.dev
        if name=='connection_status':return {'name':NAME,'version':VERSION,'projects':{p:{'enabled':c.get('enabled',False),'reason':c.get('reason'),'files':len(c.get('files',[]))} for p,c in d.config['projects'].items()},'shellExposed':False,'githubRequiredForRoutineChanges':False}
        if name=='project_status':return d.status(v['project'])
        if name=='list_files':
            c,b=d.project(v['project']);return {'files':[{'path':p,'sha256':digest(b.read(p))} for p in c['files']]}
        if name=='read_file':
            p=d.allowed(v['project'],v['path']);_,b=d.project(v['project']);content=b.read(p)
            require(b.scrub(content.decode())==content.decode(),'This source contains a runtime credential and cannot be exported')
            return {'path':p,'sha256':digest(content),'content':content.decode()}
        if name=='read_logs':
            _,b=d.project(v['project']);n=v.get('lines',80);require(type(n)==int and 1<=n<=200,'Invalid line count');return {'logs':b.scrub(b.logs(n))}
        if name=='stage_changes':return d.stage(v['project'],v['changes'],v['reason'],owner)
        if name=='validate_stage':return d.validate(v['stage_id'],owner)
        if name=='deploy_stage':return d.deploy(v['stage_id'],owner)
        if name=='rollback_release':return d.rollback(v['release_id'],owner)
        if name=='deployment_self_test':return d.self_test(owner)
        if name=='deployment_history':
            found=sorted((d.root/'releases').glob('*/manifest.json'),key=lambda p:p.stat().st_mtime,reverse=True)[:20]
            return {'releases':[{k:v for k,v in json.loads(p.read_text()).items() if k!='owner'} for p in found]}
        if name=='publish_animation':return d.publish(v['frames'],v['delays'],v['speed'],v['name'])
        if name=='animation_command_status':
            id=v['command_id'];require(type(id)==int and id>0,'Invalid command identifier');out=d.app('/api/curtain/command?id='+str(id));c=out.get('command') or {}
            require(c.get('action') in ('asset','assetSpeed'),'Only animation command results are accessible')
            return {'command':{k:c.get(k) for k in ('id','action','state','result','error','createdAt','appliedAt')}}
        raise ValueError('Unknown operation')

def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--config',required=True);p.add_argument('--self-test',action='store_true');p.add_argument('--approve-request');args=p.parse_args()
    config=json.loads(pathlib.Path(args.config).read_text());d=Development(config,config['state']);d.recover()
    if args.self_test:print(json.dumps(d.self_test('installation-self-test')));return
    a=Authorization(str(pathlib.Path(config['state'])/'authorization.sqlite'),config['origin'],config['origin']+'/mcp')
    if args.approve_request:
        require(os.geteuid()==0,'Owner approval requires the authenticated root administration channel')
        print(json.dumps(a.approve_from_admin(args.approve_request)));return
    Server(('127.0.0.1',8186),d,a).serve_forever()
if __name__=='__main__':main()

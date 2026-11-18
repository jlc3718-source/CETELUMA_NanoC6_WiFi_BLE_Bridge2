#!/usr/bin/env python3
"""Atomic, rollback-capable local installer, invoked by Oracle's existing GitHub Actions runner."""
import json,os,shutil,subprocess,sys,time,hashlib,tempfile
from pathlib import Path
ROOT=Path('/home/ubuntu/agnes-sd300')
PUBLIC=Path('/var/www/agnes-public/videos')
SERVICE='agnes-sd300.service'
FILES=('run.py','scene-manifest.json','state.json')

def sh(*argv,check=True):
    return subprocess.run(argv,check=check,text=True,capture_output=True,timeout=50)

def atomic_bytes(p,data,uid,gid,mode=0o644):
    tmp=p.with_name(p.name+'.deploytmp')
    with open(tmp,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.chmod(tmp,mode);os.chown(tmp,uid,gid);os.replace(tmp,p)

def read_json(p,default):
    return json.loads(p.read_text()) if p.exists() else default

def main():
    if os.geteuid()!=0:raise SystemExit('installer requires sudo -n')
    if len(sys.argv)!=3:raise SystemExit('usage: deploy.py repo-runner repo-manifest')
    src=Path(sys.argv[1]).resolve();newcfg=Path(sys.argv[2]).resolve()
    if not ROOT.is_dir() or not (ROOT/'key').is_file():raise SystemExit('Agnes root/key not present; refusing changes')
    if not (ROOT/'run.py').is_file():raise SystemExit('Agnes runner file not found')
    svc=sh('systemctl','show','-p','ExecStart','--value',SERVICE).stdout
    if 'run.py' not in svc or 'agnes-sd300' not in svc:raise SystemExit('unexpected systemd ExecStart; refusing deploy')
    cfg=json.loads(newcfg.read_text())
    if cfg.get('version')!=2 or len(cfg.get('scenes',[]))!=7:raise SystemExit('unvalidated manifest')
    old=read_json(ROOT/'scene-manifest.json',{})
    prev={s['id']:s for s in old.get('scenes',[])}
    global_keys=('model','seconds','size','aspect_ratio')
    global_change=any(old.get(k)!=cfg.get(k) for k in global_keys)
    modified=[s['id'] for s in cfg['scenes'] if global_change or prev.get(s['id'])!=s]
    if not old:modified=[s['id'] for s in cfg['scenes']]
    state=read_json(ROOT/'state.json',{})
    if not isinstance(state,dict):raise SystemExit('state JSON malformed')
    uid,gid=ROOT.stat().st_uid,ROOT.stat().st_gid
    stamp=time.strftime('%Y%m%d-%H%M%S',time.gmtime())
    backup=ROOT/'managed-backups'/stamp
    backup.mkdir(parents=True,exist_ok=False)
    for fn in FILES:
        p=ROOT/fn
        if p.exists():shutil.copy2(p,backup/fn)
    moved=[]
    running=False
    try:
        sh('systemctl','stop',SERVICE)
        running=True
        for name in modified:
            for p,label in ((ROOT/(name+'.mp4'),'private'),(PUBLIC/(name+'.mp4'),'published')):
                if p.exists():
                    dst=backup/(label+'-'+name+'.mp4')
                    shutil.move(str(p),str(dst))
                    moved.append((dst,p))
            state[name]={'id':None,'status':'retrying','http':None,'error':'new storyboard revision; resubmitting',
                         'approved':False,'revision':cfg['revision']}
        atomic_bytes(ROOT/'run.py',src.read_bytes(),uid,gid)
        atomic_bytes(ROOT/'scene-manifest.json',newcfg.read_bytes(),uid,gid)
        atomic_bytes(ROOT/'state.json',(json.dumps(state,indent=2)+'\n').encode(),uid,gid)
        sh('systemctl','start',SERVICE)
        active=sh('systemctl','is-active',SERVICE).stdout.strip()
        if active!='active':raise RuntimeError('Agnes service did not start')
        pub=sh('systemctl','start','agnes-publish.service',check=False)
        print('AGNES_DEPLOY_SUCCESS revision='+cfg['revision']+
              ' changed='+str(len(modified))+' scenes='+','.join(modified)+
              ' runner_active='+active+' backup='+str(backup)+
              ' publish_exit='+str(pub.returncode))
        print('AGNES_MANAGED_REMOTE_UPDATES_ENABLED')
    except Exception:
        if running:sh('systemctl','stop',SERVICE,check=False)
        for fn in FILES:
            saved=backup/fn;target=ROOT/fn
            if saved.exists():shutil.copy2(saved,target)
            elif target.exists() and fn=='scene-manifest.json':target.unlink()
        for oldpath,target in reversed(moved):
            if oldpath.exists():shutil.move(str(oldpath),str(target))
        sh('systemctl','start',SERVICE,check=False)
        print('AGNES_DEPLOY_ROLLED_BACK_FROM '+str(backup),file=sys.stderr)
        raise

if __name__=='__main__':main()

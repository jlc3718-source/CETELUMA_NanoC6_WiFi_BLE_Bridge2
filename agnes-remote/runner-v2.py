#!/usr/bin/env python3
"""Airthereal SD300 seven-scene runner. GitHub-managed; credentials remain on Oracle."""
import json,os,sys,time,urllib.error,urllib.parse,urllib.request,math
from datetime import datetime,timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT=Path('/home/ubuntu/agnes-sd300')
CONFIG=ROOT/'scene-manifest.json'
STATE=ROOT/'state.json'
KEY=ROOT/'key'
API='https://apihub.agnes-ai.com/v1/videos'
POLL='https://apihub.agnes-ai.com/agnesapi'
TERMINAL={'downloaded','blocked','failed'}

def load_config(path=CONFIG):
    c=json.loads(Path(path).read_text())
    expected=['01_electrician','02_gear','03_setup','04_running','05_boot','06_night','07_morning']
    if c.get('version')!=2 or [s.get('id') for s in c.get('scenes',[])]!=expected:
        raise ValueError('manifest must contain the seven expected scenes in order')
    if c.get('model')!='agnes-video-2.5-flash' or c.get('size')!='720P':
        raise ValueError('unsupported Agnes model/size')
    if c.get('aspect_ratio') not in ('9:16','16:9') or not 4<=int(c.get('seconds',0))<=12:
        raise ValueError('invalid duration/aspect ratio')
    if c.get('retry_seconds')!=1:raise ValueError('retry interval must be one second')
    for s in c['scenes']:
        if not isinstance(s.get('prompt'),str) or len(s['prompt'])<160:raise ValueError('prompt missing for '+s['id'])
        if s.get('mode') not in ('text','reference','keyframe'):raise ValueError('unsupported mode')
        if s['mode']=='reference':
            imgs=s.get('images')
            if not isinstance(imgs,list) or not 1<=len(imgs)<=5 or not all(x.startswith('https://') for x in imgs):
                raise ValueError('reference image URL missing for '+s['id'])
        if s['mode']=='keyframe' and not str(s.get('first_frame','')).startswith('https://'):
            raise ValueError('first-frame URL missing for '+s['id'])
    return c

def atomic_json(path,data):
    tmp=path.with_name(path.name+'.tmp')
    with tmp.open('w') as f:
        json.dump(data,f,indent=2)
        f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)

def http_call(url,token,payload=None,timeout=55):
    h={'Authorization':'Bearer '+token,'User-Agent':'SD300-managed/2.0','Accept':'application/json'}
    body=None
    if payload is not None:
        body=json.dumps(payload).encode()
        h['Content-Type']='application/json'
    try:
        with urllib.request.urlopen(urllib.request.Request(url,data=body,headers=h),timeout=timeout) as r:
            raw=r.read(2_000_000)
            try:res=json.loads(raw)
            except (ValueError,UnicodeDecodeError):res={'error':'non-json response'}
            return r.status,res,r.headers
    except urllib.error.HTTPError as e:
        try:res=json.loads(e.read(16000))
        except Exception:res={'error':'HTTP failure'}
        return e.code,res,e.headers


def retry_after_seconds(headers, now=None):
    """Honor HTTP Retry-After delta seconds or RFC HTTP date, when supplied."""
    if not headers:return None
    value=headers.get('Retry-After')
    if not value:return None
    value=str(value).strip()
    try:
        seconds=float(value)
        if math.isfinite(seconds) and seconds>=0:
            return max(1,math.ceil(seconds))
    except (TypeError,ValueError):
        pass
    try:
        date=parsedate_to_datetime(value)
        if date.tzinfo is None:date=date.replace(tzinfo=timezone.utc)
        current=time.time() if now is None else now
        delta=date.timestamp()-current
        if math.isfinite(delta) and delta>0:return max(1,math.ceil(delta))
    except (ValueError,TypeError,OverflowError,IndexError):
        pass
    return None

def record_rate_limit(state,scene,headers, now=None):
    """One 429 throttles ALL scenes, not just the current scene."""
    current=time.time() if now is None else now
    previous=state.get('_rate_limit',{})
    failures=int(previous.get('failures',0))+1
    header_delay=retry_after_seconds(headers,current)
    # If server has no Retry-After, use bounded exponential backoff.
    wait=header_delay if header_delay is not None else min(900,15*2**min(failures-1,6))
    until=current+wait
    state['_rate_limit']={'until':until,'failures':failures,
                          'delay_seconds':wait,'source':'retry-after' if header_delay is not None else 'exponential'}
    scene['next_retry_unix']=math.ceil(until)
    scene['retry_after_seconds']=wait
    scene['retry_source']=state['_rate_limit']['source']

def get_detail(d):
    if not isinstance(d,dict):return {}
    for k in ('data','result','task'):
        if isinstance(d.get(k),dict):return d[k]
    return d

def error_text(d):
    if not isinstance(d,dict):return 'invalid server response'
    val=d.get('error') or d.get('message') or d.get('detail') or ''
    if isinstance(val,dict):val=val.get('message') or val.get('code') or 'service error'
    return str(val)[:250]

def request_body(c,s):
    body={'model':c['model'],'mode':s['mode'],'seconds':c['seconds'],
          'size':c['size'],'aspect_ratio':c['aspect_ratio'],'n':1,'prompt':s['prompt']}
    if s['mode']=='reference':body['images']=s['images']
    if s['mode']=='keyframe':body['first_frame']=s['first_frame']
    return body

def video_url(d):
    v=get_detail(d)
    for x in (v,d):
        if not isinstance(x,dict):continue
        for k in ('url','video_url'):
            if isinstance(x.get(k),str) and x[k].startswith('https://'):return x[k]
        meta=x.get('metadata')
        if isinstance(meta,dict) and isinstance(meta.get('url'),str):return meta['url']
        output=x.get('output')
        if isinstance(output,dict) and isinstance(output.get('url'),str):return output['url']
        if isinstance(output,list) and output:
            y=output[0]
            if isinstance(y,dict) and isinstance(y.get('url'),str):return y['url']
            if isinstance(y,str) and y.startswith('https://'):return y
    return None

def download_video(name,url):
    if not str(url).startswith('https://'):raise ValueError('invalid download URL')
    with urllib.request.urlopen(url,timeout=180) as r:data=r.read(80_000_001)
    if not 1024<len(data)<80_000_000 or b'ftyp' not in data[:64]:
        raise ValueError('download is not a valid MP4')
    out=ROOT/(name+'.mp4')
    tmp=ROOT/(name+'.new.mp4')
    with tmp.open('wb') as f:
        f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(tmp,out)

def cycle(c,state,token):
    if state.get('_rate_limit',{}).get('until',0)>time.time():
        return
    for s in c['scenes']:
        if state.get('_rate_limit',{}).get('until',0)>time.time():
            break
        name=s['id'];x=state.setdefault(name,{})
        if x.get('status') in TERMINAL:continue
        rate_limited=False
        try:
            if not x.get('id'):
                code,d,headers=http_call(API,token,request_body(c,s))
                v=get_detail(d)
                job=v.get('id') or v.get('video_id') or v.get('task_id')
                x['http']=code;x['error']=error_text(d)
                if code==429:
                    record_rate_limit(state,x,headers)
                    rate_limited=True
                elif code<500:state.pop('_rate_limit',None)
                if code in (400,401,403,422):
                    x['status']='blocked'
                elif code==200 or code==201 or code==202:
                    x['id']=str(job) if job else None
                    x['status']='queued' if job else 'retrying'
                    if not job and not x['error']:x['error']='API accepted but returned no job ID'
                else:
                    x['status']='retrying'
            else:
                code,d,headers=http_call(API+'/'+urllib.parse.quote(str(x['id']),safe=''),token)
                if code==404:
                    q=urllib.parse.urlencode({'video_id':x['id'],'model_name':c['model']})
                    code,d,headers=http_call(POLL+'?'+q,token)
                v=get_detail(d)
                x['http']=code
                if code==429:
                    record_rate_limit(state,x,headers)
                    rate_limited=True
                elif code<500:state.pop('_rate_limit',None)
                if code in (400,401,403,422):x['status']='blocked';x['error']=error_text(d)
                elif code in (429,503):x['status']='retrying';x['error']=error_text(d)
                elif code>=400:x['status']='retrying';x['error']=error_text(d)
                else:
                    status=str(v.get('status') or d.get('status') or '').lower()
                    x['status']=status if status else 'queued'
                    x['error']=error_text(d)
                    if status in ('completed','succeeded','success','done'):
                        url=video_url(d)
                        if url:
                            download_video(name,url)
                            x['status']='downloaded';x['http']=200;x['error']='';x['approved']=False
                        else:x['status']='missing_url';x['error']='completed without downloadable video URL'
                    elif status in ('failed','error','canceled','cancelled'):
                        x['status']='failed'
                        if not x['error']:x['error']='generation failed'
        except Exception as e:
            x['status']='retrying';x['error']=(type(e).__name__+': '+str(e))[:220]
        x['revision']=c['revision']
        atomic_json(STATE,state)
        if rate_limited:break

def main():
    if len(sys.argv)==3 and sys.argv[1]=='--check-config':
        c=load_config(sys.argv[2])
        print('AGNES_CONFIG_OK scenes='+str(len(c['scenes']))+
              ' image_references='+str(sum(s['mode']!='text' for s in c['scenes']))+
              ' duration='+c['seconds']+' seconds aspect='+c['aspect_ratio'])
        return
    if len(sys.argv)!=1:raise SystemExit('only --check-config is available')
    c=load_config()
    if not KEY.is_file():raise SystemExit('existing private Agnes key is missing')
    token=KEY.read_text().strip()
    if not token:raise SystemExit('private Agnes key empty')
    state=json.loads(STATE.read_text()) if STATE.exists() else {}
    while True:
        cycle(c,state,token)
        if all(state.get(s['id'],{}).get('status') in TERMINAL for s in c['scenes']):break
        time.sleep(max(1,min(60,state.get('_rate_limit',{}).get('until',0)-time.time())))

if __name__=='__main__':main()

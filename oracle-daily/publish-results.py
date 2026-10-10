#!/usr/bin/env python3
"""Publish generated evidence from a separate worktree without rebasing it."""
import datetime
import json
import pathlib
import subprocess
import sys
import tempfile

def git(root,*args,check=True):
    return subprocess.run(["git","-C",str(root),*args],check=check,capture_output=True)

def evidence_time(data):
    try:
        obj=json.loads(data)
        for node in (obj,obj.get("result",{})):
            for key in ("finished","checked_at","last_run_at","started"):
                value=node.get(key)
                if value:return datetime.datetime.fromisoformat(value.replace("Z","+00:00"))
    except (ValueError,TypeError,AttributeError):
        pass
    return None

def publish(files,root=None):
    root=pathlib.Path(root or pathlib.Path.cwd()).resolve()
    outputs={}
    for name in files:
        relative=pathlib.PurePosixPath(name)
        if len(relative.parts)!=2 or relative.parts[0]!=".github" or not relative.name.startswith("oracle-") or relative.suffix not in (".json",".txt"):
            raise ValueError("Only generated Oracle evidence files may be published")
        source=root/name
        if not source.is_file():continue
        data=source.read_bytes()
        previous=git(root,"show","HEAD:"+name,check=False)
        if previous.returncode or previous.stdout!=data:outputs[name]=data
    if not outputs:
        print(json.dumps({"published":False,"status":"unchanged"}));return False
    git(root,"fetch","origin","main")
    with tempfile.TemporaryDirectory(prefix="oracle-evidence-") as temp:
        work=pathlib.Path(temp)/"worktree"
        git(root,"worktree","add","--detach",str(work),"origin/main")
        try:
            git(work,"config","user.name","oracle-runner")
            git(work,"config","user.email","oracle-runner@users.noreply.github.com")
            for _ in range(3):
                git(work,"fetch","origin","main")
                git(work,"reset","--hard","origin/main")
                changed=[]
                for name,data in outputs.items():
                    target=work/name
                    current=target.read_bytes() if target.exists() else b""
                    old_time,new_time=evidence_time(current),evidence_time(data)
                    if old_time and new_time and new_time<old_time:continue
                    if data==current:continue
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_bytes(data);changed.append(name)
                if not changed:
                    print(json.dumps({"published":False,"status":"newer_or_unchanged_evidence_retained"}));return False
                git(work,"add","--",*changed)
                git(work,"commit","-m","Publish current Oracle evidence [skip ci]")
                result=git(work,"push","origin","HEAD:main",check=False)
                if result.returncode==0:
                    print(json.dumps({"published":True,"files":changed}));return True
            raise RuntimeError("Evidence publishing failed after three concurrent-update retries")
        finally:
            git(root,"worktree","remove","--force",str(work),check=False)

if __name__=="__main__":publish(sys.argv[1:])

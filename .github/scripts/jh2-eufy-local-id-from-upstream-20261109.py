import os,json,hashlib,sqlite3,subprocess
from pathlib import Path
PREFIX="c74ebc9852ee8b5"  # truncated SHA256 of the account ID in user's prior signed Jason Home APKs; not a secret
def volume(name):
    info=json.loads(subprocess.check_output(["docker","inspect",name],text=True))[0]
    match=[x for x in info["Mounts"] if x["Destination"]=="/data" and x["Type"]=="bind"]
    assert len(match)==1,"Expected one persistent /data bind mount for "+name
    root=Path(match[0]["Source"]).resolve()
    assert root.is_dir(),"Missing persistent data mount"
    return root
src=volume("jason-home")/"jason-home.sqlite"
dst=volume("jason-home-2-web")/"jason-home-2.sqlite"
assert src.is_file() and dst.is_file(),"Existing Oracle databases unavailable"
with sqlite3.connect(f"file:{src}?mode=ro",uri=True,timeout=5) as db:
    row=db.execute("SELECT value FROM meta WHERE key='eufy_session'").fetchone()
    assert row,"Existing upstream Eufy session not saved; leave local identity unconfigured"
    session=json.loads(row[0])
candidates=[session.get("uid",""),session.get("accountUid","")]
matching=[v for v in candidates if isinstance(v,str) and len(v)==40 and
          all(33<=ord(c)<=126 for c in v) and
          hashlib.sha256(v.encode("ascii")).hexdigest().startswith(PREFIX)]
if not matching:
    print("JH2_EUFY_LOCAL_IDENTITY_MATCH_NOT_FOUND_NO_DB_WRITE")
else:
    account=matching[0]
    with sqlite3.connect(dst,timeout=15) as db:
        db.execute("PRAGMA busy_timeout=15000")
        db.execute("BEGIN IMMEDIATE")
        before=db.execute("SELECT value FROM meta WHERE key=?",
                          ("eufyLocalAccountId",)).fetchone()
        if before is not None:
            try:existing=json.loads(before[0])
            except Exception:existing=None
            assert existing==account,"Previously configured Eufy account differs; refuse overwrite"
        else:
            db.execute("INSERT INTO meta(key,value) VALUES(?,?)",
                       ("eufyLocalAccountId",json.dumps(account)))
        db.commit()
        account=None
    print("JH2_EUFY_LOCAL_IDENTITY_MATCHED_PRIVATE_APK_AND_STORED_IN_ORACLE_DB")

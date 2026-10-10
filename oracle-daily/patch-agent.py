#!/usr/bin/env python3
"""Patch only the daily-agent routes; the original source stays private on Oracle."""
import hashlib
import json
import pathlib
import re
import sys

def patch(source, patches):
    if "DAILY_RELIABILITY_V2" in source:
        return source.replace("return await goto(page, url, 10000);",'return await require("./daily-runtime-v2/runtime").navigate(page, url, 10000);',1)
    if hashlib.sha256(source.encode()).hexdigest() != patches["expected_server_sha"]:
        raise RuntimeError("Deployed agent changed since inspection; refusing a blind patch")
    for item in patches["functions"]:
        if source.count(item["before"]) != 1:
            raise RuntimeError("Function precondition failed: " + item["name"])
        source=source.replace(item["before"],item["after"],1)
    header=re.search(r"async function gotoLoose\(page,\s*url[^\n]*\)\s*\{",source)
    if not header:
        raise RuntimeError("Missing bounded navigation hook")
    source=source[:header.end()]+'\n  return await require("./daily-runtime-v2/runtime").navigate(page, url, 10000);\n'+source[header.end():]
    hook='''// DAILY_RELIABILITY_V2
const dailyV2 = require("./daily-runtime-v2/runtime").create({
  dataDir: DATA_DIR,
  getLoginState: () => loginState,
  setLoginState: value => { loginState = value; },
  readEntryProfile, launchProfile, taskWithContext, stopLogin,
  chromium, chrome: CHROME, display: LOGIN_DISPLAY, safeProfile, spawn,
  clearProfileLocks: clearStaleChromiumProfileLocks
});

'''
    anchor="async function runTask(job) {"
    if source.count(anchor)!=1:
        raise RuntimeError("Missing task dispatch anchor")
    source=source.replace(anchor,hook+anchor+'''
  const v2Result = await dailyV2.dispatch(job);
  if (v2Result !== dailyV2.UNHANDLED) return v2Result;
''',1)
    source=source.replace("Boolean(loginState.browser)","Boolean(loginState.context)")
    start=source.index('app.post("/run",')
    end=source.index("app.listen(",start)
    source=source[:start]+'''
app.get("/login/status", (_req, res) => res.json(dailyV2.loginStatus()));
app.get("/jobs/:id", (req, res) => {
  dailyV2.dispatch({task:"job_status",job_id:req.params.id}).then(result=>res.json(result));
});
app.post("/run", async (req, res) => {
  try { res.json(await dailyV2.submit(req.body || {}, runTask)); }
  catch (err) { res.status(500).json({ok:false,error:String(err.message).slice(0,300)}); }
});

'''+source[end:]
    return source

if __name__=="__main__":
    source_path=pathlib.Path(sys.argv[1])
    config=json.loads(pathlib.Path(sys.argv[2]).read_text())
    updated=patch(source_path.read_text(),config)
    source_path.write_text(updated)
    source_path.chmod(0o600)
    print(json.dumps({"patched":True,"sha256":hashlib.sha256(updated.encode()).hexdigest()}))

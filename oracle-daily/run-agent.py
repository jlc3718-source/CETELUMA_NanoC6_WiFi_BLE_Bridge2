#!/usr/bin/env python3
"""Bounded durable API jobs; publish evidence without exposing entry profiles."""
import argparse
import datetime
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

BASE="http://127.0.0.1:8932"

def scrub(value,key=""):
    if re.fullmatch(r"password|secret|token|api_key|cookies|headers|storageState|email|phone|street|postal_code|address|values|coupon_code|gift_card_code",key,re.I):
        return "[REDACTED]"
    if isinstance(value,dict):return {k:scrub(v,k) for k,v in value.items()}
    if isinstance(value,list):return [scrub(v) for v in value[:100]]
    if not isinstance(value,str):return value
    if value.startswith(("https://","http://")):
        url=urllib.parse.urlsplit(value)
        query=[(k,"REDACTED" if re.search(r"token|password|email|phone|signature|secret|key",k,re.I) else v) for k,v in urllib.parse.parse_qsl(url.query,keep_blank_values=True)]
        return urllib.parse.urlunsplit((url.scheme,url.netloc,url.path,urllib.parse.urlencode(query),url.fragment))
    value=re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}","[REDACTED_EMAIL]",value,flags=re.I)
    value=re.sub(r"(?<!\d)(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?!\d)","[REDACTED_PHONE]",value)
    value=re.sub(r"\b\d{1,6}\s+[A-Za-z .]+\s(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd)\b","[REDACTED_ADDRESS]",value,flags=re.I)
    return value[:5000]

def get(path,timeout=4):
    with urllib.request.urlopen(BASE+path,timeout=timeout) as response:return json.load(response)

def post(job):
    request=urllib.request.Request(BASE+"/run",data=json.dumps(job).encode(),headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(request,timeout=6) as response:return json.load(response)

def call(job,budget=54):
    acknowledgement=post({**job,"async":True})
    if acknowledgement.get("result",{}).get("status") not in ("queued","running"):
        return acknowledgement
    until=time.monotonic()+budget
    while time.monotonic()<until:
        item=get("/jobs/"+urllib.parse.quote(job["id"],safe=""))
        if item.get("status")=="completed":return item["response"]
        if item.get("status")=="interrupted":return {"id":job["id"],"ok":False,"result":{"task":job["task"],"status":"interrupted","job_id":job["id"]}}
        time.sleep(.6)
    return {"id":job["id"],"ok":False,"result":{"task":job["task"],"status":"in_progress_retrieve_job","job_id":job["id"],"login_status":get("/login/status")}}

def write(stem,job):
    try:result=call(job)
    except Exception as exc:result={"id":job["id"],"ok":False,"result":{"task":job["task"],"status":"transport_error","error":str(exc)[:200]}}
    pathlib.Path(".github/"+stem+".json").write_text(json.dumps(scrub(result),indent=2)+"\n")
    print(json.dumps({"file":stem,"ok":result.get("ok"),"status":result.get("result",{}).get("status"),"task":job["task"]}))
    return result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("mode",choices=["daily","followup","handoff","verify","smoke","walmart-login","walmart-cart"])
    parser.add_argument("--url",default="https://www.walmart.com/account/login")
    parser.add_argument("--latest-arrival")
    args=parser.parse_args()
    now=datetime.datetime.now(ZoneInfo("America/New_York"))
    stamp=now.strftime("%Y-%m-%dT%H-%M-%S")
    check=post({"id":"runtime-health-"+stamp,"task":"agent_selfcheck"})
    if check.get("result",{}).get("version")!="2026.10.10.1":raise RuntimeError("Reliable daily runtime is not deployed")
    if args.mode in ("walmart-login","walmart-cart"):
        url=urllib.parse.urlsplit(args.url)
        if url.scheme!="https" or url.hostname not in ("www.walmart.com","walmart.com","accounts.walmart.com"):
            raise ValueError("A current Walmart HTTPS URL is required")
        if args.mode=="walmart-login":
            write("oracle-walmart-login-result",{"id":"walmart-login-"+stamp,"task":"login_start","profile":"daily","url":args.url})
        else:
            if not args.latest_arrival or datetime.date.fromisoformat(args.latest_arrival)<now.date():
                raise ValueError("Latest arrival must be today or later")
            session=get("/login/status")
            if session.get("active"):
                pathlib.Path(".github/oracle-walmart-cart-result.json").write_text(json.dumps({"ok":True,"result":{"task":"shopping_add_to_cart","status":"manual_session_active","login_url":session.get("login_url"),"url":args.url}},indent=2)+"\n")
            else:
                write("oracle-walmart-cart-result",{"id":"walmart-cart-"+stamp,"task":"shopping_add_to_cart","url":args.url,"latest_arrival":args.latest_arrival})
    elif args.mode=="smoke":
        write("oracle-daily-v2-smoke-result",{"id":"smoke-"+stamp,"task":"batch","read_only":True,"lane_timeout_ms":45000,"tasks":["instagram_brand_scan","eufy_alt_free_spin","bluetti_safe_spin"]})
        write("oracle-promo-state-result",{"id":"smoke-state-"+stamp,"task":"promo_state_get"})
        write("oracle-current-session-result",{"id":"smoke-session-"+stamp,"task":"login_status"})
    elif args.mode=="daily":
        write("oracle-daily-fast-result",{"id":"daily-"+stamp,"task":"run_daily_fast","lane_timeout_ms":45000})
        write("oracle-recall-result",{"id":"recall-"+stamp,"task":"recall_check","make":"CHEVROLET","model":"SILVERADO EV","year":2025})
        write("oracle-promo-state-result",{"id":"state-"+stamp,"task":"promo_state_get"})
    elif args.mode=="handoff":
        urls=[]
        today=now.date().isoformat()
        for p in pathlib.Path(".github").glob("oracle-*-result.json"):
            try:j=json.loads(p.read_text());r=j.get("result",{})
            except Exception:continue
            if j.get("agent_version")!="2026.10.10.1":continue
            try:started=datetime.datetime.fromisoformat(j.get("started","").replace("Z","+00:00")).astimezone(ZoneInfo("America/New_York")).date().isoformat()
            except ValueError:continue
            if started!=today:continue
            if r.get("status") in ("manual_verification_required","missing_required_fields","manual_submission_required_by_rules","prepared","manual_entry_pending","login_required","entry_form_not_found","unexpected_entry_redirect"):
                url=r.get("source_url") or r.get("url")
                if url and "gleam.io" not in url:urls.append(url)
        if not urls:
            queue=pathlib.Path(".github/oracle-manual-handoff-urls.json")
            if queue.exists():urls=json.loads(queue.read_text()).get("urls",[])
        if not urls:
            pathlib.Path(".github/oracle-manual-handoff-result.json").write_text(json.dumps({"ok":True,"result":{"task":"prepare_restricted","status":"no_current_manual_items"}})+"\n")
        else:write("oracle-manual-handoff-result",{"id":"manual-"+stamp,"task":"prepare_restricted","profile":"daily","urls":list(dict.fromkeys(urls))[:10],"eligibility":{"age_verified":True}})
    else:
        campaigns=json.loads(pathlib.Path("oracle-daily/campaigns.json").read_text())
        for campaign in campaigns:
            if campaign.get("ends") and now>datetime.datetime.fromisoformat(campaign["ends"]):continue
            job={k:v for k,v in campaign.items() if k not in ("stem","ends")}
            job.update(id=job["campaign_id"]+"-"+stamp,task="generic_form_entry")
            if args.mode=="verify":job["submit"]=False
            write(campaign["stem"],job)
        if args.mode=="verify":
            write("oracle-recall-result",{"id":"recall-verify-"+stamp,"task":"recall_check"})
            write("oracle-selfcheck-result",{"id":"selfcheck-"+stamp,"task":"agent_selfcheck"})
            write("oracle-current-session-result",{"id":"session-"+stamp,"task":"login_status"})

if __name__=="__main__":main()

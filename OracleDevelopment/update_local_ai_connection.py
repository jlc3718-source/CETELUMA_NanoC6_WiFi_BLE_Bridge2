#!/usr/bin/env python3
"""One-time connection-only maintenance; never deploy or restart the application."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
import uuid

ROOT = Path('/opt/oracle-home-development')
STATE = Path('/var/lib/oracle-home-development')
SOURCE = Path(__file__).resolve().parent
CONTAINER = 'jason-home-2-web'
BASE_ADAPTER_BLOB = '64aa11e4e935540052733a0d653e42f5c4781d46'
REVIEWED_AI_BLOB = '0688da9f60c8f4cb885d529dea5079c6d7ffc118'


def require(condition, message):
    if not condition: raise RuntimeError(message)


def run(*args, data=None, timeout=30):
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    require(result.returncode == 0, 'Fixed connection-maintenance command failed: ' + args[0])
    return result.stdout


def blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\x00' + data).hexdigest()


def sha(data): return hashlib.sha256(data).hexdigest()


def request_health(port, path='/api/health'):
    with urllib.request.urlopen('http://127.0.0.1:' + str(port) + path, timeout=6) as response:
        result = json.load(response)
        require(response.status == 200 and result.get('ok') is True, 'Health check failed')
        return result


def source_snapshot():
    # Hash source bytes only. No environment, database, artwork, or credential read.
    script = b"""const fs=require('node:fs'),crypto=require('node:crypto');
const out={};for(const dir of ['/app','/app/web'])for(const name of fs.readdirSync(dir)){
const path=dir+'/'+name;if(!/\\.(mjs|js|html|css)$/.test(name))continue;
const stat=fs.lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink())continue;
out[path.slice(5)]=crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');}
console.log(JSON.stringify(out));"""
    return json.loads(run('docker', 'exec', '-i', CONTAINER, 'node', '-', data=script))


def replace(path, data):
    temporary = path.with_name(path.name + '.connection-new')
    temporary.write_bytes(data); temporary.chmod(0o600); temporary.replace(path)


def main():
    require(os.geteuid() == 0, 'Existing Oracle administrator required')
    config_path = ROOT / 'config.json'
    config_before = config_path.read_bytes()
    config = json.loads(config_before)
    require(set(config['projects']) == {'jason-home-2'}, 'Unexpected connection project scope')
    project = config['projects']['jason-home-2']
    require(project.get('enabled') is True and project['container'] == CONTAINER, 'Unexpected existing application')
    require('local_ai.mjs' not in project['files'], 'Local AI source must never be writable')
    require(project.get('read_only_files', []) == [], 'Unexpected pre-existing read-only configuration')
    adapter_before = (ROOT / 'oracle_dev.py').read_bytes()
    require(blob(adapter_before) == BASE_ADAPTER_BLOB, 'Connection source changed independently; no files replaced')
    live_ai = run('docker', 'exec', CONTAINER, 'cat', '/app/local_ai.mjs')
    require(blob(live_ai) == REVIEWED_AI_BLOB, 'Live local_ai.mjs differs from reviewed implementation; SHA-256=' + sha(live_ai))
    run('docker', 'exec', CONTAINER, 'node', '-e', "const s=require('fs').lstatSync('/app/local_ai.mjs');if(!s.isFile()||s.isSymbolicLink()||s.size>500000)process.exit(1)")
    for manifest in (STATE / 'releases').glob('*/manifest.json'):
        require(json.loads(manifest.read_text())['state'] not in ('prepared', 'deploying', 'rollback_failed'),
                'Pending application recovery prevents a connection-only restart')
    before = source_snapshot()
    health_before = request_health(8081)
    identity = run('docker', 'inspect', '--format', '{{.Id}} {{.State.StartedAt}}', CONTAINER)
    run(str(ROOT / 'venv/bin/python'), '-m', 'py_compile', str(SOURCE / 'oracle_dev.py'))
    run('docker', 'exec', '-i', CONTAINER, 'node', '--input-type=module', '--check', data=(SOURCE / 'local_ai_smoke.mjs').read_bytes())
    backup = STATE / ('connection-local-ai-' + uuid.uuid4().hex)
    backup.mkdir(mode=0o700)
    targets = ['oracle_dev.py', 'local_ai_smoke.mjs', 'config.json']
    existed = {name: (ROOT / name).exists() for name in targets}
    for name in targets:
        if existed[name]: shutil.copy2(ROOT / name, backup / name)
    project['read_only_files'] = ['local_ai.mjs']
    try:
        replace(ROOT / 'local_ai_smoke.mjs', (SOURCE / 'local_ai_smoke.mjs').read_bytes())
        replace(ROOT / 'oracle_dev.py', (SOURCE / 'oracle_dev.py').read_bytes())
        replace(config_path, json.dumps(config, indent=2).encode())
        run('systemctl', 'restart', 'oracle-home-development.service')
        for attempt in range(30):
            try:
                connection = request_health(8186, '/health')
                require(connection.get('version') == '1.0.5', 'Unexpected connection version')
                break
            except Exception:
                if attempt == 29: raise
                time.sleep(.2)
        require(source_snapshot() == before, 'Production source hashes changed independently')
        require(run('docker', 'inspect', '--format', '{{.Id}} {{.State.StartedAt}}', CONTAINER) == identity, 'Application container restarted independently')
        health_after = request_health(8081)
        require(health_after.get('build') == health_before.get('build'), 'Application build changed independently')
        persisted = json.loads(config_path.read_text())['projects']['jason-home-2']
        require(persisted['files'] == json.loads(config_before)['projects']['jason-home-2']['files'], 'Writable allowlist changed')
        require(persisted['read_only_files'] == ['local_ai.mjs'], 'Read-only addition differs from requested exact file')
        print(json.dumps({'ok': True, 'connectionVersion': '1.0.5', 'localAiSha256': sha(live_ai),
            'readOnlyFiles': ['local_ai.mjs'], 'writableAllowlistUnchanged': True,
            'productionSourceFilesVerified': len(before), 'productionSourceHashesUnchanged': True,
            'applicationRestarted': False, 'applicationHealthy': True, 'deviceCommandsIssued': 0,
            'smokeTestExecuted': False, 'softwareInstalled': False}))
    except BaseException:
        for name in targets:
            if existed[name]: replace(ROOT / name, (backup / name).read_bytes())
            elif (ROOT / name).exists(): (ROOT / name).unlink()
        run('systemctl', 'restart', 'oracle-home-development.service')
        print('CONNECTION_ONLY_UPDATE_ROLLED_BACK_APPLICATION_FILES_NOT_WRITTEN')
        raise


if __name__ == '__main__': main()

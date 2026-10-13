#!/usr/bin/env python3
"""Controlled k3s/WebUI smoke using a temporary model, without a paid API key."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import ssl
import subprocess
import time
import urllib.request

os.umask(0o077)
parser=argparse.ArgumentParser()
parser.add_argument('--root',type=Path,default=Path('/data/atlas'))
parser.add_argument('--resume',action='store_true')
args=parser.parse_args()
root=args.root.resolve()
source=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('atlas',source/'atlas.py')
atlas=importlib.util.module_from_spec(spec);spec.loader.exec_module(atlas)
values=json.loads((root/'values.json').read_text())
credentials=json.loads((root/'credentials.json').read_text())
evidence=root/'acceptance';evidence.mkdir(exist_ok=True)
context=ssl.create_default_context(cafile=str(root/'tls/ca.crt'))
base=values['gateway']['mossOrigin']
token=None

def api(path,body=None,method='GET'):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    request=urllib.request.Request(base+path,headers=headers,method=method,data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request,context=context,timeout=120) as response:return json.load(response)

token=api('/api/v1/auth/login',{'grant_type':'password','username':credentials['adminUsername'],'password':credentials['adminPassword']},'POST')['access_token']
original=api('/api/v1/settings/system?scope=organization')
# This automatic qualification is for a fresh deployment, before customer model credentials are configured.
if original.get('apiKey') or original.get('hasApiKey') or original.get('apiKeyConfigured'):
    raise SystemExit('Refusing to replace existing model credentials; use the real-model acceptance procedure')
key=secrets.token_urlsafe(24)
ns=atlas.NAMESPACE
name='atlas-acceptance-'+secrets.token_hex(4)
atlas.secret(name,{'MOSS_E2E_API_KEY':key})
atlas.apply({'apiVersion':'v1','kind':'ConfigMap','metadata':{'name':name,'namespace':ns},'data':{'mock.mjs':(source/'mock-openai-server.mjs').read_text()}})
atlas.apply({'apiVersion':'v1','kind':'Service','metadata':{'name':name,'namespace':ns},'spec':{'selector':{'app':name},'ports':[{'port':18484,'targetPort':18484}]}})
atlas.apply({'apiVersion':'v1','kind':'Pod','metadata':{'name':name,'namespace':ns,'labels':{'app':name}},'spec':{
    'automountServiceAccountToken':False,'restartPolicy':'Never','containers':[{'name':'mock','image':values['images']['moss'],'imagePullPolicy':'Never',
    'command':['node','/smoke/mock.mjs','--port','18484'],'envFrom':[{'secretRef':{'name':name}}],
    'volumeMounts':[{'name':'script','mountPath':'/smoke','readOnly':True}],
    'readinessProbe':{'httpGet':{'path':'/healthz','port':18484}}}],
    'volumes':[{'name':'script','configMap':{'name':name}}]}})
atlas.apply({'apiVersion':'networking.k8s.io/v1','kind':'NetworkPolicy','metadata':{'name':name,'namespace':ns},'spec':{'podSelector':{'matchLabels':{'app':name}},'policyTypes':['Ingress'],'ingress':[{'from':[{'namespaceSelector':{'matchLabels':{'kubernetes.io/metadata.name':'moss-sessions'}}}],'ports':[{'protocol':'TCP','port':18484}]}]}})
try:
    atlas.kube('-n',ns,'wait','--for=condition=Ready','pod/'+name,'--timeout=120s')
    api('/api/v1/settings/system?scope=organization',{'apiKey':key,'url':'http://'+name+'.'+ns+'.svc.cluster.local:18484/v1'},'PATCH')
    for _ in range(20):
        catalog=api('/api/v1/models/available')
        if any(m.get('modelId')=='claude-sonnet-4-6' for m in catalog.get('data',[])):
            break
        time.sleep(2)
    else:
        raise RuntimeError('Temporary model endpoint did not become reachable')
    config={'origin':values['gateway']['webuiOrigin'],'username':credentials['adminUsername'],'password':credentials['adminPassword']}
    if args.resume:
        previous=json.loads((evidence/'webui-before.json').read_text())
        config.update(sessionId=previous['sessionId'],previousNonce=previous['nonce'])
    script='const config = '+json.dumps(config)+';\n'+(source/'webui-smoke.cjs').read_text()
    with (evidence/'driver.log').open('w+') as log:
        process=subprocess.Popen(['k3s','kubectl','-n',ns,'exec','-i','deployment/sudowork-webui','--','node','-'],stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,text=True)
        process.stdin.write(script);process.stdin.close()
        observed={}
        while process.poll() is None:
            pods=json.loads(atlas.kube('-n','moss-sessions','get','pods','-o','json'))['items']
            for pod in pods:
                if pod['spec'].get('runtimeClassName')=='gvisor' and pod.get('status',{}).get('phase')=='Running':
                    observed[pod['metadata']['name']]={'uid':pod['metadata']['uid'],'runtimeClass':'gvisor','image':pod['spec']['containers'][0]['image']}
            time.sleep(.5)
        log.seek(0);lines=log.read().splitlines()
    if process.returncode:
        raise RuntimeError('WebUI smoke failed: '+ '\n'.join(lines[-4:]))
    result=json.loads(next(line for line in reversed(lines) if line.startswith('{"passed"')))
    if not observed:raise RuntimeError('No running gVisor session was observed')
    result['sandboxes']=observed
    atlas.write(evidence/('webui-after.json' if args.resume else 'webui-before.json'),result)
    print('WebUI HTTPS/login/WebSocket/gVisor/transcript'+('/resume' if args.resume else '')+' passed')
finally:
    try:
        api('/api/v1/settings/system?scope=organization',{'apiKey':'','url':original.get('url') or 'https://hk.sudorouter.ai/v1'},'PATCH')
    finally:
        atlas.kube('-n',ns,'delete','pod,service,configmap,secret,networkpolicy',name,'--ignore-not-found','--wait=true')

#!/usr/bin/env python3
"""Real cohost/Nexus write acceptance with a recording model endpoint.

Required: GATE_BIN, NEXUS_VFS_PROTO, NODE_MODULES. Optional: NODE, WORK,
PRESIDIO_IMAGE. Set ROUTER_URL, ROUTER_KEY and MODEL for real inference.
Absent ROUTER_URL uses a clearly labelled synthetic OpenAI endpoint.
"""

import hashlib
import http.server
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
DRIVE = r'''
import grpc from '@grpc/grpc-js';
import loader from '@grpc/proto-loader';
import fs from 'node:fs';
const [work,proto,endpoint,upstream,mode,model]=process.argv.slice(2);
const defs=loader.loadSync(proto+'/nexus/grpc/vfs/vfs.proto',{keepCase:true,longs:String,defaults:true,includeDirs:[proto]});
const API=grpc.loadPackageDefinition(defs).nexus.grpc.vfs.NexusVFSService;
const tls=work+'/data/tls/';
const client=new API(endpoint,grpc.credentials.createSsl(fs.readFileSync(tls+'ca.pem'),fs.readFileSync(tls+'node-key.pem'),fs.readFileSync(tls+'node.pem')),{'grpc.ssl_target_name_override':'nexus-node','grpc.default_authority':'nexus-node'});
const rpc=(method,data)=>new Promise((resolve,reject)=>client[method](data,{deadline:Date.now()+120000},(error,result)=>error?reject(error):resolve(result)));
const terms=['南京澄明数据有限公司','Client-Aster-7400'];
const fakeKey='sk'+'-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const sensitive='😀客户档案：'+terms.join('，')+'，Contact-Aster-7400，'+fakeKey+'。 /no_think 请仅回复OK。';
const publicText='北京星河科技有限公司。 /no_think 请仅回复OK。';
const marked='客户名单：北京星河科技有限公司。 /no_think 请仅回复OK。';
const contract='客户合同：北京星河科技有限公司，Contract-Aster-7400。 /no_think 请仅回复OK。';
const technical='内部技术文档：[INTERNAL_SOURCE] InternalBuildPlan-7400; const token = "'+fakeKey+'"; /no_think 请仅回复OK。';
const sourceSecret='const token = "'+fakeKey+'"; /no_think 请仅回复OK。';
const clean='部署本地推理服务。 /no_think 请仅回复OK。';
const BS=String.fromCharCode(92);
const escaped=value=>value.replace(/[\u007f-\uffff]/g,ch=>BS+'u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
async function write(mount,name,text,isDenied,isEscaped=false) {
 const path=mount+'/'+name+'.prompt';
 const selectedModel=mount==='/model'?(process.env.LOCAL_MODEL||model):model;
 const maxTokens=mount==='/model'?4096:128;
 const raw=JSON.stringify({model:selectedModel,max_tokens:maxTokens,messages:[{role:'user',content:text}]});
 const result=await rpc('Write',{path,content:Buffer.from(isEscaped?escaped(raw):raw)});
 if(Boolean(result.is_error)!==isDenied)throw new Error('Unexpected gate verdict for '+name);
 if(isDenied)return;
 const stored=await rpc('Read',{path});
 if(stored.is_error)throw new Error('Stored prompt missing');
 fs.writeFileSync(work+'/'+name+'.stored.json',stored.content);
 const deadline=Date.now()+120000;
 let textReply='';
 while(Date.now()<deadline) {
  const reply=await rpc('StreamCollectAll',{path:path.replace(/\.prompt$/,'.reply')});
  textReply=reply.data?.toString()||'';
  if(textReply.includes('"done"')||textReply.includes('"error"'))break;
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 fs.writeFileSync(work+'/'+name+'.reply',textReply);
 if(!textReply.includes('"done"')||textReply.includes('"error"'))throw new Error('Model did not complete '+name);
 const footer=textReply.indexOf('{"finish_reason"');
 if(footer<0||!textReply.slice(0,footer).trim())throw new Error('Model returned no visible reply '+name);
}
try {
 for(const mount of ['/cloud-model','/model']) {
  const key=mount==='/model'?(process.env.MOUNT_LOCAL_KEY_OVERRIDE||process.env.LOCAL_ROUTER_KEY||process.env.ROUTER_KEY||'synthetic-only'):(process.env.ROUTER_KEY||'synthetic-only');
  const result=await rpc('Setattr',{path:mount,entry_type:2,backend_type:'openai',backend_name:'business-acceptance',zone_id:'business-'+mode,backend_params:{base_url:upstream+mount+'/v1',api_key:key,blob_root:work+'/blob'+mount}});
  if(result.is_error)throw new Error('Model mount failed');
 }
 await write('/model','local',sensitive,false);
 await write('/cloud-model','sensitive',sensitive,mode!=='redact');
 if(mode!=='outage') {
  await write('/cloud-model','public',publicText,false);
  await write('/cloud-model','marked',marked,mode==='deny');
  await write('/cloud-model','escaped',sensitive,mode==='deny',true);
  await write('/cloud-model','contract',contract,mode==='deny');
  await write('/cloud-model','technical',technical,mode==='deny');
  await write('/cloud-model','source-secret',sourceSecret,mode==='deny');
  await write('/cloud-model','clean',clean,false);
 }
 console.log(JSON.stringify({mode,passed:true}));
} finally {client.close()}
'''


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def main():
    binary = pathlib.Path(os.environ["GATE_BIN"]).resolve(strict=True)
    proto = pathlib.Path(os.environ["NEXUS_VFS_PROTO"]).resolve(strict=True)
    modules = pathlib.Path(os.environ["NODE_MODULES"]).resolve(strict=True)
    if os.environ.get("WORK"):
        root = pathlib.Path(os.environ["WORK"]).resolve()
        root.mkdir(parents=True, exist_ok=False)
    else:
        (HERE / "work").mkdir(exist_ok=True)
        root = pathlib.Path(tempfile.mkdtemp(prefix="business-", dir=HERE / "work"))
    upstream = os.environ.get("ROUTER_URL", "").rstrip("/")
    if upstream and not os.environ.get("ROUTER_KEY"):
        raise ValueError("ROUTER_KEY required for real inference")
    model = os.environ.get("MODEL", "synthetic")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    captures = []
    failures = []

    class RecordingModel(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            body = json.loads(raw)
            captures.append({"mode": self.server.mode, "path": self.path, "body": body})
            is_local = self.path.startswith("/model/")
            target = os.environ.get("LOCAL_ROUTER_URL", upstream).rstrip("/") if is_local else upstream
            token = os.environ.get("LOCAL_ROUTER_KEY", os.environ.get("ROUTER_KEY", "synthetic-only")) if is_local else os.environ.get("ROUTER_KEY", "synthetic-only")
            authorization = self.headers.get("Authorization", "")
            if authorization != "Bearer " + token:
                failures.append("mounted_credential_mismatch")
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"error":{"message":"Mounted credential does not match its route"}}')
                return
            if target:
                try:
                    # curl is also used by deployment health checks. Supply the
                    # credential and exact body through stdin, never argv/files.
                    config = "header = " + json.dumps("Authorization: " + authorization) + "\n"
                    config += 'header = "Content-Type: application/json"\n'
                    config += "data-binary = " + json.dumps(raw.decode("utf-8"), ensure_ascii=False) + "\n"
                    forwarded = subprocess.run(["curl", "--noproxy", "*", "--http1.1", "--silent", "--show-error", "--max-time", "110", "--config", "-", "--write-out", "\n%{http_code}\n%{content_type}", target + "/v1/chat/completions"], input=config.encode(), capture_output=True, timeout=115)
                    result, status_raw, type_raw = forwarded.stdout.rsplit(b"\n", 2)
                    status, content_type = int(status_raw), type_raw.decode("ascii")
                    if forwarded.returncode or not 200 <= status < 300:
                        raise RuntimeError("Upstream inference failed")
                except Exception:
                    failures.append("upstream_inference_failed")
                    status, content_type, result = 502, "application/json", b'{"error":{"message":"Acceptance upstream failed"}}'
            else:
                if body.get("stream"):
                    chunk = {"id": "synthetic", "object": "chat.completion.chunk", "created": int(time.time()), "model": body["model"]}
                    first = {**chunk, "choices": [{"index": 0, "delta": {"role": "assistant", "content": "OK"}, "finish_reason": None}]}
                    last = {**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
                    result = ("data: " + json.dumps(first) + "\n\ndata: " + json.dumps(last) + "\n\ndata: [DONE]\n\n").encode()
                    content_type = "text/event-stream"
                else:
                    result = json.dumps({"id": "synthetic", "object": "chat.completion", "created": int(time.time()), "model": body["model"], "choices": [{"index": 0, "message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}).encode()
                    content_type = "application/json"
                status = 200
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(result)))
            self.end_headers()
            self.wfile.write(result)

        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RecordingModel)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    analyzer_port = free_port()
    run_id = str(os.getpid()) + "-" + secrets.token_hex(8)
    container = "dlp-business-accept-" + run_id
    container_id = None
    units = []
    rows = []
    image = os.environ.get("PRESIDIO_IMAGE", "sudo-presidio-zh:business-20261012")
    try:
        created = subprocess.run(["docker", "run", "-d", "--name", container, "--memory=4g", "--cpus=2", "-p", f"127.0.0.1:{analyzer_port}:3000", "--mount", f"type=bind,src={HERE / 'business-policy.fixture.json'},dst=/app/conf-zh/business-policy.json,readonly", image], check=True, capture_output=True, text=True)
        candidate_id = created.stdout.strip()
        if len(candidate_id) != 64 or any(char not in "0123456789abcdef" for char in candidate_id):
            raise RuntimeError("Docker did not return a confirmed container ID")
        container_id = candidate_id
        for _ in range(90):
            try:
                if opener.open(f"http://127.0.0.1:{analyzer_port}/health", timeout=2).status == 200:
                    break
            except Exception:
                time.sleep(1)
        else:
            raise RuntimeError("Business analyzer not ready")
        subprocess.run(["python3", str(HERE / "business-analyzer.py"), f"http://127.0.0.1:{analyzer_port}"], check=True)
        image_id = subprocess.check_output(["docker", "image", "inspect", "--format", "{{.Id}}", image], text=True).strip()
        for mode in ["redact", "deny", "outage"]:
            work = root / mode
            (work / "data").mkdir(parents=True)
            (work / "id").mkdir()
            (work / "node_modules").symlink_to(modules, target_is_directory=True)
            (work / "drive.mjs").write_text(DRIVE, encoding="utf-8")
            port = free_port()
            unit = "dlp-business-" + run_id + "-" + mode
            analyzer = free_port() if mode == "outage" else analyzer_port
            args = ["systemd-run", "--user", "--quiet", "--unit=" + unit, "-p", "MemoryMax=4G", "-p", "StandardOutput=append:" + str(work / "daemon.log"), "-p", "StandardError=append:" + str(work / "daemon.log"), "--setenv=NEXUS_DATA_DIR=" + str(work / "data"), "--setenv=NEXUS_IDENTITY_DIR=" + str(work / "id"), "--setenv=NEXUS_EGRESS_GATE_MODEL_MOUNTS=/cloud-model", "--setenv=NEXUS_EGRESS_GATE_POLICY=" + ("deny" if mode == "deny" else "redact"), "--setenv=NEXUS_EGRESS_GATE_PRESIDIO_URL=http://127.0.0.1:" + str(analyzer), "--setenv=NEXUS_EGRESS_GATE_PRESIDIO_ENTITIES=PERSON,LOCATION,ORGANIZATION", "--setenv=NEXUS_EGRESS_GATE_PRESIDIO_TIMEOUT_MS=1000", str(binary), "--cluster-init", "business-" + mode, "--hostname", socket.gethostname(), "--bind-addr", "127.0.0.1:" + str(port), "--advertise-addr", "127.0.0.1:" + str(port)]
            subprocess.run(args, check=True)
            units.append(unit)
            for _ in range(60):
                if (work / "data/tls/node.pem").exists():
                    try:
                        with socket.create_connection(("127.0.0.1", port), timeout=1):
                            break
                    except OSError:
                        pass
                time.sleep(0.5)
            else:
                raise RuntimeError("Acceptance daemon not ready")
            server.mode = mode
            result = subprocess.run([os.environ.get("NODE", "node"), str(work / "drive.mjs"), str(work), str(proto), "127.0.0.1:" + str(port), "http://127.0.0.1:" + str(server.server_port), mode, model], capture_output=True, text=True, timeout=900)
            (work / "drive.log").write_text(result.stdout + result.stderr)
            if result.returncode:
                raise RuntimeError("Model write acceptance failed; inspect " + str(work / "drive.log"))
            hits = [item for item in captures if item["mode"] == mode]
            local = [item for item in hits if item["path"].startswith("/model/")]
            cloud = [item for item in hits if item["path"].startswith("/cloud-model/")]
            assert len(local) == 1
            sent = local[0]["body"]["messages"][0]["content"]
            fake_key = "sk" + "-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345"
            protected_values = ["南京澄明数据有限公司", "Client-Aster-7400", "Contact-Aster-7400", "Contract-Aster-7400", "InternalBuildPlan-7400", fake_key]
            assert all(value in sent for value in [*protected_values[:3], fake_key])
            assert len(cloud) == {"redact": 8, "deny": 2, "outage": 0}[mode]
            for item in cloud:
                body = item["body"]
                assert body["model"] == model and body["messages"][0]["role"] == "user"
                text = body["messages"][0]["content"]
                assert all(value not in text for value in protected_values)
                assert not ("客户名单：" in text and "北京星河科技有限公司" in text)
                assert "客户合同：" not in text and "内部技术文档：" not in text
            if mode != "outage":
                assert any("北京星河科技有限公司" in item["body"]["messages"][0]["content"] for item in cloud)
                assert any("部署本地推理服务" in item["body"]["messages"][0]["content"] for item in cloud)
            for path in work.glob("*.stored.json"):
                text = json.loads(path.read_text())["messages"][0]["content"]
                if path.stem != "local.stored":
                    assert all(value not in text for value in protected_values)
            log = (work / "daemon.log").read_text()
            assert all(value not in log for value in protected_values)
            assert not failures, "Upstream did not produce a real response"
            rows.append({"mode": mode, "egress_requests": len(cloud), "local_raw_retained": True, "passed": True})
            print(json.dumps(rows[-1]), flush=True)
            subprocess.run(["systemctl", "--user", "stop", unit], check=True)
        report = {"passed": True, "scope": "model_write_business_policy", "business_families": ["customer_contract", "source_technical"], "visible_model_replies": True, "mount_credentials_forwarded_unchanged": True, "upstream": "configured_router" if upstream else "synthetic_loopback", "model": model, "daemon_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "image_id": image_id, "fixture_sha256": hashlib.sha256((HERE / "business-policy.fixture.json").read_bytes()).hexdigest(), "business_cases_sha256": hashlib.sha256((HERE / "business-cases.fixture.json").read_bytes()).hexdigest(), "cases": rows}
        (root / "acceptance.json").write_text(json.dumps(report, indent=2))
        (root / "synthetic-wire.json").write_text(json.dumps(captures, ensure_ascii=False, indent=2))
        print(json.dumps({"evidence": str(root / "acceptance.json"), **report}), flush=True)
    finally:
        for unit in units:
            subprocess.run(["systemctl", "--user", "stop", unit], capture_output=True)
            subprocess.run(["systemctl", "--user", "reset-failed", unit], capture_output=True)
        if container_id:
            subprocess.run(["docker", "rm", "-f", container_id], capture_output=True)
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()

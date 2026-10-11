#!/usr/bin/env python3
"""Recording proxy between the gated daemon's model mounts and the real Router.

Mount base URLs look like http://127.0.0.1:<port>/<label>/v1. The first path
segment is a label ("egress" or "local"); the rest is forwarded unchanged to
ROUTER_URL. Every request body is written to $CAPTURE/<label>-<n>.json BEFORE
it is forwarded, so a capture is exactly the bytes that left the daemon — the
thing the acceptance asserts on.
"""
import http.server
import itertools
import os
import sys
import urllib.error
import urllib.request

UPSTREAM = os.environ.get("ROUTER_URL", "http://127.0.0.1:3000").rstrip("/")
CAPTURE = os.environ["CAPTURE"]
os.makedirs(CAPTURE, exist_ok=True)
counter = itertools.count(1)


class Proxy(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        parts = self.path.split("/", 2)  # ['', label, rest]
        if len(parts) < 3:
            self.send_error(404)
            return
        label, rest = parts[1], "/" + parts[2]
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        with open(os.path.join(CAPTURE, f"{label}-{next(counter)}.json"), "wb") as f:
            f.write(body)
        req = urllib.request.Request(UPSTREAM + rest, data=body, method="POST")
        for h in ("Authorization", "Content-Type", "Accept"):
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req, timeout=600) as up:
                status, ctype, data = up.status, up.headers.get("Content-Type", ""), up.read()
        except urllib.error.HTTPError as e:
            status, ctype, data = e.code, e.headers.get("Content-Type", ""), e.read()
        self.send_response(status)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        sys.stderr.write("proxy: " + fmt % args + "\n")


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Proxy).serve_forever()

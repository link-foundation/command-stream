"""Does lychee retry a 503, and how often? (issue #216, link-check false failure)

Serves 503 for the first N requests to /flaky, then 200, and counts hits.
Usage: python3 -I lychee-retry-503.py <lychee-binary> <failures> [lychee args...]
"""
import http.server, subprocess, sys, tempfile, threading, os

lychee, failures, extra = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
hits = []

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        hits.append(self.path)
        self.send_response(503 if len(hits) <= failures else 200)
        self.end_headers()
    do_HEAD = do_GET
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory() as tmp:
    doc = os.path.join(tmp, "a.md")
    with open(doc, "w") as f:
        f.write(f"[x](http://127.0.0.1:{server.server_port}/flaky)\n")
    result = subprocess.run([lychee, "--no-progress", "--include", "127.0.0.1", *extra, doc],
                            capture_output=True, text=True, cwd=tmp)
print(f"503s before success={failures} args={extra} -> exit={result.returncode} requests={len(hits)}")
server.shutdown()

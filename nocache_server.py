"""Local dev server with no-store caching, for verifying script edits."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


ThreadingHTTPServer(("127.0.0.1", 8742), NoCacheHandler).serve_forever()

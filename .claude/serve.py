# Static server for VROS with caching off, so edits show up on reload.
import http.server, functools, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
http.server.ThreadingHTTPServer(('', int(sys.argv[1])), functools.partial(H, directory=sys.argv[2])).serve_forever()

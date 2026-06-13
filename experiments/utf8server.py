import http.server, functools, sys

class H(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        t = super().guess_type(path)
        if t and t.split(';')[0] in ('text/html', 'application/xml', 'text/xml', 'application/javascript', 'text/javascript'):
            return t.split(';')[0] + '; charset=utf-8'
        return t

http.server.test(
    HandlerClass=functools.partial(H, directory='/tmp/gh-issue-solver-1781353958747'),
    port=8799, bind='127.0.0.1'
)

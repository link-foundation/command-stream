// Upstream's fetch tests request https://github.com/, so they fail whenever the
// runner cannot reach it (seen on macOS CI). This local server answers the way
// those tests expect: 200 with a page that mentions GitHub, 404 for OPTIONS.

import http from 'node:http';

export async function serveGitHubStub() {
  const server = http.createServer((req, res) => {
    res.writeHead(req.method === 'OPTIONS' ? 404 : 200, {
      'content-type': 'text/html',
    });
    res.end('<!DOCTYPE html><title>GitHub</title>\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

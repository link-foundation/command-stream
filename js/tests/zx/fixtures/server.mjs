// Fake HTTP peer for the zx CLI/goods ports (issue #26): answers every request
// with the next canned raw response (or `pong`).
import net from 'node:net';

export const fakeServer = (data = []) => {
  const server = net.createServer();
  server.on('connection', (conn) => {
    conn.on('data', () => {
      const reply = (data.shift() || 'pong').toString('utf-8');
      conn.write(reply.split(/\r?\n/).join('\r\n'));
    });
  });
  server.stop = () => new Promise((resolve) => server.close(() => resolve()));
  server.start = (port = 0) =>
    new Promise((resolve) =>
      server.listen(port, '127.0.0.1', () => {
        server.url = `http://127.0.0.1:${server.address().port}`;
        resolve(server);
      })
    );
  return server;
};

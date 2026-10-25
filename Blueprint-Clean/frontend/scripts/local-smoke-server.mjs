// Disposable local-only browser harness. Never deploy or proxy to real services.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon' };
createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob:; frame-src 'none'; form-action 'self'");
  response.setHeader('Cache-Control', 'no-store');
  const pathname = new URL(request.url, 'http://127.0.0.1:8765').pathname;
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/auth/login' && request.method === 'POST') {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4096) { response.writeHead(413).end(); return; }
      }
      try {
        const { email, password } = JSON.parse(body);
        const tier = String(email).split('@')[0];
        if (email !== `${tier}@example.test` || !['free', 'paid', 'founder'].includes(tier) || password !== 'local-smoke-only') throw new Error();
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ access_token: `local-only-${tier}`, user: { id: `local-${tier}`, email, username: tier, is_premium: tier !== 'free' } }));
      } catch {
        response.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ detail: 'Use a disposable smoke-test identity.' }));
      }
      return;
    }
    response.writeHead(403).end('No production services are available in this harness.');
    return;
  }
  const relative = decodeURIComponent(pathname).replace(/^\/MAB-Path-Editor\/?/, '').replace(/^\/+/, '');
  const candidate = resolve(root, relative || 'index.html');
  if (!candidate.startsWith(resolve(root) + sep)) { response.writeHead(403).end(); return; }
  try {
    const target = extname(candidate) ? candidate : `${candidate}.html`;
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' }).end(bytes);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(8765, '127.0.0.1', () => console.log('Local-only smoke harness: http://127.0.0.1:8765/MAB-Path-Editor/auth'));

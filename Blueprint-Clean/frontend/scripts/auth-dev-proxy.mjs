import http from 'node:http';

const PORT = 8000;
const LOCAL_ORIGINS = new Set([
  'http://localhost:8082',
  'http://127.0.0.1:8082',
]);
const UPSTREAM = 'https://mab-path-editor.onrender.com';
const ALLOWED_ROUTES = new Map([
  ['POST /api/auth/login', true],
  ['GET /api/auth/me', true],
]);

function corsHeaders(origin) {
  if (!LOCAL_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
    vary: 'Origin',
  };
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin ?? '';
  const route = `${request.method} ${request.url}`;
  const headers = corsHeaders(origin);

  if (!LOCAL_ORIGINS.has(origin)) {
    response.writeHead(403, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Local development origin denied.' }));
    return;
  }

  if (request.method === 'OPTIONS') {
    const requestedMethod = request.headers['access-control-request-method'];
    const requestedRoute = `${requestedMethod} ${request.url}`;
    if (!ALLOWED_ROUTES.has(requestedRoute)) {
      response.writeHead(403, { ...headers, 'content-type': 'application/json' });
      response.end(JSON.stringify({ detail: 'Development proxy route denied.' }));
      return;
    }
    response.writeHead(204, headers);
    response.end();
    return;
  }

  if (!ALLOWED_ROUTES.has(route)) {
    response.writeHead(403, { ...headers, 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Development proxy route denied.' }));
    return;
  }

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  try {
    const upstream = await fetch(`${UPSTREAM}${request.url}`, {
      method: request.method,
      headers: {
        ...(request.headers.authorization
          ? { authorization: request.headers.authorization }
          : {}),
        ...(request.headers['content-type']
          ? { 'content-type': request.headers['content-type'] }
          : {}),
      },
      body: request.method === 'GET' ? undefined : body,
    });
    const result = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      ...headers,
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    });
    response.end(result);
  } catch {
    response.writeHead(502, { ...headers, 'content-type': 'application/json' });
    response.end(JSON.stringify({ detail: 'Live authentication API unavailable.' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`MAB auth-only development proxy listening on http://127.0.0.1:${PORT}`);
});

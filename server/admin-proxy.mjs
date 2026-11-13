// Runs in server functions only; binding URLs never enter the browser bundle.
export async function proxyAdminRequest(request, response, path, method = 'POST') {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== method) {
    response.setHeader('Allow', method);
    sendJson(response, 405, 'Method not allowed.');
    return;
  }

  try {
    const baseUrl = process.env.ADMIN_BACKEND_URL;
    if (!baseUrl) throw new Error('Missing service binding.');
    let body;
    if (method === 'POST') {
      body = request.body;
    }
    if (method === 'POST' && body === undefined) {
      let raw = '';
      for await (const chunk of request) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 20_000) {
          sendJson(response, 413, 'Request too large.');
          return;
        }
      }
      body = raw;
    }
    const serialized = method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body ?? {})) : undefined;
    if (serialized !== undefined && Buffer.byteLength(serialized) > 20_000) {
      sendJson(response, 413, 'Request too large.');
      return;
    }
    const upstream = await fetch(new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`), {
      method,
      headers: {
        ...(serialized !== undefined ? { 'Content-Type': 'application/json' } : {}),
        Authorization: request.headers.authorization ?? '',
      },
      ...(serialized !== undefined ? { body: serialized } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    response.end(await upstream.text());
  } catch {
    sendJson(response, 502, 'Admin service unavailable.');
  }
}

function sendJson(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ message }));
}

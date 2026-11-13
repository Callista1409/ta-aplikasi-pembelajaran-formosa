// Vercel's Angular dev server does not serve api/ functions. This local runner
// serves a production build plus those functions for services/binding smoke tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import remove from '../api/admin/delete-user.mjs';
import authRoster from '../api/admin/auth-roster.mjs';
import reportSummary from '../api/admin/report-summary.mjs';
import { proxyAdminRequest } from './admin-proxy.mjs';

const root = fileURLToPath(new URL('../dist/frontend-angular/browser/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg' };
createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (/^\/api\/student\/[a-z-]+$/.test(path)) return await proxyAdminRequest(request, response, path.replace(/^\/api/, ''));
    if (path === '/api/admin/auth-roster') return await authRoster(request, response);
    if (path === '/api/admin/report-summary') return await reportSummary(request, response);
    if (path === '/api/admin/delete-user') return await remove(request, response);
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(404);
      response.end();
      return;
    }
    let file = resolve(root, `.${decodeURIComponent(path)}`);
    if (!file.startsWith(resolve(root) + sep) && file !== resolve(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) file = resolve(root, 'index.html');
    } catch {
      file = resolve(root, 'index.html');
    }
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500);
    response.end('Build the frontend before running vercel dev.');
  }
}).listen(Number(process.env.PORT || 4200), '127.0.0.1');

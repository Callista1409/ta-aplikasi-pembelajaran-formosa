import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve('dist/frontend-angular/browser');
const port = Number(process.env.PORT ?? 4200);

const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function fileFor(url = '/') {
  const cleanUrl = decodeURIComponent(url.split('?')[0] || '/');
  const candidate = normalize(join(root, cleanUrl));
  if (!candidate.startsWith(root)) return join(root, 'index.html');
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(root, 'index.html');
}

createServer((request, response) => {
  const file = fileFor(request.url);
  response.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  response.setHeader('cache-control', 'no-store');
  createReadStream(file)
    .on('error', () => {
      response.statusCode = 404;
      response.end('Not found');
    })
    .pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Formosa build server: http://127.0.0.1:${port}`);
});

import { proxyAdminRequest } from '../../server/admin-proxy.mjs';

export default async function handler(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (!/^\/api\/student\/[a-z-]+$/.test(path)) {
    response.writeHead(404); response.end(); return;
  }
  return proxyAdminRequest(request, response, path.replace(/^\/api/, ''));
}

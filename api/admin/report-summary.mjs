import { proxyAdminRequest } from '../../server/admin-proxy.mjs';
export default function handler(request, response) {
  return proxyAdminRequest(request, response, 'admin/report-summary');
}

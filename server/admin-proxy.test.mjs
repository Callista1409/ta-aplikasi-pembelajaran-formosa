import assert from 'node:assert/strict';
import { test } from 'node:test';
import remove from '../api/admin/delete-user.mjs';

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
}

test('account deletion proxy preserves authentication and backend status', async () => {
  const previousUrl = process.env.ADMIN_BACKEND_URL;
  const previousFetch = globalThis.fetch;
  try {
    process.env.ADMIN_BACKEND_URL = 'https://internal.example/service/';
    globalThis.fetch = async (url, options) => {
      assert.equal(url.href, 'https://internal.example/service/admin/delete-user');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.deepEqual(JSON.parse(options.body), { identifier: 'test-user' });
      assert.equal(options.redirect, 'error');
      return new Response('{"message":"Unauthorized"}', { status: 401 });
    };
    const res = response();
    await remove({ method: 'POST', headers: { authorization: 'Bearer test-token' }, body: { identifier: 'test-user' } }, res);
    assert.equal(res.status, 401);
    assert.equal(res.headers['Cache-Control'], 'no-store');

    const methodResponse = response();
    await remove({ method: 'GET', headers: {} }, methodResponse);
    assert.equal(methodResponse.status, 405);

    const sizeResponse = response();
    await remove({ method: 'POST', headers: {}, body: 'x'.repeat(20_001) }, sizeResponse);
    assert.equal(sizeResponse.status, 413);

    delete process.env.ADMIN_BACKEND_URL;
    const missingResponse = response();
    await remove({ method: 'POST', headers: {}, body: {} }, missingResponse);
    assert.equal(missingResponse.status, 502);
    assert.equal(missingResponse.body.includes('internal.example'), false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.ADMIN_BACKEND_URL;
    else process.env.ADMIN_BACKEND_URL = previousUrl;
  }
});

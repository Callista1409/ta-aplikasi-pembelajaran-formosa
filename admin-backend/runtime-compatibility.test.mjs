import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('Admin SDK loads and converts signing keys when CommonJS cannot require ESM', () => {
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', `
    const assert = require('node:assert/strict');
    const { generateKeyPairSync } = require('node:crypto');
    const { getAuth } = require('firebase-admin/auth');
    assert.equal(typeof getAuth, 'function');
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const client = require('jwks-rsa')({
      jwksUri: 'https://example.invalid/never-requested',
      getKeysInterceptor: async () => [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' }],
    });
    client.getSigningKey('test-key').then(key => {
      assert.equal(key.getPublicKey(), publicKey.export({ format: 'pem', type: 'spki' }));
    }).catch(error => { console.error(error); process.exitCode = 1; });
  `], { cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const fields = [{ fieldPath: 'createdBy', order: 'ASCENDING' }, { fieldPath: 'updatedAt', order: 'ASCENDING' }];
const index = (group, state = 'READY') => ({
  name: `projects/test/databases/(default)/collectionGroups/${group}/indexes/example`,
  queryScope: 'COLLECTION', fields, state,
});

async function run(existing, apply = true) {
  const calls = [], messages = [];
  const source = readFileSync(new URL('deploy-dashboard-indexes.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace("new URL('../', import.meta.url)", "new URL('file:///test/')");
  const task = runInNewContext(`(async () => { ${source} })()`, {
    URL,
    readFileSync: path => path.pathname.endsWith('firestore.dashboard.indexes.json')
      ? JSON.stringify({ indexes: [{ collectionGroup: 'questions', queryScope: 'COLLECTION', fields }] })
      : JSON.stringify({ project_id: 'test', client_email: 'example', private_key: 'not-a-real-key' }),
    JWT: class { async authorize() { return { access_token: 'fake' }; } },
    process: { argv: apply ? ['--apply'] : [], env: {} },
    console: { log: message => messages.push(message) },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => options.method === 'POST' ? {} : { indexes: existing } };
    },
  });
  await task;
  return { calls, messages };
}

test('an index on flashcards cannot suppress creation of the required questions index', async () => {
  const result = await run([index('flashcards')]);
  const creates = result.calls.filter(call => call.options.method === 'POST');
  assert.equal(creates.length, 1);
  assert(creates[0].url.endsWith('/collectionGroups/questions/indexes'));
  assert.equal(result.calls.some(call => call.options.method === 'DELETE'), false);
});

test('an existing ready questions index is preserved without duplicate creation', async () => {
  const result = await run([index('flashcards'), index('questions')]);
  assert.equal(result.calls.filter(call => call.options.method === 'POST').length, 0);
  assert(result.messages.some(message => message.includes('READY')));
});

test('an in-progress questions index is preserved while dry run never creates missing indexes', async () => {
  const pending = await run([index('questions', 'CREATING')]);
  assert.equal(pending.calls.filter(call => call.options.method === 'POST').length, 0);
  assert(pending.messages.some(message => message.includes('CREATING')));
  const dry = await run([index('flashcards')], false);
  assert.equal(dry.calls.filter(call => call.options.method === 'POST').length, 0);
  assert(dry.messages.some(message => message.includes('Would create questions')));
});

test('a required questions index needing repair is reported rather than recreated', async () => {
  await assert.rejects(run([index('flashcards'), index('questions', 'NEEDS_REPAIR')]), /Repair the existing questions index/);
});

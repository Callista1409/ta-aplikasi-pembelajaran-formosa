import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/core/services/content-read-cache.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const storage = new Map();
  let now = 0, revision = '1', checks = 0, contentReads = 0, failCheck = false;
  const exports = {};
  runInNewContext(compiled, { exports, Date: { now: () => now }, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } });
  const create = () => new exports.ContentReadCache('test-v2', async () => {
    checks++; if (failCheck) throw new Error('version unavailable'); return revision;
  });
  const load = async () => { contentReads++; return [{ id: 'q', prompt: `revision-${revision}` }]; };
  return { create, load, storage, advance: () => { now += 60_001; }, edit: () => { revision = String(Number(revision) + 1); },
    fail: value => { failCheck = value; }, counts: () => ({ checks, contentReads }) };
}

test('browser reload checks one version document and reuses JSON-safe persisted content', async () => {
  const f = fixture();
  await f.create().read('questions:one', f.load);
  const value = await f.create().read('questions:one', f.load);
  assert.equal(value[0].prompt, 'revision-1');
  assert.deepEqual(f.counts(), { checks: 2, contentReads: 1 });
});

test('time alone does not refetch content; a changed revision does', async () => {
  const f = fixture(), cache = f.create();
  await cache.read('cards:one', f.load); f.advance();
  await cache.read('cards:one', f.load);
  assert.equal(f.counts().contentReads, 1);
  f.edit(); f.advance();
  const updated = await cache.read('cards:one', f.load);
  assert.equal(updated[0].prompt, 'revision-2');
  assert.equal(f.counts().contentReads, 2);
});

test('overlapping batches read each missing key once and cache empty groups', async () => {
  const f = fixture(), cache = f.create(), fetched = [];
  const load = async keys => { fetched.push(...keys); return new Map(keys.map(key => [key, []])); };
  await Promise.all([cache.readMany(['a', 'b'], load), cache.readMany(['b', 'c'], load)]);
  await cache.readMany(['a', 'b', 'c'], load);
  assert.deepEqual([...fetched].sort(), ['a', 'b', 'c']);
  assert.equal(f.counts().checks, 1);
});

test('catalog failure rejects stale data and retries the next access', async () => {
  const f = fixture(), cache = f.create();
  await cache.read('cards', f.load); f.advance(); f.fail(true);
  await assert.rejects(cache.read('cards', f.load), /version unavailable/);
  f.fail(false); await cache.read('cards', f.load);
  assert.equal(f.counts().contentReads, 1);
});

test('failed content fetches release every pending ID for retry', async () => {
  const f = fixture(), cache = f.create();
  await assert.rejects(cache.readMany(['one', 'two'], async () => { throw new Error('offline'); }), /offline/);
  const values = await cache.readMany(['one', 'two'], async keys => new Map(keys.map(key => [key, key])));
  assert.equal(values.join(','), 'one,two');
});

test('invalidation during a read retries instead of persisting or returning the old version', async () => {
  const f = fixture(), cache = f.create(); let finish, calls = 0;
  const pending = cache.read('cards', async () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : ['new']);
  await tick(); f.edit(); cache.invalidate(); finish(['old']);
  assert.equal((await pending)[0], 'new');
  assert.equal((await f.create().read('cards', f.load))[0], 'new');
});

test('malformed browser storage falls back to the server loader', async () => {
  const f = fixture(); f.storage.set('test-v2:cards', '{broken');
  await f.create().read('cards', f.load);
  assert.equal(f.counts().contentReads, 1);
});

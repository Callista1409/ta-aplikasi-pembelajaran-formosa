import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const root = new URL('../src/app/', import.meta.url);
function load(file, imports = {}) {
  const source = readFileSync(new URL(file, root), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, require: (id) => imports[id] ?? {} });
  return exports;
}
const signal = (value) => Object.assign(() => value, { set: (next) => { value = next; } });
const core = { Component: () => (value) => value, Injectable: () => (value) => value, signal, computed: (read) => read };
const existing = { id: 'hat', name: 'Topi', price: 50, icon: 'H', previewUrl: 'old-preview', previewPublicId: 'preview-id', accessoryUrl: 'old-layer', accessoryPublicId: 'layer-id', active: false, sortOrder: 7, requiredLevel: 3 };
function fixture(initial = [existing]) {
  const state = { documents: new Map(initial.map((item) => [item.id, { ...item }])), uploads: [], writes: [], fail: false, next: null };
  const emit = () => state.next({ docs: [...state.documents].map(([id, value]) => ({ id, data: () => value })) });
  const upload = { uploadAccessoryImage: async (file, kind) => { state.uploads.push(kind); return { url: `new-${kind}`, publicId: `${kind}-id` }; } };
  const Media = Symbol('Media'); const Route = Symbol('Route');
  const firestore = {
    collection: () => ({}), doc: (_, collection, id) => ({ collection, id }), serverTimestamp: () => 'server-time',
    setDoc: async (reference, payload) => { state.writes.push({ reference, payload }); state.documents.set(reference.id, { ...state.documents.get(reference.id), ...payload }); emit(); },
    onSnapshot: (_, next) => { state.next = next; emit(); return () => {}; },
    runTransaction: async (_, run) => {
      if (state.fail) throw new Error('offline');
      const writes = [];
      await run({ get: async ({ id }) => ({ exists: () => state.documents.has(id), data: () => state.documents.get(id) }),
        set: (reference, payload) => writes.push({ reference, payload }) });
      for (const write of writes) { state.documents.set(write.reference.id, { ...state.documents.get(write.reference.id), ...write.payload }); state.writes.push(write); }
      emit();
    },
  };
  const module = load('features/admin/accessory-management.component.ts', {
    '@angular/core': { ...core, inject: (token) => token === Media ? upload : { snapshot: { data: { dashboardLabel: 'Dashboard Guru' } } } },
    '@angular/router': { ActivatedRoute: Route }, '../../core/services/media-upload.service': { MediaUploadService: Media },
    'firebase/firestore': firestore,
  });
  const component = new module.AccessoryManagementComponent();
  component.validateAccessory = async () => {};
  return { state, component };
}

test('edit keeps the ID, image assets, inactive status and order without reuploading', async () => {
  const { state, component } = fixture();
  component.openForm(component.items()[0]);
  component.form.name = 'Topi Baru'; component.form.price = 80;
  await component.save();
  const saved = state.documents.get('hat');
  assert.equal(saved.name, 'Topi Baru'); assert.equal(saved.price, 80);
  assert.equal(saved.previewUrl, 'old-preview'); assert.equal(saved.accessoryUrl, 'old-layer');
  assert.equal(saved.active, false); assert.equal(saved.sortOrder, 7);
  assert.equal(saved.icon, 'H'); assert.equal(state.uploads.length, 0); assert.equal(component.formOpen(), false);
});
test('edit replaces only the selected image', async () => {
  const { state, component } = fixture();
  component.openForm(component.items()[0]); component.previewFile = { type: 'image/png', size: 12 };
  await component.save();
  assert.equal(state.documents.get('hat').previewUrl, 'new-preview');
  assert.equal(state.documents.get('hat').accessoryUrl, 'old-layer');
  assert.equal(state.uploads.join(','), 'preview');
});
test('create validates both images and adds a new catalog document', async () => {
  const { state, component } = fixture(); component.openForm();
  Object.assign(component.form, { id: 'new-hat', name: 'Topi baru', price: 20 });
  await component.save(); assert.equal(state.writes.length, 0);
  component.previewFile = { type: 'image/png', size: 12 }; component.accessoryFile = { type: 'image/png', size: 12 };
  await component.save();
  assert.equal(state.documents.get('new-hat').previewUrl, 'new-preview');
  assert.equal(state.documents.get('new-hat').accessoryUrl, 'new-accessory');
  assert.equal(state.documents.get('new-hat').active, true);
});
test('duplicate IDs and invalid prices do not overwrite existing accessories', async () => {
  const { state, component } = fixture(); component.openForm();
  Object.assign(component.form, { id: 'hat', name: 'Overwrite', price: 20 });
  await component.save(); assert.equal(state.writes.length, 0); assert.equal(state.uploads.length, 0);
  component.openForm(component.items()[0]); component.form.price = -1;
  await component.save(); assert.equal(state.writes.length, 0); assert(component.error());
});
test('delete hides the catalog item and keeps the original ID as a tombstone', async () => {
  const { state, component } = fixture(); component.requestDelete(component.items()[0]);
  await component.deleteAccessory();
  assert.equal(state.documents.get('hat').deleted, true); assert.equal(state.documents.get('hat').active, false);
  assert.equal(component.items().length, 0); assert.equal(component.pendingDelete(), null);
  assert(state.writes.every((write) => write.reference.collection === 'accessories'));
});
test('failed delete remains reviewable and cannot claim success', async () => {
  const { state, component } = fixture(); const item = component.items()[0];
  component.requestDelete(item); state.fail = true; await component.deleteAccessory();
  assert.equal(component.pendingDelete().id, item.id); assert.equal(component.saving(), false);
  assert.equal(state.documents.get('hat').deleted, undefined); assert(component.error());
});
test('a stale edit cannot resurrect a deleted accessory', async () => {
  const { state, component } = fixture(); component.openForm(component.items()[0]);
  state.documents.set('hat', { ...existing, deleted: true }); await component.save();
  assert.equal(state.writes.length, 0); assert.equal(state.documents.get('hat').deleted, true); assert(component.error());
});
test('disabled and deleted built-in accessories never reappear through the student fallback', () => {
  let next;
  const { StudentLearningService } = load('features/student/student-learning.service.ts', {
    '@angular/core': core, 'firebase/firestore': { collection: () => ({}), onSnapshot: (_, run) => { next = run; return () => {}; } },
  });
  const harness = { catalog: signal([]), catalogLoaded: false, ownedAccessories: signal({ hat: { owned: true, equipped: true } }),
    accessories: signal([{ id: 'hat', price: 50 }]), localAccessoryCatalog: [{ id: 'hat', name: 'Topi', price: 50 }],
    syncAccessories: StudentLearningService.prototype.syncAccessories };
  StudentLearningService.prototype.watchAccessoryCatalog.call(harness);
  for (const flags of [{ active: false }, { deleted: true }]) {
    next({ docs: [{ id: 'hat', data: () => ({ ...existing, ...flags }) }] });
    assert.equal(harness.catalog().length, 0); assert.equal(harness.accessories().length, 0);
  }
});
test('only admin exposes management and accessory writes remain restricted to admin', () => {
  const { ADMIN_ROUTES } = load('features/admin/admin.routes.ts');
  const { TEACHER_ROUTES } = load('features/teacher/teacher.routes.ts');
  assert(ADMIN_ROUTES[0].children.some((route) => route.path === 'accessories' && route.loadComponent));
  assert(!TEACHER_ROUTES[0].children.some((route) => route.path === 'accessories' && route.loadComponent));
  assert(!TEACHER_ROUTES[0].data.navigation.some((item) => item.path === 'accessories'));
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const block = rules.match(/match \/accessories\/\{accessoryId\} \{([^}]+)\}/)[1];
  assert(block.includes('allow create, update, delete: if isAdmin();'));
  assert(!block.includes('isTeacher()'));
});
test('legacy level requirements do not split the catalog or appear in the edit form', async () => {
  const { state, component } = fixture();
  assert.equal(component.items().length, 1);
  assert.equal('requiredLevel' in component.items()[0], false);
  component.openForm(component.items()[0]);
  assert.equal('requiredLevel' in component.form, false);
  component.form.price = 60;
  await component.save();
  assert.equal(state.documents.get('hat').price, 60);
  const template = readFileSync(new URL('../src/app/features/admin/accessory-management.component.html', import.meta.url), 'utf8');
  assert(!template.includes('requiredLevel'));
});

test('reordering uses one catalog including accessories with legacy level metadata', async () => {
  const { state, component } = fixture([
    { ...existing, id: 'basic-a', requiredLevel: 0, sortOrder: 0 },
    { ...existing, id: 'legacy', requiredLevel: 3, sortOrder: 1 },
    { ...existing, id: 'basic-b', requiredLevel: 0, sortOrder: 2 },
  ]);
  component.startDrag('basic-a'); await component.dropOn('legacy');
  assert.equal(state.documents.get('legacy').sortOrder, 0);
  assert.equal(state.documents.get('basic-a').sortOrder, 1);
  assert.equal(state.documents.get('basic-b').sortOrder, 2);
  assert.equal(state.documents.get('legacy').requiredLevel, 3);
});

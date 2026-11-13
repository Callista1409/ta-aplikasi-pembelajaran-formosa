import { createHash } from 'node:crypto';
import { AggregateField } from 'firebase-admin/firestore';

export const REPORT_TTL_MS = 120_000;
const pending = new Map();
const categories = ['writing', 'listening', 'speaking', 'reading'];
const invalid = message => Object.assign(new Error(message), { status: 400 });

export function reportRequest(input) {
  if (!input || !['activity', 'content'].includes(input.kind)) throw invalid('Jenis laporan tidak valid.');
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(input.start) || !validDate(input.end) || input.start > input.end
    || (Date.parse(input.end) - Date.parse(input.start)) / 86400000 > 366) throw invalid('Pilih rentang laporan maksimal 367 hari.');
  if (!Array.isArray(input.ids) || input.ids.length > 50
    || input.ids.some(id => typeof id !== 'string' || !id || id.length > 128 || id.includes('/'))) throw invalid('Daftar akun laporan tidak valid.');
  const offset = input.offsetMinutes ?? 420;
  if (!Number.isInteger(offset) || Math.abs(offset) > 840) throw invalid('Zona waktu laporan tidak valid.');
  return { kind: input.kind, start: input.start, end: input.end, ids: [...new Set(input.ids)].sort(),
    offsetMinutes: offset, includeTotals: input.kind === 'activity' && input.includeTotals === true,
    includeCategories: input.kind === 'activity' && input.includeCategories === true };
}

async function sum(query, field) {
  // Separate aggregations preserve legacy records that omit other numeric fields.
  const snapshot = await query.aggregate({ value: AggregateField.sum(field) }).get();
  return Number(snapshot.data().value) || 0;
}

async function mapLimited(values, load) {
  const result = Object.create(null);
  let next = 0;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => {
    while (!failed && next < values.length) {
      const id = values[next++];
      try { result[id] = await load(id); } catch (error) { failed = true; throw error; }
    }
  }));
  return result;
}

export async function buildReport(db, request) {
  if (request.kind === 'activity') {
    const rows = await mapLimited(request.ids, async id => {
      const source = db.collection('studentActivityLogs').where('studentId', '==', id)
        .where('dateId', '>=', request.start).where('dateId', '<=', request.end);
      const supported = source.where('type', 'in', ['learn_flashcard', 'test_session']);
      const pointEarned = await sum(supported, 'pointEarned');
      if (!request.includeTotals && !request.includeCategories) return { pointEarned };
      const [questionCount, learned, ...counts] = await Promise.all([
        sum(supported, 'questionCount'),
        source.where('type', '==', 'learn_flashcard').count().get().then(s => s.data().count),
        ...(request.includeCategories ? categories.map(category => sum(supported, `categoryCounts.${category}`)) : []),
      ]);
      return { pointEarned, questionCount, learnedCount: learned,
        ...(request.includeCategories ? { categoryCounts: Object.fromEntries(categories.map((category, index) => [category, counts[index]])) } : {}) };
    });
    if (request.includeTotals && request.ids.length) {
      const points = await db.getAll(...request.ids.map(id => db.collection('studentPoints').doc(id)));
      points.forEach((snapshot, index) => {
        const value = snapshot.data() ?? {};
        rows[request.ids[index]].totalPoints = Number(value.totalStarsEarned ?? value.totalPoints) || 0;
      });
    }
    return rows;
  }
  const start = new Date(Date.parse(request.start) - request.offsetMinutes * 60_000);
  const end = new Date(Date.parse(request.end) + 86400000 - request.offsetMinutes * 60_000);
  return mapLimited(request.ids, async id => {
    const values = await Promise.all(['flashcards', 'questions'].map(async name => {
      const source = db.collection(name).where('createdBy', '==', id);
      const within = (query, field) => query.where(field, '>=', start).where(field, '<', end);
      const unionCount = async query => {
        // Inclusion/exclusion preserves records missing either timestamp. A mixed-field
        // OR adds implicit ordering that otherwise excludes these legacy records.
        const [created, updated, both] = await Promise.all([
          within(query, 'createdAt').count().get(), within(query, 'updatedAt').count().get(),
          within(within(query, 'createdAt'), 'updatedAt').count().get(),
        ]);
        return created.data().count + updated.data().count - both.data().count;
      };
      const [all, inactive] = await Promise.all([unionCount(source), unionCount(source.where('active', '==', false))]);
      return all - inactive;
    }));
    return { flashcards: values[0], questions: values[1] };
  });
}

export async function dashboardReport(db, input, { now = Date.now, build = buildReport } = {}) {
  const request = reportRequest(input);
  const key = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const scope = `${db.projectId ?? 'default'}:${key}`;
  // Share concurrent requests within one backend instance; no failed result is cached.
  if (pending.has(scope)) {
    const existing = await pending.get(scope);
    if (input.refresh !== true) return existing;
  }
  const task = (async () => {
    const ref = db.collection('dashboardReportCache').doc(`v1-${key}`);
    if (input.refresh !== true) {
      const saved = (await ref.get()).data();
      if (saved?.version === 1 && saved.expiresAt > now()) return saved.result;
    }
    const result = { rows: await build(db, request), generatedAt: now() };
    await ref.set({ version: 1, subjectIds: request.ids, expiresAt: now() + REPORT_TTL_MS, result });
    return result;
  })().finally(() => { if (pending.get(scope) === task) pending.delete(scope); });
  pending.set(scope, task);
  return task;
}

export async function purgeReportCache(db, uid) {
  while (true) {
    const page = await db.collection('dashboardReportCache').where('subjectIds', 'array-contains', uid).limit(100).get();
    if (page.empty) return;
    const batch = db.batch();
    page.docs.forEach(item => batch.delete(item.ref));
    await batch.commit();
  }
}

import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { buildPosttestPlan, posttestSummary, POSTTEST_VERSION } from './student-curriculum/content/posttest-plan.mjs';
import { posttestRequirements, posttestVocabulary, unitChapter, wordForms } from './student-curriculum/content/posttest-curriculum.mjs';
import { pretestListeningQuestion } from './student-curriculum/content/listening-question.mjs';

const categories = ['reading', 'listening', 'speaking', 'writing'];
const points = { reading: 7, listening: 3, speaking: 6, writing: 10 };
const error = (status, message) => Object.assign(new Error(message), { status });
const stamp = () => FieldValue.serverTimestamp();
const integer = (n, max = 1_000_000) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
const id = value => {
  if (typeof value !== 'string' || !value || value.length > 180 || value.includes('/')) throw error(400, 'ID tidak valid.');
  return value;
};
const clean = value => JSON.parse(JSON.stringify(value));
function keys(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !allowed.includes(key))) throw error(400, 'Field permintaan tidak diizinkan.');
}
function usable(snapshot) {
  return snapshot.exists && snapshot.data().active !== false && snapshot.data().deleted !== true;
}
const cardData = snapshot => ({ ...snapshot.data(), id: snapshot.id, unitId: snapshot.data().unitId ?? snapshot.data().unitID });
function periods(now) {
  // Formosa uses one server-controlled school timezone, independent of the browser clock.
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  const dateId = `${get('year')}-${get('month')}-${get('day')}`;
  const day = new Date(`${dateId}T00:00:00Z`);
  const dayIndex = (day.getUTCDay() + 6) % 7;
  const thursday = new Date(day); thursday.setUTCDate(day.getUTCDate() + 3 - dayIndex);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return { dateId, monthId: dateId.slice(0, 7), dayIndex, weekId: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

export async function authorizeStudent(auth, request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || !header.slice(7)) throw error(401, 'Token akun diperlukan.');
  try { return await auth.verifyIdToken(header.slice(7), true); }
  catch { throw error(401, 'Token akun tidak valid atau telah dicabut.'); }
}

// Every mutation re-reads the account inside its transaction. A concurrent deletion
// or deactivation causes a retry and denial rather than resurrecting student data.
export async function studentAction(db, uid, action, body, now = new Date()) {
  id(uid);
  const ref = (collection, key) => db.collection(collection).doc(key);
  const accountRef = ref('studentPoints', uid);
  return db.runTransaction(async tx => {
    const [profile, deletion] = await Promise.all([
      tx.get(ref('users', uid)), tx.get(ref('accountDeletionJobs', uid)),
    ]);
    const user = profile.data();
    if (!profile.exists || user.role !== 'student' || user.active !== true || deletion.exists
      || ['deleting', 'failed'].includes(user.deletionStatus)) throw error(403, 'Akun murid aktif diperlukan.');
    const owned = snapshot => {
      if (!snapshot.exists || snapshot.data().studentId !== uid) throw error(404, 'Data milik akun ini tidak ditemukan.');
      return snapshot.data();
    };
    const balance = snapshot => {
      const data = snapshot.data() ?? {};
      if (data.studentId && data.studentId !== uid) throw error(409, 'Pemilik saldo tidak sesuai.');
      const starBalance = number(data.starBalance ?? data.totalPoints);
      return { ...data, starBalance, totalStarsEarned: Math.max(starBalance, number(data.totalStarsEarned ?? data.totalPoints)) };
    };
    const saveBalance = data => tx.set(accountRef, {
      ...data, studentId: uid, totalPoints: data.totalStarsEarned, starSchemaVersion: 2, updatedAt: stamp(),
    }, { merge: true });
    const log = (key, data) => tx.set(ref('studentActivityLogs', key), {
      studentId: uid, ...periods(now), createdAt: stamp(), categoryCounts: Object.fromEntries(categories.map(c => [c, 0])),
      pointEarned: 0, questionCount: 0, flashcardId: null, unitId: null, ...data,
    });

    if (action === 'initialize') {
      keys(body, []);
      const snapshot = await tx.get(accountRef);
      const account = balance(snapshot);
      // Preserve the existing legacy migration's known lifetime earnings on the server.
      if (typeof snapshot.data()?.totalStarsEarned !== 'number') {
        const history = await tx.get(db.collection('studentActivityLogs').where('studentId', '==', uid));
        account.totalStarsEarned = Math.max(account.totalStarsEarned, history.docs.reduce((sum, item) => sum + number(item.data().pointEarned), 0));
      }
      saveBalance(account);
      return { ok: true };
    }

    if (action === 'progress') {
      keys(body, ['ids', 'learned', 'source']);
      if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100
        || typeof body.learned !== 'boolean' || !['manual', 'bulk'].includes(body.source)) throw error(400, 'Progres tidak valid.');
      const ids = [...new Set(body.ids.map(id))];
      const snapshots = await Promise.all(ids.map(async cardId => {
        const [card, previous] = await Promise.all([
          tx.get(ref('flashcards', cardId)), tx.get(ref('studentProgress', `${uid}_${cardId}`)),
        ]);
        if (!usable(card)) throw error(404, 'Flashcard tidak tersedia.');
        const unit = await tx.get(ref('units', id(cardData(card).unitId)));
        const supporting = unit.exists && posttestRequirements(Number(user.grade)).some(requirement => requirement.supporting
          && requirement.grade === Number(unit.data().grade) && requirement.chapter === unitChapter({ ...unit.data(), id: unit.id })
          && wordForms(requirement.word).some(form => wordForms(card.data().hanzi).includes(form)));
        if (!usable(unit) || (Number(unit.data().grade) !== Number(user.grade) && !supporting)) throw error(403, 'Materi di luar kelas akun.');
        if (previous.exists) owned(previous);
        return { cardId, card: cardData(card), previous: previous.data() };
      }));
      const changed = [], progress = [];
      for (const { cardId, card, previous } of snapshots) {
        if (body.source === 'bulk' && ((!body.learned && previous?.learnedSource !== 'bulk') || (body.learned && previous?.learned))) {
          progress.push({ flashcardId: cardId, learned: previous?.learned === true, learnedSource: previous?.learnedSource ?? 'manual' });
          continue;
        }
        tx.set(ref('studentProgress', `${uid}_${cardId}`), {
          studentId: uid, flashcardId: cardId, learned: body.learned, learnedSource: body.source,
          learnedAt: body.learned ? stamp() : null, updatedAt: stamp(),
        });
        if (body.learned && !previous?.learned) log(`${uid}_learn_${randomUUID()}`, { type: 'learn_flashcard', flashcardId: cardId, unitId: card.unitId });
        changed.push(cardId);
        progress.push({ flashcardId: cardId, learned: body.learned, learnedSource: body.source });
      }
      return { changed, progress };
    }

    if (action === 'practice-start') {
      // Accept, but ignore, metadata sent by older open browser tabs during rollout.
      keys(body, ['sessionId', 'unitId', 'questionIds', 'anchorQuestionIds']);
      const sessionId = id(body.sessionId), unitId = id(body.unitId);
      if (!Array.isArray(body.questionIds) || body.questionIds.length !== 10 || new Set(body.questionIds).size !== 10) throw error(400, 'Sesi memerlukan 10 soal berbeda.');
      const sessionRef = ref('studentPracticeSessions', `${uid}_${sessionId}`);
      const [existing, unit, accountSnapshot] = await Promise.all([tx.get(sessionRef), tx.get(ref('units', unitId)), tx.get(accountRef)]);
      if (existing.exists) {
        const saved = owned(existing);
        if (saved.protocolVersion !== 1 || saved.unitId !== unitId || saved.status !== 'in_progress') throw error(409, 'Mulai sesi baru setelah pembaruan keamanan.');
        return allocation(saved);
      }
      if (!usable(unit) || Number(unit.data().grade) !== Number(user.grade)) throw error(403, 'Unit di luar kelas akun.');
      const plan = await Promise.all(body.questionIds.map(async questionId => {
        const question = await tx.get(ref('questions', id(questionId)));
        if (!usable(question) || !categories.includes(question.data().category)) throw error(404, 'Soal tidak tersedia.');
        const card = await tx.get(ref('flashcards', id(question.data().flashcardId)));
        if (!usable(card) || cardData(card).unitId !== unitId) throw error(403, 'Soal di luar unit sesi.');
        const learned = await tx.get(ref('studentProgress', `${uid}_${card.id}`));
        if (!learned.exists || owned(learned).learned !== true) throw error(409, 'Pelajari kosakata soal sebelum memulai.');
        const canonicalCard = cardData(card);
        const canonicalQuestion = pretestListeningQuestion({ ...question.data(), id: question.id }, canonicalCard, Number(user.grade));
        return { card: canonicalCard, question: canonicalQuestion, questionId: question.id, category: question.data().category };
      }));
      const account = balance(accountSnapshot), today = periods(now).dateId;
      const sessionOrder = Math.floor(number(account.practiceSessionCount)) + 1;
      const sessionOfDay = account.practiceSessionDateId === today ? Math.floor(number(account.practiceSessionsStartedToday)) + 1 : 1;
      const session = { protocolVersion: 1, studentId: uid, sessionId, sessionOrder, sessionOfDay,
        sessionKind: sessionOfDay === 1 ? 'scheduled' : 'additional', unitId, grade: Number(user.grade),
        plan: clean(plan), questionCount: 10, answerCount: 0,
        pendingPoints: 0, status: 'in_progress', startedDateId: today };
      saveBalance({ ...account, practiceSessionCount: sessionOrder, practiceSessionDateId: today, practiceSessionsStartedToday: sessionOfDay });
      tx.set(sessionRef, { ...session, startedAt: stamp() });
      return allocation(session);
    }

    if (['practice-answer', 'practice-finish', 'practice-abandon'].includes(action)) {
      keys(body, action === 'practice-answer' ? ['sessionId', 'questionOrder', 'response', 'skipped', 'writingMistakes', 'writingStrokes'] : ['sessionId']);
      const sessionId = id(body.sessionId), sessionRef = ref('studentPracticeSessions', `${uid}_${sessionId}`);
      const session = owned(await tx.get(sessionRef));
      if (session.protocolVersion !== 1) throw error(409, 'Sesi lama tidak dapat dilanjutkan. Mulai sesi baru.');
      if (action === 'practice-abandon') {
        if (session.status === 'in_progress') tx.update(sessionRef, { status: 'abandoned', abandonedAt: stamp() });
        return { ok: true };
      }
      if (action === 'practice-finish') {
        const logId = `${uid}_practice_${sessionId}`;
        if (session.status === 'completed') return { points: session.totalPoints, credited: false, logId };
        if (session.status !== 'in_progress' || session.answerCount !== session.questionCount) throw error(409, 'Jawab seluruh soal sesi sebelum menyelesaikan.');
        const account = balance(await tx.get(accountRef));
        const earned = session.pendingPoints;
        saveBalance({ ...account, starBalance: account.starBalance + earned, totalStarsEarned: account.totalStarsEarned + earned });
        tx.update(sessionRef, { status: 'completed', totalPoints: earned, completedAt: stamp() });
        log(logId, { type: 'test_session', unitId: session.unitId, sessionId, sessionOrder: session.sessionOrder,
          sessionOfDay: session.sessionOfDay, sessionKind: session.sessionKind,
          pointEarned: earned, questionCount: session.questionCount,
          categoryCounts: Object.fromEntries(categories.map(c => [c, session.plan.filter(p => p.category === c).length])) });
        return { points: earned, credited: true, logId };
      }
      if (!integer(body.questionOrder, session.questionCount) || body.questionOrder < 1) throw error(400, 'Urutan soal tidak valid.');
      const eventRef = ref('studentPracticeAnswerEvents', `${uid}_${sessionId}_${body.questionOrder}`);
      const event = await tx.get(eventRef);
      if (event.exists) {
        const saved = owned(event);
        if (JSON.stringify(saved.submission) !== JSON.stringify(submission(body))) throw error(409, 'Jawaban sudah tersimpan dan tidak dapat diganti.');
        return { awardedPoint: saved.awardedPoint, correct: saved.correct, progress: saved.progress };
      }
      if (session.status !== 'in_progress' || body.questionOrder !== session.answerCount + 1) throw error(409, 'Urutan jawaban tidak sesuai sesi.');
      const item = session.plan[body.questionOrder - 1];
      const progressRef = ref('studentQuestionProgress', `${uid}_${item.questionId}`);
      const oldProgress = await tx.get(progressRef);
      if (oldProgress.exists) owned(oldProgress);
      const previous = oldProgress.data() ?? {}, successes = Math.floor(number(previous.rewardCorrectAttemptsR3));
      const assessment = assess(item, body, false);
      const awardedPoint = assessment.correct ? Math.round(assessment.basePoint * Math.max(0, 3 - successes) / 3) : 0;
      const progress = { studentId: uid, questionId: item.questionId, status: assessment.correct ? 'correct' : 'wrong',
        attempts: Math.floor(number(previous.attempts)) + 1, correctAttempts: Math.floor(number(previous.correctAttempts)) + (assessment.correct ? 1 : 0),
        wrongAttempts: Math.floor(number(previous.wrongAttempts)) + (assessment.correct ? 0 : 1),
        rewardCorrectAttemptsR3: successes + (assessment.correct ? 1 : 0), lastAnsweredAtSeconds: Math.floor(now.getTime() / 1000) };
      tx.set(progressRef, { ...progress, lastAnsweredAt: stamp(), updatedAt: stamp() });
      tx.create(eventRef, { studentId: uid, sessionId, sessionOrder: session.sessionOrder, questionOrder: body.questionOrder,
        questionId: item.questionId, flashcardId: item.card.id, unitId: session.unitId, category: item.category,
        ...assessment, awardedPoint,
        submission: submission(body), progress, createdAt: stamp() });
      tx.update(sessionRef, { answerCount: session.answerCount + 1, pendingPoints: session.pendingPoints + awardedPoint });
      return { awardedPoint, correct: assessment.correct, progress };
    }

    if (action === 'accessory') {
      keys(body, ['accessoryId', 'equipped']);
      const accessoryId = id(body.accessoryId);
      if (typeof body.equipped !== 'boolean') throw error(400, 'Status aksesori tidak valid.');
      const ownedRef = ref('studentAccessories', `${uid}_${accessoryId}`);
      const [catalog, saved, accountSnapshot, allOwned] = await Promise.all([
        tx.get(ref('accessories', accessoryId)), tx.get(ownedRef), tx.get(accountRef),
        tx.get(db.collection('studentAccessories').where('studentId', '==', uid)),
      ]);
      if (!usable(catalog) || !integer(catalog.data().price)) throw error(404, 'Aksesori atau harga tidak tersedia.');
      if (saved.exists) owned(saved);
      const account = balance(accountSnapshot), alreadyOwned = saved.data()?.owned === true;
      const price = alreadyOwned ? 0 : catalog.data().price;
      if (price > account.starBalance) throw error(409, 'Saldo bintang belum mencukupi.');
      saveBalance({ ...account, starBalance: account.starBalance - price });
      // A desired state, not a toggle, makes a lost-response retry idempotent.
      if (body.equipped) for (const entry of allOwned.docs) {
        if (entry.id !== ownedRef.id && entry.data().equipped === true) tx.update(entry.ref, { equipped: false, updatedAt: stamp() });
      }
      tx.set(ownedRef, { studentId: uid, accessoryId, owned: true, equipped: body.equipped, updatedAt: stamp() });
      return { ok: true, charged: price, starBalance: account.starBalance - price };
    }

    if (action === 'posttest-start') {
      keys(body, []);
      const sessionId = `posttest-v${POSTTEST_VERSION}-${uid}-g${Number(user.grade)}`;
      const sessionRef = ref('testSessions', sessionId);
      const existing = await tx.get(sessionRef);
      if (existing.exists) {
        const saved = owned(existing);
        if (saved.protocolVersion === 1 || saved.status === 'completed') return saved;
      }
      // Canonical curriculum and plan are built server-side; client plans/scores are never accepted.
      const [units, cards] = await Promise.all([tx.get(db.collection('units')), tx.get(db.collection('flashcards'))]);
      const map = snapshot => snapshot.docs.filter(usable).map(item => ({ ...item.data(), id: item.id }));
      const vocabulary = posttestVocabulary(Number(user.grade), map(units), cards.docs.filter(usable).map(cardData), new Set());
      let plan = buildPosttestPlan(Number(user.grade), vocabulary);
      if (plan.length !== 60) throw error(409, 'Materi posttest belum lengkap (60 soal). Hubungi pengelola.');
      let answers = [];
      if (existing.exists) {
        // Preserve the old order, but rebuild content and re-grade submitted responses.
        // Legacy flags, answer keys, totals and scores are never copied into authoritative fields.
        const old = existing.data(), canonical = new Map(plan.map(item => [item.questionId, item]));
        if (!Array.isArray(old.plan) || old.plan.length !== 60 || new Set(old.plan.map(item => item.questionId)).size !== 60
          || old.plan.some(item => !canonical.has(item.questionId)) || !Array.isArray(old.answers) || old.answers.length > 60) {
          throw error(409, 'Posttest lama tidak sesuai kurikulum. Pengelola perlu meninjau data; hasil lama tetap disimpan.');
        }
        plan = old.plan.map(item => canonical.get(item.questionId));
        answers = old.answers.map((answer, index) => {
          const item = plan[index];
          if (answer.questionId !== item.questionId) throw error(409, 'Urutan posttest lama perlu ditinjau pengelola.');
          const body = { response: answer.response ?? '', skipped: answer.skipped === true,
            writingMistakes: answer.writingMistakes ?? 0, writingStrokes: answer.writingTotalStrokes ?? answer.writingStrokes ?? 0 };
          return posttestAnswer(item, body);
        });
        // Keep an immutable, server-only backup rather than discarding historical evidence.
        tx.create(ref('studentAssessmentLegacy', sessionId), { ...old, studentId: uid, archivedAt: stamp() });
      }
      const session = clean({ id: sessionId, protocolVersion: 1, studentId: uid, mode: 'posttest',
        grade: Number(user.grade), version: POSTTEST_VERSION, plan, answers, status: answers.length === 60 ? 'completed' : 'in_progress', ...posttestSummary(answers, plan) });
      tx.set(sessionRef, { ...session, startedAt: existing.data()?.startedAt ?? stamp(), updatedAt: stamp() });
      return session;
    }

    if (action === 'posttest-answer') {
      keys(body, ['questionId', 'response', 'skipped', 'writingMistakes', 'writingStrokes']);
      const sessionId = `posttest-v${POSTTEST_VERSION}-${uid}-g${Number(user.grade)}`;
      const sessionRef = ref('testSessions', sessionId), session = owned(await tx.get(sessionRef));
      if (session.protocolVersion !== 1) throw error(409, 'Posttest lama memerlukan peninjauan migrasi.');
      const prior = session.answers.find(answer => answer.questionId === body.questionId);
      if (prior) {
        if (JSON.stringify(prior.submission) !== JSON.stringify(submission(body))) throw error(409, 'Jawaban tidak dapat diganti.');
        return session;
      }
      const item = session.plan[session.answers.length];
      if (session.status !== 'in_progress' || !item || item.questionId !== body.questionId) throw error(409, 'Urutan jawaban tidak sesuai.');
      const answer = posttestAnswer(item, body);
      const answers = [...session.answers, answer], status = answers.length === session.plan.length ? 'completed' : 'in_progress';
      const next = { ...session, answers, status, ...posttestSummary(answers, session.plan) };
      tx.set(sessionRef, { ...next, updatedAt: stamp(), ...(status === 'completed' ? { completedAt: stamp() } : {}) });
      return next;
    }
    throw error(404, 'Operasi murid tidak ditemukan.');
  });
}

function allocation(session) {
  return { sessionId: session.sessionId, sessionOrder: session.sessionOrder, sessionOfDay: session.sessionOfDay,
    sessionKind: session.sessionKind, plan: session.plan };
}
function posttestAnswer(item, body) {
  const assessment = assess(item, body, true);
  return { questionId: item.questionId, category: item.category, response: body.response,
    skipped: body.skipped, correct: assessment.correct, score: assessment.score, earnedScore: assessment.score,
    writingMistakes: body.writingMistakes ?? 0, writingStrokes: body.writingStrokes ?? 0,
    writingTotalStrokes: body.writingStrokes ?? 0, verification: assessment.verification, submission: submission(body) };
}
function submission(body) {
  return { response: body.response, skipped: body.skipped, writingMistakes: body.writingMistakes ?? 0, writingStrokes: body.writingStrokes ?? 0 };
}
const normalize = value => value.normalize('NFKC').replace(/[\s.,!?;:'"，。！？；：、]/g, '').toLowerCase();
function matches(actual, expected) {
  actual = normalize(actual); expected = normalize(expected);
  if (!actual || !expected) return false;
  if (actual === expected) return true;
  if (expected.length < 2) return false;
  let row = Array.from({ length: expected.length + 1 }, (_, i) => i);
  for (let i = 1; i <= actual.length; i++) {
    const next = [i];
    for (let j = 1; j <= expected.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (actual[i - 1] === expected[j - 1] ? 0 : 1));
    row = next;
  }
  return row[expected.length] <= (expected.length <= 3 ? 1 : Math.max(1, Math.floor(expected.length * .25)));
}

export function assess(item, body, posttest) {
  if (typeof body.response !== 'string' || body.response.length > 1000 || typeof body.skipped !== 'boolean') throw error(400, 'Jawaban tidak valid.');
  let score = 0, correct = false;
  let verification = 'server-answer-key';
  if (item.category === 'writing') {
    verification = 'client-writing-telemetry';
    if (!integer(body.writingMistakes, 10000) || !integer(body.writingStrokes, 2000)) throw error(400, 'Data tulisan tidak valid.');
    if (!body.skipped && wordForms(item.card.hanzi).some(form => normalize(form) === normalize(body.response)) && body.writingStrokes > 0) {
      score = Math.max(0, 1 - body.writingMistakes / body.writingStrokes);
      // Preserve the application's existing posttest decimal scoring and practice rounding.
      if (posttest) score = Math.round(score * 1000000) / 1000000;
      correct = posttest ? score === 1 : Math.round(points.writing * score) > 0;
    }
  } else if (item.category === 'speaking') {
    verification = 'client-speech-transcript';
    correct = !body.skipped && wordForms(item.card.hanzi).some(form => matches(body.response, form));
    score = correct ? 1 : 0;
  } else {
    correct = !body.skipped && body.response === (item.question.correctAnswer || item.card.meaning);
    score = correct ? 1 : 0;
  }
  return { correct, basePoint: posttest ? 1 : Math.round(points[item.category] * score), score, verification };
}

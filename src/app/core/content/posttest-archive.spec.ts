import { posttestArchiveEntry } from './posttest-archive';

function completedSession(): Record<string, unknown> {
  const categories = ['reading', 'listening', 'speaking', 'writing'];
  return {
    mode: 'posttest', status: 'completed', studentId: 'student-a', grade: 5, version: 1,
    completedAt: { seconds: 1000 },
    plan: Array.from({ length: 60 }, (_, index) => ({ questionId: `q${index}`, category: categories[Math.floor(index / 15)], question: { prompt: 'Soal', correctAnswer: 'Jawaban' } })),
    answers: Array.from({ length: 60 }, (_, index) => ({ questionId: `q${index}`, category: categories[Math.floor(index / 15)], correct: index < 30, skipped: false, response: '' })),
    percentage: 999, correct: 999,
  };
}

describe('Posttest archive', () => {
  it('recomputes assessment marks from the saved answers, separate from practice points', () => {
    const entry = posttestArchiveEntry('session-a', completedSession())!;
    expect(entry.summary.correct).toBe(30);
    expect(entry.summary.percentage).toBe(50);
    expect(entry.completedAt).toBe(1000000);
    expect(entry.studentId).toBe('student-a');
  });

  it('excludes unfinished posttests and normal practice sessions', () => {
    expect(posttestArchiveEntry('a', { ...completedSession(), status: 'in_progress' })).toBeNull();
    expect(posttestArchiveEntry('a', { ...completedSession(), mode: 'practice' })).toBeNull();
  });

  it('retains completed sessions from previous grades and versions', () => {
    const entry = posttestArchiveEntry('old', { ...completedSession(), grade: 1, version: 2, completedAt: undefined })!;
    expect(entry.grade).toBe(1);
    expect(entry.version).toBe(2);
    expect(entry.completedAt).toBeNull();
  });

  it('excludes incomplete or duplicated answer records', () => {
    const session = completedSession();
    const answers = session['answers'] as Array<Record<string, unknown>>;
    expect(posttestArchiveEntry('a', { ...session, answers: answers.slice(1) })).toBeNull();
    answers[1] = answers[0];
    expect(posttestArchiveEntry('a', session)).toBeNull();
  });
});
import { PosttestSession, posttestSummary } from './posttest-plan';

export interface PosttestArchiveEntry extends PosttestSession {
  studentId: string;
  completedAt: number | null;
  summary: ReturnType<typeof posttestSummary>;
}

/** Read completed assessments from their original storage; never award practice points. */
export function posttestArchiveEntry(id: string, value: Record<string, unknown>): PosttestArchiveEntry | null {
  if (value['mode'] !== 'posttest' || value['status'] !== 'completed' || typeof value['studentId'] !== 'string') return null;
  const plan = value['plan'] as PosttestSession['plan'];
  const answers = value['answers'] as PosttestSession['answers'];
  if (!Array.isArray(plan) || plan.length !== 60 || !Array.isArray(answers) || answers.length !== 60) return null;
  if (plan.some((item) => !item?.question || typeof item.question.prompt !== 'string' || typeof item.question.correctAnswer !== 'string')) return null;
  if (new Set(answers.map((answer) => answer?.questionId)).size !== 60 || answers.some((answer, index) =>
    !answer || !plan[index] || answer.questionId !== plan[index].questionId || answer.category !== plan[index].category || typeof answer.correct !== 'boolean')) return null;
  const grade = Number(value['grade']);
  if (!Number.isInteger(grade) || grade < 1 || grade > 6) return null;
  const timestamp = value['completedAt'] as { seconds?: number } | undefined;
  return { id, studentId: value['studentId'], grade, version: Number(value['version']) || 1,
    plan, answers, status: 'completed', completedAt: typeof timestamp?.seconds === 'number' ? timestamp.seconds * 1000 : null,
    summary: posttestSummary(answers) };
}
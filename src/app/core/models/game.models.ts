import { QuestionCategory } from './content.models';

export interface TestSessionQuestion {
  questionId: string;
  category: QuestionCategory;
  awardedPoint: number;
  correct: boolean;
}

export interface TestSession {
  id: string;
  studentId: string;
  unitId: string;
  startedAt: string;
  completedAt?: string;
  questions: TestSessionQuestion[];
  totalPoint: number;
}

export interface MonthlyStudentReport {
  studentId: string;
  month: string;
  learnedVocabulary: number;
  completedQuestions: number;
  earnedPoints: number;
  categories: Record<QuestionCategory, number>;
}

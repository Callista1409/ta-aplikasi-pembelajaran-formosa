export type UserRole = 'admin' | 'teacher' | 'student';
export type QuestionCategory = 'writing' | 'listening' | 'speaking' | 'reading';

export interface AppUser {
  id: string;
  displayName: string;
  username: string;
  email?: string;
  role: UserRole;
  grade?: number;
  active: boolean;
  hiddenFromRoster?: boolean;
  deletionStatus?: 'deleting' | 'failed';
}

export interface LearningUnit {
  id: string;
  grade: number;
  name: string;
  description: string;
}

export interface Flashcard {
  id: string;
  unitId: string;
  hanzi: string;
  pinyin: string;
  meaning: string;
  imageUrl?: string;
  imagePublicId?: string;
  audioUrl?: string;
  audioMode?: 'tts';
  ttsText?: string;
  createdBy: string;
  createdAtSeconds?: number;
  updatedAtSeconds?: number;
}

export interface Question {
  id: string;
  flashcardId: string;
  category: QuestionCategory;
  prompt: string;
  audioText?: string;
  passage?: string;
  options?: string[];
  correctOption?: 'A' | 'B' | 'C' | 'D';
  correctAnswer: string;
  maximumPoint: number;
  createdBy: string;
  createdAtSeconds?: number;
  updatedAtSeconds?: number;
}

export interface QuestionPointRule {
  id: string;
  category: QuestionCategory;
  point: number;
  active: boolean;
}

export interface StudentFlashcardProgress {
  studentId: string;
  flashcardId: string;
  learned: boolean;
  learnedAt?: string;
}

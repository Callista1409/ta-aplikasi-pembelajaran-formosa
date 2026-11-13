import { Flashcard, Question } from '../models/content.models';
import { ListeningScenario, listeningScenarios } from './listening-scenarios';

const comprehensionPrompt = 'Dengarkan cerita pendek dan pertanyaannya, lalu pilih jawaban yang tepat. Audio dibacakan dua kali.';

function vocabularyForms(hanzi: string): string[] {
  return hanzi.split(/[/／]/u).map((word) => word.replace(/[（(].*?[）)]/gu, '').replace(/[…\s]/gu, '').trim()).filter(Boolean);
}

function fallbackScenario(grade: 5 | 6, word: string, variant: number): ListeningScenario {
  // Unmatched vocabulary stays in a complete classroom story, never a lone-word audio.
  const stories: Array<Pick<ListeningScenario, 'audioText' | 'answers'>> = grade === 5 ? [
    { audioText: `今天老师请小兰练习“${word}”这个词。小兰先问老师意思，再跟同学一起练习。小兰先做什么？`, answers: ['问老师意思', '跟同学练习', '回家休息', '做明天的作业'] },
    { audioText: `弟弟不懂“${word}”这个词的意思。他先问哥哥，可是哥哥也不懂，最后姐姐告诉了他。谁告诉弟弟这个词的意思？`, answers: ['姐姐', '哥哥', '老师', '妈妈'] },
    { audioText: `老师请大家明天交作业，今天先练习“${word}”这个词。小兰以为今天要交作业，同学说是明天。大家什么时候交作业？`, answers: ['明天', '今天', '昨天', '下个星期'] },
  ] : [
    { audioText: `小云用“${word}”这个词写了一句话，可是意思不清楚。老师请她先说明想说什么，再改写句子。小云说明以后，才发现自己用错了词。老师请小云先做什么？`, answers: ['说明想说的意思', '马上交作业', '把句子读三次', '重新抄写这个词'] },
    { audioText: `老师请同学们记录今天学的词。小海不懂“${word}”，先问同学，可是同学也不清楚。老师说明以后，两个人才写完记录。他们为什么能写完记录？`, answers: ['老师说明了词的意思', '同学早就知道意思', '老师替他们写好了', '他们没有写这个词'] },
    { audioText: `姐姐把“${word}”写在卡片上，放进书包，准备明天带去学校。弟弟以为卡片在桌上，找了很久。后来姐姐告诉他卡片在哪里。卡片最后在哪里找到？`, answers: ['书包里', '桌子上', '学校里', '弟弟的房间里'] },
  ];
  return { grade, targets: [word], ...stories[variant % stories.length] };
}

/** Adapt existing listening records while retaining their IDs and progress history. */
export function pretestListeningQuestion(question: Question, card: Flashcard, grade: number | undefined): Question {
  if (question.category !== 'listening' || (grade !== 5 && grade !== 6)) return question;

  // Preserve a teacher's complete comprehension question if it already has a valid key.
  if (/[？?]/u.test(question.audioText ?? '') && (question.audioText?.length ?? 0) >= 25
    && question.options?.length === 4 && new Set(question.options).size === 4
    && question.options.every((option) => /[\u3400-\u9fff]/u.test(option))
    && question.options.includes(question.correctAnswer)) return {
      ...question,
      prompt: comprehensionPrompt,
      correctOption: (['A', 'B', 'C', 'D'] as const)[question.options.indexOf(question.correctAnswer)],
    };

  const seed = Array.from(question.id).reduce((sum, character) => sum + character.codePointAt(0)!, 0);
  const forms = vocabularyForms(card.hanzi);
  const candidates = listeningScenarios.filter((scenario) => scenario.grade === grade
    && scenario.targets.some((target) => forms.includes(target) && scenario.audioText.includes(target)));
  const scenario = candidates.length ? candidates[seed % candidates.length]
    : fallbackScenario(grade, forms.at(-1) || card.hanzi, seed);
  const correctAnswer = scenario.answers[0];
  const options = [...scenario.answers];
  const position = seed % 4;
  options.unshift(...options.splice(4 - position, position));
  return {
    ...question,
    prompt: comprehensionPrompt,
    audioText: scenario.audioText,
    options,
    correctAnswer,
    correctOption: (['A', 'B', 'C', 'D'] as const)[position],
  };
}

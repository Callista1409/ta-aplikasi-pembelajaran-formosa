import { Flashcard, Question, QuestionCategory } from '../models/content.models';
import { listeningScenarios, ListeningScenario } from './listening-scenarios';
import { posttestReadings } from './posttest-reading';
import { PosttestVocabulary, wordForms } from './posttest-curriculum';

export const POSTTEST_VERSION = 1;
export interface PosttestItem {
  card: Flashcard;
  category: QuestionCategory;
  questionId: string;
  question: Question;
}
export interface PosttestAnswer {
  questionId: string;
  category: QuestionCategory;
  response: string;
  correct: boolean;
  skipped: boolean;
  writingMistakes: number;
  writingTotalStrokes?: number;
  earnedScore?: number;
  writingStrokes?: number;
  /** Normalized assessment credit, 0 to 1. Missing on legacy binary answers. */
  score?: number;
}
export interface PosttestSession {
  id: string;
  grade: number;
  version: number;
  plan: PosttestItem[];
  answers: PosttestAnswer[];
  status: 'in_progress' | 'completed';
}

function shufflePosttestItems(items: PosttestItem[]): PosttestItem[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

const listeningWords: Record<number, string> = {
  1: '六 一 八 两 三 对不起 我们 大家 你好 很 谢谢 不用 再见 没关系 您',
  2: '穿 书包 来 说 台 杯子 问 方 高 瘦 圆 桌子 听 一样 电脑',
  3: '外婆 姑姑 堂妹 孙女 表弟 舞蹈社 学校 参加 送 乐队 考卷 成绩 最 用心 作业',
  4: '体育馆 厕所 上楼 旁边 楼下 历史 体育 认真 新 容易 认识 快乐 祝福 希望 帮忙',
};
const speakingWords: Record<number, string> = {
  1: '九 百 个 早 你早 大家 您 吗 很好 不客气 对不起 没关系 不用 他们 你好',
  2: '穿 帽子 鞋 说 背 哪里 本 台 杯子 方 圆 胖 桌子 看到 一样',
  3: '爷爷 外婆 叔叔 舅舅 堂哥 外孙女 球队 合唱团 休息 可是 大考 考卷 成绩单 重要 时候',
  4: '办公室 校长室 运动场 厕所 下楼 科学 历史 体育 认识 有趣 祝 快乐 身体 祝福 帮忙',
  5: '华人 取 让 觉得 花生 如果 最后 意思 台湾 中学生 长大 交朋友 洗衣店 以后 老先生',
  6: '发财 平安 年夜饭 吉利话 压岁钱 聪明 奇怪 安心 方块 争吵 照相 挂 得奖 从小 事情',
};
const writingWords: Record<number, string> = {
  1: '一 二 五 八 十 两 你 我 他 你好 我们 你们 再见 谢谢 请',
  2: '穿 戴 帽子 书包 上学 哪里 笔 白纸 问题 回答 电脑 高 瘦 字 一样',
  3: '奶奶 姑姑 表妹 孙子 儿子 学校 乐队 参加 回家 想 雨衣 考试 作业 成绩 用心',
  4: '教室 体育馆 餐厅 楼上 旁边 数学 美术 认真 容易 生日 健康 礼物 希望 帮 卡片',
  5: '家人 像 记住 为了 介绍 英国 日本 年级 小学 出生 外向 内向 说话 餐馆 文化',
  6: '恭喜 年糕 水饺 红包 新年 甜 声音 清楚 可怜 照片 后院 文静 玩具 努力 文字',
};

function upperListening(grade: number): Array<ListeningScenario & { word: string }> {
  const pool = listeningScenarios.filter((scenario) => scenario.grade === grade);
  if (grade === 5) {
    const anchors = '华人 家人 像 取 花生 哭 为了 英国人 越南 年级 读书 外向 餐馆 文化'.split(' ');
    return [
      ...pool.slice(0, 14).map((scenario, index) => ({ ...scenario, word: anchors[index] })),
      { grade: 5, targets: ['长大'], word: '长大', audioText: '姐姐长大以后想当老师，弟弟却想开一家餐馆。两个人都很用心读书。谁长大以后想当老师？', answers: ['姐姐', '弟弟', '爸爸', '妈妈'] },
    ];
  }
  const anchors = '年糕 红包 恭喜 甜 压 清楚 方块 照片 后院 文静 努力 记录'.split(' ');
  return [
    ...pool.slice(0, 12).map((scenario, index) => ({ ...scenario, word: anchors[index] })),
    { grade: 6, targets: ['脑'], word: '脑', audioText: '这道题很难，老师请大家动脑想一想。小文先画图，再写答案；小安先写答案，发现不对才画图。谁先画图？', answers: ['小文', '小安', '老师', '两个人都没有画图'] },
    { grade: 6, targets: ['女人'], word: '女人', audioText: '那位女人带来两张照片，一张是她小时候，一张是她的女儿。她把女儿的照片给老师看，把自己的收好。老师看的是谁的照片？', answers: ['女人的女儿', '女人小时候', '老师的女儿', '女人的妹妹'] },
    { grade: 6, targets: ['个子'], word: '个子', audioText: '哥哥个子高，喜欢打球。妹妹个子不高，却很喜欢在台上唱歌。今天得奖的是妹妹，哥哥在台下为她高兴。谁今天得奖了？', answers: ['妹妹', '哥哥', '老师', '两个人都得奖了'] },
  ];
}

export function buildPosttestPlan(grade: number, vocabulary: PosttestVocabulary[]): PosttestItem[] {
  if (grade < 1 || grade > 6 || !vocabulary.length) return [];
  const plan: PosttestItem[] = [];
  const findCard = (word: string): Flashcard | undefined => {
    // 很好 is a phrase formed from two required words, not an extra prerequisite.
    const target = word === '很好' ? '好' : word;
    const forms = wordForms(target);
    const row = vocabulary.find((entry) => wordForms(entry.word).some((form) => forms.includes(form)));
    const card = row?.cards[0];
    if (!card) return undefined;
    const variants = card.hanzi.split(/[/／]/u).map((variant) => variant.replace(/[（(].*?[）)]/gu, '').trim());
    const pinyinVariants = card.pinyin.split(/[/／]/u);
    const variantIndex = variants.indexOf(word);
    const pinyin = variantIndex >= 0 && pinyinVariants.length === variants.length ? pinyinVariants[variantIndex].trim() : card.pinyin;
    return { ...card, hanzi: word, pinyin };
  };
  const add = (category: QuestionCategory, word: string, fields: Partial<Question>, cardOverride?: Flashcard) => {
    const card = cardOverride ?? findCard(word);
    if (!card) return;
    const index = plan.filter((item) => item.category === category).length;
    const id = `posttest-v${POSTTEST_VERSION}-g${grade}-${category}-${index + 1}`;
    const question: Question = { id, category, flashcardId: card.id, prompt: '', correctAnswer: word,
      maximumPoint: 1, createdBy: 'posttest-curriculum', ...fields };
    if (question.options) {
      const position = index % 4;
      const options = [...question.options];
      options.unshift(...options.splice(4 - position, position));
      question.options = options;
      question.correctOption = (['A', 'B', 'C', 'D'] as const)[position];
    }
    plan.push({ card, category, questionId: id, question });
  };
  for (const row of posttestReadings(grade)) {
    add('reading', row.word, { passage: row.passage, prompt: row.prompt, options: [...row.answers], correctAnswer: row.answers[0] });
  }
  if (grade <= 4) {
    const words = listeningWords[grade].split(' ');
    words.forEach((word, index) => {
      const distractors = [...words.slice(index + 1), ...words.slice(0, index)].filter((option) => option !== word).slice(0, 3);
      add('listening', word, { prompt: 'Dengarkan audio dua kali, lalu pilih kosakata yang kamu dengar.', audioText: word,
        options: [word, ...distractors], correctAnswer: word });
    });
  } else {
    upperListening(grade).forEach((row) => add('listening', row.word, {
      prompt: 'Dengarkan cerita dan pertanyaannya dua kali, lalu pilih jawaban yang tepat.',
      audioText: row.audioText, options: [...row.answers], correctAnswer: row.answers[0],
    }));
  }
  speakingWords[grade].split(' ').forEach((word) => add('speaking', word, { prompt: 'Ucapkan kosakata berikut dengan jelas.' }));
  writingWords[grade].split(' ').forEach((word) => {
    const card = findCard(word);
    if (card) add('writing', word, { prompt: `Tulis karakter Mandarin untuk: ${card.meaning} (${card.pinyin}).` }, card);
  });
  return shufflePosttestItems(plan);
}

export function posttestWritingScore(mistakes: number, strokes: number): number {
  if (!Number.isFinite(strokes) || strokes <= 0 || !Number.isFinite(mistakes)) return 0;
  return Math.max(0, Math.round(10 * (1 - Math.max(0, mistakes) / strokes))) / 10;
}

/** Accept both saved answer formats while preserving legacy binary results. */
export function posttestAnswerScore(answer: PosttestAnswer): number {
  if (answer.skipped) return 0;
  if (answer.category === 'writing') {
    const score = answer.score ?? answer.earnedScore;
    if (typeof score === 'number' && Number.isFinite(score)) return Math.max(0, Math.min(1, score));
  }
  return answer.correct ? 1 : 0;
}

export function posttestSummary(answers: PosttestAnswer[], plan: PosttestItem[] = []) {
  const categories = (['reading', 'listening', 'speaking', 'writing'] as const).map((category) => ({
    category, correct: answers.filter((answer) => answer.category === category && answer.correct).length,
    earned: answers.filter((answer) => answer.category === category)
      .reduce((sum, answer) => sum + posttestAnswerScore(answer), 0),
    score: Math.round(answers.filter(answer => answer.category === category).reduce((sum, answer) => sum + posttestAnswerScore(answer), 0) * 100) / 100,
    total: plan.length ? plan.filter((item) => item.category === category).length : 15,
  }));
  const correct = categories.reduce((sum, category) => sum + category.correct, 0);
  const earned = categories.reduce((sum, category) => sum + category.earned, 0);
  const total = plan.length ? plan.length : 60;
  return { categories, correct, earned: Math.round(earned * 100) / 100, score: Math.round(earned * 100) / 100, total,
    percentage: total ? Math.round(earned / total * 10000) / 100 : 0 };
}

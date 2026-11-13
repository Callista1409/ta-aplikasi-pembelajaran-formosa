import { Flashcard } from '../models/content.models';

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, '');
}

/** Match Mandarin, pinyin (with or without tones/spaces), or meaning. */
export function matchesVocabulary(card: Flashcard, query: string): boolean {
  const normalized = normalizeSearch(query);
  return !normalized || [card.hanzi, card.pinyin, card.meaning]
    .some((value) => normalizeSearch(value).includes(normalized));
}

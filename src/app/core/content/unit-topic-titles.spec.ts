import { unitTopicTitle } from './unit-topic-titles';

describe('unit topic titles', () => {
  it('uses class-specific titles for the same chapter number', () => {
    expect(unitTopicTitle(1, 3)).toBe('Ungkapan Sopan');
    expect(unitTopicTitle(6, 3)).toBe('Fotografi dan Penghargaan');
  });

  it('returns no override for chapters without a title', () => {
    expect(unitTopicTitle(6, 9)).toBeUndefined();
    expect(unitTopicTitle(6, null)).toBeUndefined();
  });
});

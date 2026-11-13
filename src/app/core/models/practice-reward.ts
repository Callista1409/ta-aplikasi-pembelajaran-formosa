/** Three successful answers per student/question receive a decreasing reward.
 * The caller supplies successes recorded under this policy, excluding legacy history. */
export function practiceReward(basePoint: number, correct: boolean, previousSuccesses: number): number {
  if (!Number.isInteger(basePoint) || basePoint < 0) throw new Error('Poin dasar tidak valid.');
  if (!Number.isInteger(previousSuccesses) || previousSuccesses < 0) throw new Error('Urutan reward tidak valid.');
  const limit = 3;
  return correct ? Math.round(basePoint * Math.max(0, limit - previousSuccesses) / limit) : 0;
}

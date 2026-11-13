export interface StarAccount {
  totalStarsEarned: number;
  starBalance: number;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function hasStarAccount(data: Record<string, unknown> | undefined): boolean {
  return !!data && typeof data['totalStarsEarned'] === 'number'
    && Number.isFinite(data['totalStarsEarned']) && data['totalStarsEarned'] >= 0
    && typeof data['starBalance'] === 'number' && Number.isFinite(data['starBalance'])
    && data['starBalance'] >= 0 && data['starBalance'] <= data['totalStarsEarned'];
}

/** Legacy totalPoints is a spending balance. Logs recover known lifetime earnings,
 * without estimating historical purchases from today's accessory prices. */
export function readStarAccount(data?: Record<string, unknown>, historicalEarned = 0): StarAccount {
  const starBalance = nonNegative(data?.['starBalance'] ?? data?.['totalPoints']);
  const totalStarsEarned = Math.max(starBalance,
    nonNegative(data?.['totalStarsEarned'] ?? data?.['totalPoints']), nonNegative(historicalEarned));
  return { totalStarsEarned, starBalance };
}

export function creditStars(account: StarAccount, earned: number): StarAccount {
  if (!Number.isFinite(earned) || earned < 0) throw new Error('Jumlah star tidak valid.');
  return { totalStarsEarned: account.totalStarsEarned + earned, starBalance: account.starBalance + earned };
}

export function spendStars(account: StarAccount, price: number): StarAccount {
  if (!Number.isFinite(price) || price < 0) throw new Error('Harga aksesori tidak valid.');
  if (price > account.starBalance) throw new Error('Saldo star belum mencukupi.');
  return { totalStarsEarned: account.totalStarsEarned, starBalance: account.starBalance - price };
}

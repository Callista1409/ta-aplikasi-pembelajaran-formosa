/** Account-scoped, in-memory request cache. Failed/invalidated requests never publish. */
export class DashboardRequestCache {
  private entries = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
  clear(): void { this.entries.clear(); }
  read<T>(key: string, load: () => Promise<T>, refresh = false): Promise<T> {
    const saved = this.entries.get(key);
    if (!refresh && saved && saved.expiresAt > Date.now()) return saved.promise as Promise<T>;
    const promise = Promise.resolve().then(load);
    const entry = { promise, expiresAt: Infinity };
    this.entries.set(key, entry);
    promise.then(() => { entry.expiresAt = Date.now() + 120_000; }, () => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return promise;
  }
}

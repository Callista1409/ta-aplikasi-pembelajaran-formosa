/** Persistent cache for JSON-safe shared content, never student progress or answers. */
export class ContentReadCache {
  private readonly memory = new Map<string, { revision: string; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private revisionRequest: Promise<string> | null = null;
  private checkedAt = 0;
  private generation = 0;

  constructor(
    private readonly storagePrefix: string,
    private readonly loadRevision: () => Promise<string>,
    private readonly checkIntervalMs = 60_000,
  ) {}

  async read<T>(key: string, load: () => Promise<T>): Promise<T> {
    return (await this.readMany([key], async () => new Map([[key, await load()]])))[0];
  }

  /** Share overlapping batches and cache each key, rather than a particular ID grouping. */
  async readMany<T>(keys: string[], load: (missing: string[]) => Promise<Map<string, T>>): Promise<T[]> {
    const generation = this.generation;
    const revision = await this.revision();
    if (generation !== this.generation) return this.readMany(keys, load);
    const requestKey = (key: string) => JSON.stringify([generation, revision, key]);
    const missing = [...new Set(keys)].filter(key => !this.entry(key, revision) && !this.pending.has(requestKey(key)));
    if (missing.length) {
      const request = Promise.resolve().then(() => load(missing));
      missing.forEach(key => {
        const pendingKey = requestKey(key);
        const valueRequest = request.then(values => {
          if (!values.has(key)) throw new Error(`Missing content cache key: ${key}`);
          const value = values.get(key)!;
          if (generation === this.generation) {
            const entry = { revision, value };
            this.memory.set(key, entry);
            try { localStorage.setItem(this.storageKey(key), JSON.stringify(entry)); } catch { /* Memory still works. */ }
          }
          return value;
        }).finally(() => this.pending.delete(pendingKey));
        this.pending.set(pendingKey, valueRequest);
      });
    }
    const values = await Promise.all(keys.map(key => {
      const entry = this.entry<T>(key, revision);
      return entry ? entry.value : this.pending.get(requestKey(key)) as Promise<T>;
    }));
    // Never return a read invalidated by an edit in this browser while in flight.
    return generation === this.generation ? values : this.readMany(keys, load);
  }

  /** Force the next access to check the catalog after a successful content write. */
  invalidate(): void {
    this.generation++;
    this.revisionRequest = null;
    this.memory.clear();
  }

  private revision(): Promise<string> {
    if (!this.revisionRequest || Date.now() - this.checkedAt >= this.checkIntervalMs) {
      this.checkedAt = Date.now();
      const request = Promise.resolve().then(this.loadRevision);
      this.revisionRequest = request;
      request.catch(() => { if (this.revisionRequest === request) this.revisionRequest = null; });
    }
    return this.revisionRequest;
  }

  private entry<T>(key: string, revision: string): { revision: string; value: T } | undefined {
    const memory = this.memory.get(key);
    if (memory?.revision === revision) return memory as { revision: string; value: T };
    try {
      const raw = localStorage.getItem(this.storageKey(key));
      if (!raw) return undefined;
      const entry = JSON.parse(raw);
      if (entry?.revision !== revision || !('value' in entry)) return undefined;
      this.memory.set(key, entry);
      return entry;
    } catch { return undefined; }
  }

  private storageKey(key: string): string { return `${this.storagePrefix}:${key}`; }
}

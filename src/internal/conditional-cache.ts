/**
 * The conditional-GET cache behind `conditionalRequests`.
 *
 * One entry per GET URL: the `ETag` the server sent and the RAW JSON body it
 * came with. On the next GET of that URL the client sends `If-None-Match`; a
 * `304` resolves by re-parsing the stored JSON through the call's own Zod
 * schema. Storing the raw JSON (not the parsed value) means every reuse hands
 * the caller a fresh object — a caller that mutates a result cannot corrupt
 * what the next call returns — and the schema is applied on every reuse
 * exactly as it is on a fresh body.
 *
 * Bounded LRU: a `Map` iterates in insertion order, so re-inserting on every
 * read keeps the most recently used at the end and the first key is always the
 * eviction candidate.
 */

export type ConditionalCacheEntry = {
  readonly etag: string;
  readonly body: unknown;
};

export class ConditionalCache {
  private readonly entries = new Map<string, ConditionalCacheEntry>();

  constructor(private readonly maxEntries: number) {}

  get(url: string): ConditionalCacheEntry | undefined {
    const entry = this.entries.get(url);
    if (entry === undefined) return undefined;
    this.entries.delete(url);
    this.entries.set(url, entry);
    return entry;
  }

  set(url: string, entry: ConditionalCacheEntry): void {
    this.entries.delete(url);
    this.entries.set(url, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(url: string): void {
    this.entries.delete(url);
  }

  get size(): number {
    return this.entries.size;
  }
}

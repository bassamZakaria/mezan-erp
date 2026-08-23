import type { SequenceStore } from "../../numbering/index.js";

/** In-memory {@link SequenceStore} for tests — a per-(code,period) counter with no gaps. */
export class InMemorySequenceStore implements SequenceStore {
  private readonly counters = new Map<string, number>();

  async increment(code: string, period: number | null): Promise<number> {
    const key = `${code}::${period ?? ""}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
}

import type {
  RecognitionRunFilter,
  RevenueRecognitionRun,
  RevenueRecognitionRunRepository,
} from "../recognition.js";

/** A trivial in-memory {@link RevenueRecognitionRunRepository} fake for domain-layer unit tests. */
export class InMemoryRecognitionRunRepository implements RevenueRecognitionRunRepository {
  private readonly rows = new Map<string, RevenueRecognitionRun>();

  async findById(id: string): Promise<RevenueRecognitionRun | null> {
    return this.rows.get(id) ?? null;
  }

  async findByDocNo(docNo: string): Promise<RevenueRecognitionRun | null> {
    for (const row of this.rows.values()) {
      if (row.docNo === docNo) return row;
    }
    return null;
  }

  async list(filter?: RecognitionRunFilter): Promise<RevenueRecognitionRun[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (!filter?.contractId || r.contractId === filter.contractId) &&
          (!filter?.projectId || r.projectId === filter.projectId) &&
          (!filter?.periodEnd || r.periodEnd === filter.periodEnd) &&
          (!filter?.status || r.status === filter.status),
      )
      .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  }

  async save(run: RevenueRecognitionRun): Promise<void> {
    this.rows.set(run.id, run);
  }

  async insert(run: RevenueRecognitionRun): Promise<void> {
    this.rows.set(run.id, run);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

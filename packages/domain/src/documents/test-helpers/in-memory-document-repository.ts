import type {
  DocumentField,
  DocumentListFilter,
  DocumentRepository,
  DocumentWritePrecondition,
  FrameworkDocument,
} from "../document.js";
import type { DocumentDomainEvent, DocumentEventPublisher } from "../hooks.js";

/** Trivial in-memory {@link DocumentRepository} for domain-layer + UI tests. */
export class InMemoryDocumentRepository<Line> implements DocumentRepository<Line> {
  private readonly rows = new Map<string, FrameworkDocument<Line>>();

  async save(doc: FrameworkDocument<Line>): Promise<void> {
    this.rows.set(doc.id, doc);
  }

  async update(doc: FrameworkDocument<Line>): Promise<void> {
    this.rows.set(doc.id, doc);
  }

  async writeFields(next: FrameworkDocument<Line>, fields: readonly DocumentField[], expected: DocumentWritePrecondition): Promise<boolean> {
    const stored = this.rows.get(next.id);
    if (!stored || stored.status !== expected.status) return false;
    const patch = Object.fromEntries(fields.map((field) => [field, next[field]]));
    this.rows.set(next.id, { ...stored, ...patch });
    return true;
  }

  async findById(id: string): Promise<FrameworkDocument<Line> | null> {
    return this.rows.get(id) ?? null;
  }

  async list(filter: DocumentListFilter = {}): Promise<readonly FrameworkDocument<Line>[]> {
    return [...this.rows.values()]
      .filter((d) => (filter.status ? d.status === filter.status : true))
      .filter((d) => (filter.fromDate ? d.date >= filter.fromDate : true))
      .filter((d) => (filter.toDate ? d.date <= filter.toDate : true))
      .sort((a, b) => (a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date)));
  }

  async nameSourcedLineTaxRate(docId: string, sourceInvoiceId: string, taxRatePercent: number, taxRateId: string): Promise<number> {
    const doc = this.rows.get(docId);
    if (!doc) return 0;
    let named = 0;
    const lines = doc.lines.map((line) => {
      const sourced = line as { sourceInvoiceId?: string; taxRatePercent?: number | null; taxRateId?: string | null };
      if (sourced.sourceInvoiceId !== sourceInvoiceId || (sourced.taxRateId ?? null) !== null || (sourced.taxRatePercent ?? 0) !== taxRatePercent) return line;
      named += 1;
      return { ...line, taxRateId };
    });
    this.rows.set(docId, { ...doc, lines });
    return named;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/** Records every published document event for assertions. */
export class RecordingDocumentEventPublisher implements DocumentEventPublisher {
  readonly events: DocumentDomainEvent[] = [];
  publish(event: DocumentDomainEvent): void {
    this.events.push(event);
  }
}

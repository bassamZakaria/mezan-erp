import type {
  DocumentListFilter,
  DocumentRepository,
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

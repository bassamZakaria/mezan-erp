import { insertOnly } from "../../../records/test-helpers/insert-only.js";
import type { LetterOfGuarantee, LetterOfGuaranteeRepository } from "../guarantee.js";

/** A trivial in-memory {@link LetterOfGuaranteeRepository} fake for domain-layer unit tests. */
export class InMemoryGuaranteeRepository implements LetterOfGuaranteeRepository {
  private readonly rows = new Map<string, LetterOfGuarantee>();

  async findById(id: string): Promise<LetterOfGuarantee | null> {
    return this.rows.get(id) ?? null;
  }

  async findByDocNo(docNo: string): Promise<LetterOfGuarantee | null> {
    for (const row of this.rows.values()) {
      if (row.docNo === docNo) return row;
    }
    return null;
  }

  async list(): Promise<LetterOfGuarantee[]> {
    return [...this.rows.values()];
  }

  async create(guarantee: LetterOfGuarantee): Promise<void> {
    insertOnly(this.rows, guarantee.id, guarantee);
  }

  async update(guarantee: LetterOfGuarantee): Promise<void> {
    this.rows.set(guarantee.id, guarantee);
  }
}

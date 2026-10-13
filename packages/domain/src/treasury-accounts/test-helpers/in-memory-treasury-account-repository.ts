import { insertOnly } from "../../records/test-helpers/insert-only.js";
import type { TreasuryAccount, TreasuryAccountRepository } from "../treasury-account.js";

/** A trivial in-memory {@link TreasuryAccountRepository} fake for domain-layer unit tests. */
export class InMemoryTreasuryAccountRepository implements TreasuryAccountRepository {
  private readonly rows = new Map<string, TreasuryAccount>();

  async findById(id: string): Promise<TreasuryAccount | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCode(code: string): Promise<TreasuryAccount | null> {
    for (const account of this.rows.values()) {
      if (account.code === code) return account;
    }
    return null;
  }

  async list(): Promise<TreasuryAccount[]> {
    return [...this.rows.values()];
  }

  async create(account: TreasuryAccount): Promise<void> {
    insertOnly(this.rows, account.id, account);
  }

  async update(account: TreasuryAccount): Promise<void> {
    this.rows.set(account.id, account);
  }
}

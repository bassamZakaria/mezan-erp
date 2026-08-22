import type { Account, AccountRepository } from "../account.js";

/** A trivial in-memory {@link AccountRepository} fake for domain-layer unit tests. */
export class InMemoryAccountRepository implements AccountRepository {
  private readonly rows = new Map<string, Account>();

  async findById(id: string): Promise<Account | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Account | null> {
    for (const account of this.rows.values()) {
      if (account.code === code) return account;
    }
    return null;
  }

  async list(): Promise<Account[]> {
    return [...this.rows.values()];
  }

  async create(account: Account): Promise<void> {
    this.rows.set(account.id, account);
  }

  async update(account: Account): Promise<void> {
    this.rows.set(account.id, account);
  }
}

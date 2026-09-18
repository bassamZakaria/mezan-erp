import type { Item, ItemRepository } from "../item.js";
import { DuplicateItemCodeError } from "../errors.js";

/**
 * A trivial in-memory {@link ItemRepository} fake for domain-layer unit tests.
 *
 * `create` enforces the same code-uniqueness constraint the real SQLite store
 * carries as a `UNIQUE` column, so a test can reproduce the race
 * `createItem`'s retry loop guards against: two concurrent creates that both
 * read the catalog before either has written land here in write order, and
 * the second lands on an already-taken code and must be told so.
 */
export class InMemoryItemRepository implements ItemRepository {
  private readonly rows = new Map<string, Item>();

  async findById(id: string): Promise<Item | null> {
    return this.rows.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Item | null> {
    for (const item of this.rows.values()) {
      if (item.code === code) return item;
    }
    return null;
  }

  async list(): Promise<Item[]> {
    return [...this.rows.values()];
  }

  async create(item: Item): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.id !== item.id && row.code === item.code) throw new DuplicateItemCodeError(item.code);
    }
    this.rows.set(item.id, item);
  }

  async update(item: Item): Promise<void> {
    this.rows.set(item.id, item);
  }
}

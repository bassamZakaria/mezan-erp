import type { Item, ItemRepository } from "../item.js";

/** A trivial in-memory {@link ItemRepository} fake for domain-layer unit tests. */
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
    this.rows.set(item.id, item);
  }

  async update(item: Item): Promise<void> {
    this.rows.set(item.id, item);
  }
}

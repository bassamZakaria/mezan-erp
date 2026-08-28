import type { JournalEntry } from "../journal.js";
import type { UnitOfWork } from "../journal.js";
import type { Role } from "../roles/role.js";
import type { User } from "../users/user.js";
import { normalizeEmail } from "../users/save-user.js";

/**
 * In-memory `UnitOfWork` fake shared by domain unit tests — no database, no
 * mocking framework. Exposes the backing arrays/maps directly so a test can
 * seed state or assert on what got persisted.
 */
export interface FakeUnitOfWork extends UnitOfWork {
  readonly journalEntries: JournalEntry[];
  readonly roleRecords: Map<string, Role>;
  readonly userRecords: Map<string, User>;
}

export function createFakeUow(): FakeUnitOfWork {
  const journalEntries: JournalEntry[] = [];
  const roleRecords = new Map<string, Role>();
  const userRecords = new Map<string, User>();

  const uow: FakeUnitOfWork = {
    journalEntries,
    roleRecords,
    userRecords,
    journal: {
      async save(entry) {
        journalEntries.push(entry);
      },
      async findById(id) {
        return journalEntries.find((e) => e.id === id) ?? null;
      },
    },
    roles: {
      async save(role) {
        roleRecords.set(role.id, role);
      },
      async findById(id) {
        return roleRecords.get(id) ?? null;
      },
      async findByCode(code) {
        for (const role of roleRecords.values()) {
          if (role.code === code) return role;
        }
        return null;
      },
      async list() {
        return Array.from(roleRecords.values());
      },
      async delete(id) {
        roleRecords.delete(id);
      },
    },
    users: {
      async save(user) {
        userRecords.set(user.id, user);
      },
      async findById(id) {
        return userRecords.get(id) ?? null;
      },
      async findByEmail(email) {
        const needle = normalizeEmail(email);
        for (const user of userRecords.values()) {
          if (normalizeEmail(user.email) === needle) return user;
        }
        return null;
      },
      async list() {
        return Array.from(userRecords.values());
      },
    },
    async transaction(fn) {
      return fn(uow);
    },
  };

  return uow;
}

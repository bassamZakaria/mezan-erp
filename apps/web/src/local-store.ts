import type {
  UnitOfWork,
  JournalRepository,
  RoleRepository,
  UserRepository,
  SecretHasher,
  Role,
  User,
} from "@mezan/domain";

/**
 * In-memory `UnitOfWork` + `SecretHasher` for the web demo. Phase 1 has no
 * live API wiring in `apps/web` yet (the existing invoices page is sample
 * data only, same pattern) — this lets the Users/Roles screens run the REAL
 * `@mezan/domain` use-cases (`saveRole`, `saveUser`, dependency resolution,
 * uniqueness/scope validation) against seeded demo data, instead of faking
 * that validation in the UI layer. `packages/persistence`'s SQLite repos +
 * `createScryptHasher` are the real adapters this stands in for; swapping
 * this file for a fetch-backed client is the follow-up once the API is wired
 * into the web build.
 */
export interface LocalStore {
  readonly uow: UnitOfWork;
  readonly hasher: SecretHasher;
  listRoles(): Role[];
  listUsers(): User[];
}

const NOOP_JOURNAL: JournalRepository = {
  async save() {},
  async findById() {
    return null;
  },
};

/** NOT real hashing — demo-only, in-browser stand-in. Never use outside this sample app. */
const DEMO_HASHER: SecretHasher = {
  async hash(secret: string) {
    return `demo:${secret}`;
  },
  async verify(secret: string, hash: string) {
    return hash === `demo:${secret}`;
  },
};

export function createLocalStore(seed: { roles: Role[]; users: User[] }): LocalStore {
  const roles = new Map(seed.roles.map((r) => [r.id, r]));
  const users = new Map(seed.users.map((u) => [u.id, u]));

  const roleRepo: RoleRepository = {
    async save(role) {
      roles.set(role.id, role);
    },
    async findById(id) {
      return roles.get(id) ?? null;
    },
    async findByCode(code) {
      for (const role of roles.values()) if (role.code === code) return role;
      return null;
    },
    async list() {
      return Array.from(roles.values());
    },
    async delete(id) {
      roles.delete(id);
    },
  };

  const userRepo: UserRepository = {
    async save(user) {
      users.set(user.id, user);
    },
    async findById(id) {
      return users.get(id) ?? null;
    },
    async findByEmail(email) {
      for (const user of users.values()) if (user.email === email) return user;
      return null;
    },
    async list() {
      return Array.from(users.values());
    },
  };

  const uow: UnitOfWork = {
    journal: NOOP_JOURNAL,
    roles: roleRepo,
    users: userRepo,
    async transaction(fn) {
      return fn(uow);
    },
  };

  return {
    uow,
    hasher: DEMO_HASHER,
    listRoles: () => Array.from(roles.values()),
    listUsers: () => Array.from(users.values()),
  };
}

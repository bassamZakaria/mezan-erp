import { isErasedUser, normalizeEmail, type SignInEmailGuard, type UnitOfWork, type User, type UserRepository } from "@mezan/domain";
import { SEED_ADMIN_USER_ID } from "./seed.js";

// INVARIANT: every company is seeded with the same recovery admin, so it never joins the list; it signs in with a company code only.
export function signInEmailOf(user: User | null): string | null {
  return user && !isErasedUser(user) && user.id !== SEED_ADMIN_USER_ID ? normalizeEmail(user.email) : null;
}

// SECURITY: a write only ever adds this company's claim, never removes one. A list that
// over-holds refuses another company an email; one that under-held would send a sign-in
// to the wrong company. An email let go is dropped by the sync when the books next open.
// shortcut: a changed or rolled-back email stays held here until the next open; release on commit if that bites.
export function withSignInEmailGuard(uow: UnitOfWork, guard: SignInEmailGuard): UnitOfWork {
  const inner = uow.users;
  const users: UserRepository = {
    findById: (id) => inner.findById(id),
    findByEmail: (email) => inner.findByEmail(email),
    list: () => inner.list(),
    save: async (user) => {
      const now = signInEmailOf(user);
      if (now !== null && now !== signInEmailOf(await inner.findById(user.id))) await guard.claim(now);
      await inner.save(user);
    },
  };
  const guarded: UnitOfWork = { journal: uow.journal, roles: uow.roles, users, transaction: (fn) => uow.transaction(() => fn(guarded)) };
  return guarded;
}

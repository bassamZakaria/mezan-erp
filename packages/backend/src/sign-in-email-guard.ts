import { isErasedUser, normalizeEmail, type SignInEmailGuard, type UnitOfWork, type User, type UserRepository } from "@mezan/domain";
import { SEED_ADMIN_USER_ID } from "./seed.js";

// INVARIANT: every company is seeded with the same recovery admin, so it never joins the list; it signs in with a company code only.
export function signInEmailOf(user: User | null): string | null {
  return user && !isErasedUser(user) && user.id !== SEED_ADMIN_USER_ID ? normalizeEmail(user.email) : null;
}

/**
 * Every write of a user passes through `users.save`, so the one-email-one-company
 * rule is held here. The claim lands before the row; a write that then rolls back
 * leaves a claim the next `sync` on open clears.
 */
export function withSignInEmailGuard(uow: UnitOfWork, guard: SignInEmailGuard, afterCommit: (fn: () => void) => void, onReleaseError: (err: unknown) => void): UnitOfWork {
  const inner = uow.users;
  const users: UserRepository = {
    findById: (id) => inner.findById(id),
    findByEmail: (email) => inner.findByEmail(email),
    list: () => inner.list(),
    save: async (user) => {
      const was = signInEmailOf(await inner.findById(user.id));
      const now = signInEmailOf(user);
      if (now !== null && now !== was) await guard.claim(now);
      await inner.save(user);
      if (was !== null && was !== now) afterCommit(() => void guard.release(was).catch(onReleaseError));
    },
  };
  const guarded: UnitOfWork = {
    journal: uow.journal,
    roles: uow.roles,
    users,
    transaction: (fn) => uow.transaction(() => fn(guarded)),
  };
  return guarded;
}

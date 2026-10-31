import { AsyncLocalStorage } from "node:async_hooks";
import { isErasedUser, normalizeEmail, type SignInEmailGuard, type UnitOfWork, type User, type UserRepository } from "@mezan/domain";
import { SEED_ADMIN_USER_ID } from "./seed.js";

// INVARIANT: every company is seeded with the same recovery admin, so it never joins the list; it signs in with a company code only.
export function signInEmailOf(user: User | null): string | null {
  return user && !isErasedUser(user) && user.id !== SEED_ADMIN_USER_ID ? normalizeEmail(user.email) : null;
}

interface PendingEmails {
  readonly claimed: string[];
  readonly released: string[];
}

/**
 * Every write of a user passes through `users.save`, so the one-email-one-company
 * rule is held here. A claim lands before the row and is undone if the write or its
 * transaction fails; an email let go is released only once the write has committed.
 */
export function withSignInEmailGuard(uow: UnitOfWork, guard: SignInEmailGuard, afterCommit: (fn: () => void) => void, onError: (err: unknown) => void): UnitOfWork {
  const inner = uow.users;
  const pending = new AsyncLocalStorage<PendingEmails>();
  const settle = (emails: readonly string[], stillHeld: boolean): Promise<void> =>
    Promise.all(
      emails.map(async (email) => {
        if (stillHeld && (await inner.findByEmail(email)) !== null) return;
        await guard.release(email).catch(onError);
      }),
    ).then(() => undefined);

  const users: UserRepository = {
    findById: (id) => inner.findById(id),
    findByEmail: (email) => inner.findByEmail(email),
    list: () => inner.list(),
    save: async (user) => {
      const was = signInEmailOf(await inner.findById(user.id));
      const now = signInEmailOf(user);
      const changed = now !== null && now !== was;
      const open = pending.getStore();
      if (changed) {
        await guard.claim(now);
        open?.claimed.push(now);
      }
      try {
        await inner.save(user);
      } catch (err) {
        if (changed && !open) await settle([now], false);
        throw err;
      }
      if (was === null || was === now) return;
      if (open) open.released.push(was);
      else afterCommit(() => void settle([was], true));
    },
  };
  const guarded: UnitOfWork = {
    journal: uow.journal,
    roles: uow.roles,
    users,
    transaction: async (fn) => {
      if (pending.getStore()) return uow.transaction(() => fn(guarded));
      const emails: PendingEmails = { claimed: [], released: [] };
      try {
        const result = await pending.run(emails, () => uow.transaction(() => fn(guarded)));
        await settle(emails.released, true);
        return result;
      } catch (err) {
        await settle(emails.claimed, false);
        throw err;
      }
    },
  };
  return guarded;
}

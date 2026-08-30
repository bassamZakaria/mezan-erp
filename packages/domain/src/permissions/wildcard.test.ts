import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSION_CODES,
  ALL_SCOPE,
  WILDCARD_PERMISSION,
  can,
  createAuthContext,
  isKnownPermission,
  isTenantAdmin,
  resolvePermissions,
  visibilityTier,
  type ScopeSelection,
} from "./index.js";

/**
 * The wildcard is the only code in this codebase that grants more than itself.
 * These tests fix both halves of that: it really does open every gate, and
 * NOTHING ELSE does — not a dotted prefix, not an empty string, not a star
 * sitting in a position the check never reads.
 */

function ctxWith(permissions: string[], scope: ScopeSelection = ALL_SCOPE) {
  const input = {
    userId: "u1",
    permissions,
    branchScope: scope,
    warehouseScope: scope,
  };
  return createAuthContext(input);
}

describe("the wildcard grants everything", () => {
  it("opens every catalogued permission without exception", () => {
    const admin = ctxWith([WILDCARD_PERMISSION]);
    const refused = ALL_PERMISSION_CODES.filter((code) => !can(admin, code));
    expect(refused).toEqual([]);
    expect(ALL_PERMISSION_CODES.length).toBeGreaterThan(280);
  });

  it("opens a code the catalogue has never heard of, so a new route is admin-reachable the day it lands", () => {
    const admin = ctxWith([WILDCARD_PERMISSION]);
    expect(can(admin, "some.permission.invented.tomorrow")).toBe(true);
  });

  it("ignores branch and warehouse scope even when the admin own allow-lists are empty", () => {
    const admin = ctxWith([WILDCARD_PERMISSION], []);
    expect(isTenantAdmin(admin)).toBe(true);
    expect(can(admin, "sales.invoice.confirm", { branch: "b-9", warehouse: "wh-9" })).toBe(true);
  });
});

describe("nothing else behaves like a wildcard", () => {
  it("a dotted prefix grants none of the actions under it", () => {
    const prefix = ctxWith(["sales.invoice"]);
    expect(can(prefix, "sales.invoice.confirm")).toBe(false);
    expect(can(prefix, "sales.invoice.view")).toBe(false);
    expect(can(prefix, "sales.invoice.void")).toBe(false);
    expect(isTenantAdmin(prefix)).toBe(false);
  });

  it("a glob written by hand is an ordinary unknown code, never an expansion", () => {
    for (const glob of ["sales.*", "*.*", "**", "admin.*", ".*"]) {
      const ctx = ctxWith([glob]);
      expect(can(ctx, "sales.invoice.confirm")).toBe(false);
      expect(can(ctx, "admin.users.edit")).toBe(false);
      expect(isTenantAdmin(ctx)).toBe(false);
    }
  });

  it("a star with whitespace around it is not the wildcard — the trim belongs to the resolver, never to can()", () => {
    for (const almost of [" *", "* ", " * ", "\t*"]) {
      const ctx = ctxWith([almost]);
      expect(isTenantAdmin(ctx)).toBe(false);
      expect(can(ctx, "accounting.journal.post")).toBe(false);
    }
  });

  it("an empty granted code opens nothing real", () => {
    const ctx = ctxWith([""]);
    expect(isTenantAdmin(ctx)).toBe(false);
    const opened = ALL_PERMISSION_CODES.filter((code) => can(ctx, code));
    expect(opened).toEqual([]);
    expect(isKnownPermission("")).toBe(false);
    expect(isKnownPermission(WILDCARD_PERMISSION)).toBe(true);
  });

  it("a star inside a scope ARRAY is a literal id, never all-branches — the sentinel is the bare string", () => {
    // A user row stored as branchScope ["*"] rather than "*" fails CLOSED: it
    // matches a branch literally named * and nothing else. If that ever flips
    // to fail-open, a mis-shaped row becomes a silent cross-branch grant.
    const ctx = ctxWith(["sales.invoice.view"], ["*"]);
    expect(can(ctx, "sales.invoice.view", { branch: "b1" })).toBe(false);
    expect(can(ctx, "sales.invoice.view", { branch: "*" })).toBe(true);

    const sentinel = ctxWith(["sales.invoice.view"], ALL_SCOPE);
    expect(can(sentinel, "sales.invoice.view", { branch: "b1" })).toBe(true);
  });

  it("visibilityTier matches the whole prefix, so a shorter one collects nothing", () => {
    const ctx = ctxWith(["sales.invoice.view_all"]);
    expect(visibilityTier(ctx, "sales.invoice")).toBe("all");
    expect(visibilityTier(ctx, "sales")).toBe("none");
    expect(visibilityTier(ctx, "sales.invoice.view")).toBe("none");
  });
});

describe("the dependency closure never manufactures authority", () => {
  it("no catalogued permission resolves to the wildcard", () => {
    const leaks = ALL_PERMISSION_CODES.filter((code) =>
      resolvePermissions([code]).has(WILDCARD_PERMISSION),
    );
    expect(leaks).toEqual([]);
  });

  it("the graph runs one way: confirm implies view_own, and view_own implies no confirm", () => {
    expect(resolvePermissions(["sales.invoice.confirm"]).has("sales.invoice.view_own")).toBe(true);
    expect(resolvePermissions(["sales.invoice.view_own"]).has("sales.invoice.confirm")).toBe(false);
    expect(resolvePermissions(["accounting.journal.post"]).has("accounting.journal.create")).toBe(false);
    expect(resolvePermissions(["accounting.journal.create"]).has("accounting.journal.post")).toBe(false);
  });

  it("a view grant never reaches a sibling that moves money", () => {
    const viewer = ctxWith(["sales.invoice.view", "treasury.cash_voucher.view", "accounting.journal.view"]);
    expect(can(viewer, "sales.invoice.confirm")).toBe(false);
    expect(can(viewer, "sales.invoice.void")).toBe(false);
    expect(can(viewer, "treasury.cash_voucher.confirm")).toBe(false);
    expect(can(viewer, "treasury.cash_voucher.void")).toBe(false);
    expect(can(viewer, "accounting.journal.post")).toBe(false);
  });

  it("resolving the whole catalogue at once grants exactly the catalogue and nothing more", () => {
    const everything = resolvePermissions(ALL_PERMISSION_CODES);
    expect(everything.has(WILDCARD_PERMISSION)).toBe(false);
    expect(everything.size).toBe(ALL_PERMISSION_CODES.length);
  });
});

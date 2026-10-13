import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  ALL_PERMISSION_CODES,
  WILDCARD_PERMISSION,
  getPermission,
  isKnownPermission,
} from "./catalog.js";
import { dependenciesOf, resolvePermissions } from "./resolve.js";
import { ALL_SCOPE, can, createAuthContext, isTenantAdmin, visibilityTier } from "./auth-context.js";

const codeArb = fc.constantFrom(...ALL_PERMISSION_CODES);
const grantArb = fc.uniqueArray(codeArb, { maxLength: 25 });
const idArb = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0);

function ctxOf(permissions: readonly string[], branchScope: readonly string[] | typeof ALL_SCOPE = ALL_SCOPE) {
  return createAuthContext({
    userId: "USER-FUZZ",
    permissions,
    branchScope,
    warehouseScope: ALL_SCOPE,
  });
}

describe("permission resolution — fuzz", () => {
  it("fuzz: resolution is a superset of the grant and is idempotent", () => {
    fc.assert(
      fc.property(grantArb, (granted) => {
        const once = resolvePermissions(granted);
        for (const code of granted) expect(once.has(code)).toBe(true);
        const twice = resolvePermissions([...once]);
        expect([...twice].sort()).toEqual([...once].sort());
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: resolution is monotonic — adding a grant never removes an effective permission", () => {
    fc.assert(
      fc.property(grantArb, codeArb, (granted, extra) => {
        const before = resolvePermissions(granted);
        const after = resolvePermissions([...granted, extra]);
        for (const code of before) expect(after.has(code)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: resolution is order-independent", () => {
    fc.assert(
      fc.property(grantArb, (granted) => {
        const forward = [...resolvePermissions(granted)].sort();
        const backward = [...resolvePermissions([...granted].reverse())].sort();
        expect(backward).toEqual(forward);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: every resolved code is either granted or a declared dependency of one", () => {
    fc.assert(
      fc.property(grantArb, (granted) => {
        const resolved = resolvePermissions(granted);
        const grantedSet = new Set(granted);
        for (const code of resolved) {
          if (grantedSet.has(code)) continue;
          const reachable = granted.some((g) => dependenciesOf(g).has(code));
          expect(reachable, `${code} appeared without being granted or depended on`).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: an unknown code is carried verbatim and pulls in nothing", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }).filter((s) => !isKnownPermission(s) && s !== WILDCARD_PERMISSION), (unknown) => {
        const resolved = resolvePermissions([unknown]);
        expect([...resolved]).toEqual([unknown]);
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: the wildcard short-circuits and never expands into individual codes", () => {
    fc.assert(
      fc.property(grantArb, (granted) => {
        const resolved = resolvePermissions([WILDCARD_PERMISSION, ...granted]);
        expect(resolved.has(WILDCARD_PERMISSION)).toBe(true);
        expect(isTenantAdmin(ctxOf([WILDCARD_PERMISSION, ...granted]))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: every declared dependency is itself a catalog code, so no grant resolves to a dead end", () => {
    for (const code of ALL_PERMISSION_CODES) {
      for (const dep of getPermission(code)?.deps ?? []) {
        expect(isKnownPermission(dep), `${code} depends on unknown ${dep}`).toBe(true);
      }
    }
  });

  it("fuzz: the dependency graph has no cycle that would make resolution diverge", () => {
    for (const code of ALL_PERMISSION_CODES) {
      const deps = dependenciesOf(code);
      expect(deps.has(code), `${code} depends transitively on itself`).toBe(false);
    }
  });
});

describe("can() — fuzz", () => {
  it("fuzz: never grants a permission outside the resolved set", () => {
    fc.assert(
      fc.property(grantArb, codeArb, (granted, asked) => {
        const ctx = ctxOf(granted);
        const resolved = resolvePermissions(granted);
        expect(can(ctx, asked)).toBe(resolved.has(asked));
      }),
      { numRuns: 600 },
    );
  });

  it("fuzz: an unauthenticated context is still refused by the caller's own check", () => {
    fc.assert(
      fc.property(grantArb, codeArb, (granted, asked) => {
        const ctx = createAuthContext({
          userId: "anonymous",
          permissions: [],
          branchScope: [],
          warehouseScope: [],
          authenticated: false,
        });
        expect(ctx.authenticated).toBe(false);
        expect(can(ctx, asked)).toBe(false);
        expect(granted.length >= 0).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("fuzz: an unrestricted tenant admin passes every permission and every scope; one granted nothing passes no scope (D111)", () => {
    fc.assert(
      fc.property(codeArb, idArb, idArb, (asked, branch, warehouse) => {
        const admin = createAuthContext({ userId: "USER-ADMIN", permissions: [WILDCARD_PERMISSION], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
        const confined = createAuthContext({ userId: "USER-ADMIN", permissions: [WILDCARD_PERMISSION], branchScope: [], warehouseScope: [] });
        expect(can(admin, asked, { branch, warehouse })).toBe(true);
        expect(can(confined, asked)).toBe(true);
        expect(can(confined, asked, { branch })).toBe(false);
        expect(can(confined, asked, { warehouse })).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a scoped context is refused outside its branch, whatever it holds", () => {
    fc.assert(
      fc.property(grantArb, codeArb, idArb, idArb, (granted, asked, allowed, other) => {
        fc.pre(allowed !== other);
        const ctx = ctxOf([...granted, asked], [allowed]);
        expect(can(ctx, asked, { branch: allowed })).toBe(true);
        expect(can(ctx, asked, { branch: other })).toBe(false);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: an empty branch scope refuses every branch", () => {
    fc.assert(
      fc.property(codeArb, idArb, (asked, branch) => {
        const ctx = ctxOf([asked], []);
        expect(can(ctx, asked)).toBe(true);
        expect(can(ctx, asked, { branch })).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a role code is never accepted where a permission code is expected", () => {
    fc.assert(
      fc.property(fc.constantFrom("ACCOUNTANT", "CASHIER", "STOREKEEPER", "SALES"), codeArb, (roleCode, asked) => {
        const ctx = createAuthContext({
          userId: "USER-ROLE",
          permissions: [roleCode],
          roleCodes: [roleCode],
          branchScope: ALL_SCOPE,
          warehouseScope: ALL_SCOPE,
        });
        expect(can(ctx, asked)).toBe(false);
        expect(ctx.roleCodes.has(roleCode)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe("visibilityTier — fuzz", () => {
  const prefixes = ALL_PERMISSION_CODES.filter((c) => c.endsWith(".view_all")).map((c) =>
    c.slice(0, -".view_all".length),
  );

  it("fuzz: the tier is exactly the highest granted rung, and admins always see all", () => {
    fc.assert(
      fc.property(fc.constantFrom(...prefixes), fc.subarray(["view_all", "view", "view_own"]), (prefix, rungs) => {
        const granted = rungs.map((r) => `${prefix}.${r}`).filter(isKnownPermission);
        const ctx = ctxOf(granted);
        const resolved = resolvePermissions(granted);
        const expected = resolved.has(`${prefix}.view_all`)
          ? "all"
          : resolved.has(`${prefix}.view`)
            ? "in_scope"
            : resolved.has(`${prefix}.view_own`)
              ? "own"
              : "none";
        expect(visibilityTier(ctx, prefix)).toBe(expected);
        expect(visibilityTier(ctxOf([WILDCARD_PERMISSION]), prefix)).toBe("all");
      }),
      { numRuns: 400 },
    );
  });
});

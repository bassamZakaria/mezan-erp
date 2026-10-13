import { describe, expect, it } from "vitest";
import { ALL_SCOPE, createAuthContext, type AuthContext } from "./auth-context.js";
import { WILDCARD_PERMISSION } from "./catalog.js";
import { resolvePermissions } from "./resolve.js";
import { targetOutranksCaller, ungrantablePermissions, ungrantableScopes } from "./escalation.js";

/**
 * The rule under test is one sentence: a caller may never grant authority they
 * do not themselves hold, and may never write to an account whose authority
 * exceeds their own. It is the second half of authorization — the permission
 * gate answers "may this caller reach this route", and answered it correctly
 * the whole time; nothing answered "may this caller hand out THIS authority",
 * so the answer was always yes.
 *
 * Every test below is written so that removing the guard makes it fail. The
 * negative controls matter just as much: a clerk that can no longer do the job
 * the permission exists for is a different bug, not a fix.
 */

function caller(permissions: string[]): AuthContext {
  return createAuthContext({
    userId: "u-caller",
    permissions,
    branchScope: ALL_SCOPE,
    warehouseScope: ALL_SCOPE,
    authenticated: true,
  });
}

const admin = caller([WILDCARD_PERMISSION]);
const clerk = caller(["admin.users.view", "admin.users.create"]);

describe("ungrantablePermissions — a caller may not hand out what they do not hold", () => {
  it("names the wildcard as ungrantable for anyone who is not already a tenant admin", () => {
    // This is S2 and S3 in one line: every escalation found ended at `"*"`.
    expect(ungrantablePermissions(clerk, [WILDCARD_PERMISSION])).toEqual([WILDCARD_PERMISSION]);
  });

  it("lets a tenant admin grant anything, including the wildcard", () => {
    // Somebody has to be able to mint the next admin, and only the holder of
    // `"*"` has `"*"` to give.
    expect(ungrantablePermissions(admin, [WILDCARD_PERMISSION])).toEqual([]);
    expect(ungrantablePermissions(admin, ["sales.invoice.confirm", "accounting.journal.post"])).toEqual([]);
  });

  it("allows a grant that is exactly what the caller holds", () => {
    // The ordinary case, and the negative control for everything below: an
    // admin.users.create clerk really can create a peer.
    expect(ungrantablePermissions(clerk, ["admin.users.view", "admin.users.create"])).toEqual([]);
  });

  it("allows a grant that is a strict subset of what the caller holds", () => {
    expect(ungrantablePermissions(clerk, ["admin.users.view"])).toEqual([]);
  });

  it("refuses only the codes the caller lacks, and names them — the granted ones are not swept up", () => {
    // The response body carries this list, so an admin sees WHICH permission
    // was refused rather than being told "no". `admin.users.view` is held, so
    // it must NOT appear; `accounting.journal.post` is not, and it drags its
    // dependency `accounting.journal.view` in with it, so both are refused.
    const refused = ungrantablePermissions(clerk, ["admin.users.view", "accounting.journal.post"]);
    expect([...refused].sort()).toEqual(["accounting.journal.post", "accounting.journal.view"]);
    expect(refused).not.toContain("admin.users.view");
  });

  it("compares the RESOLVED closure, so an implied permission cannot be smuggled in", () => {
    // Granting a code drags its dependencies in with it. Comparing the raw
    // lists would let a caller hand out an implied permission they do not
    // hold, simply by never naming it. Proven against a code that actually
    // has dependencies, so this is not a vacuous assertion.
    const withDeps = [...resolvePermissions(["sales.invoice.confirm"])];
    expect(withDeps.length).toBeGreaterThan(1);

    const holderOfTheNamedCodeOnly = caller(["sales.invoice.confirm"]);
    const implied = withDeps.filter((c) => c !== "sales.invoice.confirm");
    // The caller was granted only the named code, but resolution gives them
    // the closure too — so they may hand out the closure and nothing else.
    expect(ungrantablePermissions(holderOfTheNamedCodeOnly, implied)).toEqual([]);
    // And a code outside that closure is still refused — together with its own
    // dependency, which is the point: you cannot grant `.post` while quietly
    // withholding the `.view` it requires, nor grant either without holding it.
    expect(
      [...ungrantablePermissions(holderOfTheNamedCodeOnly, ["accounting.journal.post"])].sort(),
    ).toEqual(["accounting.journal.post", "accounting.journal.view"]);
  });

  it("treats a caller holding nothing as able to grant nothing", () => {
    const nobody = caller([]);
    expect(ungrantablePermissions(nobody, ["admin.users.view"])).toEqual(["admin.users.view"]);
    expect(ungrantablePermissions(nobody, [])).toEqual([]);
  });

  it("returns an empty list for an empty request, from any caller", () => {
    expect(ungrantablePermissions(clerk, [])).toEqual([]);
  });

  it("accepts any iterable, because the routes pass a Set as readily as an array", () => {
    expect(ungrantablePermissions(clerk, new Set(["admin.users.view"]))).toEqual([]);
    expect(ungrantablePermissions(clerk, new Set([WILDCARD_PERMISSION]))).toEqual([WILDCARD_PERMISSION]);
  });

  it("does not treat the wildcard as a prefix match — holding a parent code grants no child", () => {
    // `admin.users` is not a permission, and even if a role stored it, it must
    // not stand in for `admin.users.delete`.
    const parentish = caller(["admin.users"]);
    expect(ungrantablePermissions(parentish, ["admin.users.delete"])).toEqual(["admin.users.delete"]);
  });
});

describe("targetOutranksCaller — a caller may not write to an account above them", () => {
  it("says the company admin outranks a clerk, which is what stops S4", () => {
    // A helpdesk-tier `admin.users.edit` could reset the owner's PIN and sign
    // in as them. This is the check that refuses it.
    expect(targetOutranksCaller(clerk, { isCompanyAdmin: true, permissions: [] })).toBe(true);
  });

  it("says a PEER does not outrank — resetting a colleague's PIN is the job, not the attack", () => {
    // The negative control. A guard that refuses this has broken the product
    // rather than secured it.
    expect(
      targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: ["admin.users.view"] }),
    ).toBe(false);
  });

  it("says an account with no role at all does not outrank anyone", () => {
    expect(targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: [] })).toBe(false);
  });

  it("says an account holding one permission the caller lacks DOES outrank", () => {
    // Not only the admin flag: authority is authority. A clerk must not be
    // able to take over the accountant's account either.
    expect(
      targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: ["accounting.journal.post"] }),
    ).toBe(true);
  });

  it("says nothing outranks a tenant admin, including another tenant admin", () => {
    expect(targetOutranksCaller(admin, { isCompanyAdmin: true, permissions: [WILDCARD_PERMISSION] })).toBe(false);
    expect(targetOutranksCaller(admin, { isCompanyAdmin: false, permissions: ["accounting.journal.post"] })).toBe(
      false,
    );
  });

  it("compares the resolved closure here too, so an implied permission still outranks", () => {
    const implied = [...resolvePermissions(["sales.invoice.confirm"])].filter((c) => c !== "sales.invoice.confirm");
    expect(implied.length).toBeGreaterThan(0);
    // The clerk holds none of these, so an account carrying them is above it.
    expect(targetOutranksCaller(clerk, { isCompanyAdmin: false, permissions: implied })).toBe(true);
  });

  it("the two functions agree: an account is outranked exactly when its authority is ungrantable", () => {
    // Stated as a property rather than a case, because the routes call one to
    // decide the grant and the other to decide the write, and a disagreement
    // between them is a hole shaped like whichever is more permissive.
    const targets: { isCompanyAdmin: boolean; permissions: string[] }[] = [
      { isCompanyAdmin: false, permissions: [] },
      { isCompanyAdmin: false, permissions: ["admin.users.view"] },
      { isCompanyAdmin: false, permissions: ["admin.users.view", "accounting.journal.post"] },
      { isCompanyAdmin: false, permissions: ["accounting.journal.post"] },
    ];
    for (const target of targets) {
      expect(targetOutranksCaller(clerk, target), JSON.stringify(target)).toBe(
        ungrantablePermissions(clerk, target.permissions).length > 0,
      );
    }
  });
});

describe("a `*` admin granted one branch holds every permission and only that branch", () => {
  const restrictedAdmin = createAuthContext({
    userId: "u-branch-admin",
    permissions: [WILDCARD_PERMISSION],
    branchScope: ["BR-ALEX"],
    warehouseScope: ALL_SCOPE,
  });
  const narrowWarehouseAdmin = createAuthContext({
    userId: "u-warehouse-admin",
    permissions: [WILDCARD_PERMISSION],
    branchScope: ALL_SCOPE,
    warehouseScope: ["WH-ALEX"],
  });

  it("cannot hand out every branch, nor a branch it does not hold", () => {
    expect(ungrantableScopes(restrictedAdmin, { branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })).toEqual(["branch:*"]);
    expect(ungrantableScopes(restrictedAdmin, { branchScope: ["BR-ALEX", "BR-MAIN"] })).toEqual(["branch:BR-MAIN"]);
    expect(ungrantableScopes(restrictedAdmin, { branchScope: ["BR-ALEX"] })).toEqual([]);
  });

  it("is held to its warehouse grant the same way", () => {
    expect(ungrantableScopes(narrowWarehouseAdmin, { warehouseScope: ALL_SCOPE })).toEqual(["warehouse:*"]);
  });

  it("is outranked by an account that reaches further, whatever that account's role", () => {
    expect(targetOutranksCaller(restrictedAdmin, { isCompanyAdmin: false, permissions: ["admin.users.view"], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })).toBe(true);
    expect(targetOutranksCaller(restrictedAdmin, { isCompanyAdmin: true, permissions: [], branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE })).toBe(true);
    expect(targetOutranksCaller(restrictedAdmin, { isCompanyAdmin: false, permissions: [], branchScope: ["BR-MAIN"], warehouseScope: ALL_SCOPE })).toBe(true);
  });

  it("is outranked by an account whose reach the server was not told", () => {
    expect(targetOutranksCaller(restrictedAdmin, { isCompanyAdmin: false, permissions: [] })).toBe(true);
  });

  it("still administers accounts inside its own branch, and may grant any permission there", () => {
    expect(targetOutranksCaller(restrictedAdmin, { isCompanyAdmin: true, permissions: [], branchScope: ["BR-ALEX"], warehouseScope: ALL_SCOPE })).toBe(false);
    expect(ungrantablePermissions(restrictedAdmin, [WILDCARD_PERMISSION])).toEqual([]);
  });

  it("is judged by the branches the session was granted, not by what one request narrowed to", () => {
    const narrowedRequest = createAuthContext({
      userId: "u-all",
      permissions: [WILDCARD_PERMISSION],
      branchScope: ["BR-ALEX"],
      branchGrant: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    expect(ungrantableScopes(narrowedRequest, { branchScope: ALL_SCOPE })).toEqual([]);
  });
});

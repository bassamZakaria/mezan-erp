// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  clearSessionExpired,
  clearTenantCode,
  loadPersistedScopeSelection,
  loadPersistedSession,
  loadTenantCode,
  markSessionExpired,
  NO_SCOPE_SELECTION,
  persistScopeSelection,
  persistSession,
  persistTenantCode,
  sessionExpiredPending,
  type ScopeSelection,
  type Session,
} from "./session";

const SESSION_KEY = "mezan.session";
const SCOPE_KEY = "mezan.scopeSelection";
const EXPIRED_KEY = "mezan.sessionExpired";
const TENANT_CODE_KEY = "mezan.tenantCode";

const validSession: Session = {
  userId: "USER-1",
  nameAr: "سارة",
  nameEn: null,
  email: "sara@example.com",
  isCompanyAdmin: false,
  permissions: ["items.view"],
  roleCode: "SALES",
  photoUrl: null,
  branchScope: ["BR-1"],
  warehouseScope: "*",
  tenantName: "Cyag",
  token: "TOKEN-1",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("loadPersistedSession", () => {
  it("returns null when nothing is stored", () => {
    expect(loadPersistedSession()).toBeNull();
  });

  it("returns the parsed session when it matches the schema", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(validSession));
    expect(loadPersistedSession()).toEqual(validSession);
  });

  it("returns null for corrupt (non-JSON) storage", () => {
    localStorage.setItem(SESSION_KEY, "{not json");
    expect(loadPersistedSession()).toBeNull();
  });

  it("returns null when the stored value doesn't match the session schema", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId: "USER-1" }));
    expect(loadPersistedSession()).toBeNull();
  });
});

describe("persistSession", () => {
  it("writes the session so it survives a reload", () => {
    persistSession(validSession);
    expect(JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null")).toEqual(validSession);
  });

  it("clears the stored session on null (logout)", () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(validSession));
    persistSession(null);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("session-expired flag", () => {
  it("is not pending by default", () => {
    expect(sessionExpiredPending()).toBe(false);
  });

  it("markSessionExpired sets the per-tab flag", () => {
    markSessionExpired();
    expect(sessionExpiredPending()).toBe(true);
    expect(sessionStorage.getItem(EXPIRED_KEY)).toBe("1");
  });

  it("clearSessionExpired removes it so the notice shows once", () => {
    markSessionExpired();
    clearSessionExpired();
    expect(sessionExpiredPending()).toBe(false);
  });
});

describe("loadPersistedScopeSelection", () => {
  it("defaults to NO_SCOPE_SELECTION when nothing is stored", () => {
    expect(loadPersistedScopeSelection()).toEqual(NO_SCOPE_SELECTION);
  });

  it("restores a persisted selection", () => {
    const selection: ScopeSelection = { branchId: "BR-1", warehouseId: null };
    localStorage.setItem(SCOPE_KEY, JSON.stringify(selection));
    expect(loadPersistedScopeSelection()).toEqual(selection);
  });

  it("falls back to null fields for a malformed stored shape", () => {
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ branchId: 5, warehouseId: "WH-1" }));
    expect(loadPersistedScopeSelection()).toEqual({ branchId: null, warehouseId: "WH-1" });
  });

  it("returns NO_SCOPE_SELECTION for corrupt storage", () => {
    localStorage.setItem(SCOPE_KEY, "{not json");
    expect(loadPersistedScopeSelection()).toEqual(NO_SCOPE_SELECTION);
  });
});

describe("persistScopeSelection", () => {
  it("writes the selection so it survives a reload", () => {
    const selection: ScopeSelection = { branchId: "BR-2", warehouseId: "WH-2" };
    persistScopeSelection(selection);
    expect(JSON.parse(localStorage.getItem(SCOPE_KEY) ?? "null")).toEqual(selection);
  });
});

describe("tenant code", () => {
  it("returns null when nothing is stored", () => {
    expect(loadTenantCode()).toBeNull();
  });

  it("persistTenantCode lower-cases and trims before storing", () => {
    persistTenantCode(" Cyag ");
    expect(localStorage.getItem(TENANT_CODE_KEY)).toBe("cyag");
    expect(loadTenantCode()).toBe("cyag");
  });

  it("clearTenantCode removes it", () => {
    persistTenantCode("cyag");
    clearTenantCode();
    expect(loadTenantCode()).toBeNull();
  });
});

describe("authHeaders", () => {
  it("returns no headers for a signed-out caller with no tenant code stored", () => {
    expect(authHeaders(null)).toEqual({});
  });

  it("includes x-mezan-tenant when a company code is stored, even for a signed-out caller", () => {
    persistTenantCode("Cyag");
    expect(authHeaders(null)).toEqual({ "x-mezan-tenant": "cyag" });
  });

  it("sends the bearer token and the session's full scope with no selection", () => {
    expect(authHeaders(validSession)).toEqual({
      authorization: "Bearer TOKEN-1",
      "x-branch-scope": "BR-1",
      "x-warehouse-scope": "*",
    });
  });

  it("adds x-mezan-tenant alongside the session headers when a company code is stored", () => {
    persistTenantCode("nile");
    expect(authHeaders(validSession)).toEqual({
      authorization: "Bearer TOKEN-1",
      "x-branch-scope": "BR-1",
      "x-warehouse-scope": "*",
      "x-mezan-tenant": "nile",
    });
  });

  it("narrows to a selected branch that is within the session's scope", () => {
    const headers = authHeaders(validSession, { branchId: "BR-1", warehouseId: null });
    expect(headers["x-branch-scope"]).toBe("BR-1");
  });

  it("ignores a selected branch outside the session's granted scope, falling back to the full grant", () => {
    const headers = authHeaders(validSession, { branchId: "BR-OUTSIDE", warehouseId: null });
    expect(headers["x-branch-scope"]).toBe("BR-1");
  });

  it("narrows warehouse scope to a selection when the session scope is '*'", () => {
    const headers = authHeaders(validSession, { branchId: null, warehouseId: "WH-9" });
    expect(headers["x-warehouse-scope"]).toBe("WH-9");
  });

  it("joins a multi-branch session scope with commas when nothing narrows it", () => {
    const multi: Session = { ...validSession, branchScope: ["BR-1", "BR-2", "BR-3"] };
    expect(authHeaders(multi)["x-branch-scope"]).toBe("BR-1,BR-2,BR-3");
  });

  it("never sends x-permissions, x-user-id or x-role-code — the server resolves those from the token", () => {
    const headers = authHeaders(validSession);
    expect(headers).not.toHaveProperty("x-permissions");
    expect(headers).not.toHaveProperty("x-user-id");
    expect(headers).not.toHaveProperty("x-role-code");
  });
});

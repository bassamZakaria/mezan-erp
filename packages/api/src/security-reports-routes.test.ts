import { describe, it, expect } from "vitest";
import {
  createAuditEvent,
  createDefaultSettings,
  createMemorySecurityEventFallback,
  type AuditEvent,
  type AuditEventInput,
  type AuditQueryFilter,
  type AuditQueryPort,
  type AuditQueryResult,
  type TenantSettings,
  type User,
} from "@mezan/domain";
import { createSecurityReportsRoutes } from "./security-reports-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const VIEW = "audit.logs.view";

/**
 * An in-memory {@link AuditQueryPort} with the SAME semantics as the SQLite
 * one, the 200-row `limit` ceiling included. Without that ceiling the paging
 * these reports depend on would never be exercised, and the tests would pass on
 * a build that silently reported the first 200 events as the total.
 */
function fakePort(events: readonly AuditEvent[]): AuditQueryPort & { calls: AuditQueryFilter[] } {
  const calls: AuditQueryFilter[] = [];
  return {
    calls,
    async queryEvents(filter: AuditQueryFilter): Promise<AuditQueryResult> {
      calls.push(filter);
      const matched = events.filter((event) => {
        if (filter.stream && event.stream !== filter.stream) return false;
        if (filter.module && event.module !== filter.module) return false;
        if (filter.action && event.action !== filter.action) return false;
        if (filter.actor && event.actor !== filter.actor) return false;
        if (filter.entityType && event.entityType !== filter.entityType) return false;
        if (filter.entityId && event.entityId !== filter.entityId) return false;
        if (filter.severity && event.severity !== filter.severity) return false;
        if (filter.branchId && event.branchId !== filter.branchId) return false;
        if (filter.from && event.timestamp < filter.from) return false;
        if (filter.to && event.timestamp > filter.to) return false;
        return true;
      });
      const newestFirst = [...matched].reverse();
      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
      const offset = Math.max(filter.offset ?? 0, 0);
      return { events: newestFirst.slice(offset, offset + limit), total: matched.length };
    },
  };
}

function event(input: AuditEventInput): AuditEvent {
  return createAuditEvent(input);
}

function req(path: string, permissions = VIEW) {
  return new Request(`http://local${path}`, { headers: { "x-permissions": permissions } });
}

function settingsPort(overrides: Partial<TenantSettings> = {}) {
  const settings = createDefaultSettings(overrides);
  return { get: async () => settings };
}

function usersPort(users: readonly User[]) {
  return { list: async () => users };
}

function user(overrides: Partial<User> & Pick<User, "id" | "createdAt">): User {
  return {
    nameAr: "مستخدم",
    nameEn: null,
    email: `${overrides.id}@shop.test`,
    phone: null,
    passwordHash: "x",
    mustChangePassword: false,
    roleId: "role-clerk",
    isCompanyAdmin: false,
    employeeId: null,
    photoUrl: null,
    branchScope: "ALL",
    warehouseScope: "ALL",
    status: "active",
    lastLoginAt: null,
    ...overrides,
  } as User;
}

const NOW = () => new Date("2026-03-20T10:00:00.000Z");

describe("security-reports — permission gate", () => {
  it("refuses every route without audit.logs.view", async () => {
    const app = createSecurityReportsRoutes(
      { audit: fakePort([]), users: usersPort([]), now: NOW },
      insecureHeaderAuthContextResolver,
    );
    for (const path of ["/exceptions", "/post-posting-changes", "/after-hours", "/new-accounts"]) {
      const res = await app.fetch(req(path, "sales.invoice.view"));
      expect(res.status, path).toBe(403);
      expect(((await res.json()) as { permission: string }).permission).toBe(VIEW);
    }
  });
});

describe("تقرير الاستثناءات الأمنية", () => {
  const events = [
    event({ stream: "security", module: "admin", entityType: "USER", action: "PRIVILEGE_ESCALATION_DENIED", actor: "u-clerk", severity: "CRITICAL", timestamp: "2026-03-02T09:00:00.000Z" }),
    event({ stream: "security", module: "admin", entityType: "USER", action: "PRIVILEGE_ESCALATION_DENIED", actor: "u-clerk", severity: "CRITICAL", timestamp: "2026-03-02T09:05:00.000Z" }),
    event({ stream: "security", module: "auth", entityType: "AUTH_USER", action: "LOGIN_FAILED", actor: "anonymous", severity: "WARNING", timestamp: "2026-03-03T21:00:00.000Z" }),
    event({ stream: "security", module: "admin", entityType: "USER", action: "CREDENTIAL_RESET_BY_ADMIN", actor: "u-boss", entityId: "u-clerk", severity: "CRITICAL", timestamp: "2026-03-04T11:00:00.000Z" }),
    // A sensitive-stream row that must NOT appear on the security report.
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", action: "CONFIRM", actor: "u-clerk", severity: "INFO", timestamp: "2026-03-04T12:00:00.000Z" }),
  ];

  async function run(query = "?from=2026-03-01&to=2026-03-31") {
    const app = createSecurityReportsRoutes({ audit: fakePort(events), now: NOW }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req(`/exceptions${query}`));
    expect(res.status).toBe(200);
    return (await res.json()) as {
      rows: { actor: string; action: string; count: number; critical: number }[];
      groups: { key: string; totals: { count: number; critical: number } }[];
      grandTotals: { count: number; critical: number };
      watchlist: { action: string; count: number; actorCount: number; lastAt: string | null }[];
      coverage: { matched: number; scanned: number; truncated: boolean };
      recent: { stream: string }[];
    };
  }

  it("counts only the security stream, grouped by actor, with severity split out", async () => {
    const body = await run();
    expect(body.grandTotals).toEqual({ count: 4, critical: 3 });
    expect(body.recent.every((e) => e.stream === "security")).toBe(true);
    const clerk = body.groups.find((g) => g.key === "u-clerk");
    expect(clerk?.totals).toEqual({ count: 2, critical: 2 });
    const denied = body.rows.find((r) => r.actor === "u-clerk" && r.action === "PRIVILEGE_ESCALATION_DENIED");
    expect(denied?.count).toBe(2);
    expect(denied?.critical).toBe(2);
  });

  it("names the actor from the user register and keeps the id as the filter key (#121)", async () => {
    const app = createSecurityReportsRoutes(
      { audit: fakePort(events), users: usersPort([user({ id: "u-clerk", nameAr: "كاتب المبيعات", createdAt: "2025-01-01T08:00:00.000Z" })]), now: NOW },
      insecureHeaderAuthContextResolver,
    );
    const body = (await (await app.fetch(req("/exceptions?from=2026-03-01&to=2026-03-31"))).json()) as {
      rows: { actor: string; actorNameAr: string }[];
      groups: { key: string; labelAr: string }[];
    };
    const clerk = body.rows.find((r) => r.actor === "u-clerk");
    expect(clerk?.actorNameAr).toBe("كاتب المبيعات");
    expect(body.groups.find((g) => g.key === "u-clerk")?.labelAr).toBe("كاتب المبيعات");
    expect(body.rows.find((r) => r.actor === "anonymous")?.actorNameAr).toBe("anonymous");
  });

  it("filters by a typed user name, and refuses in Arabic with 422 when two users share that name", async () => {
    const twins = [
      user({ id: "u-clerk", nameAr: "كاتب المبيعات", createdAt: "2025-01-01T08:00:00.000Z" }),
      user({ id: "u-boss", nameAr: "المدير", createdAt: "2025-01-01T08:00:00.000Z" }),
    ];
    const named = createSecurityReportsRoutes({ audit: fakePort(events), users: usersPort(twins), now: NOW }, insecureHeaderAuthContextResolver);
    const one = (await (await named.fetch(req(`/exceptions?from=2026-03-01&to=2026-03-31&actor=${encodeURIComponent("كاتب المبيعات")}`))).json()) as { rows: { actor: string }[] };
    expect(new Set(one.rows.map((r) => r.actor))).toEqual(new Set(["u-clerk"]));

    const ambiguous = createSecurityReportsRoutes(
      { audit: fakePort(events), users: usersPort([...twins, user({ id: "u-clerk-2", nameAr: "كاتب المبيعات", createdAt: "2025-01-01T08:00:00.000Z" })]), now: NOW },
      insecureHeaderAuthContextResolver,
    );
    for (const path of ["/exceptions", "/post-posting-changes", "/after-hours"]) {
      const res = await ambiguous.fetch(req(`${path}?from=2026-03-01&to=2026-03-31&actor=${encodeURIComponent("كاتب المبيعات")}`));
      expect(res.status, path).toBe(422);
      expect(await res.json(), path).toEqual({ error: "VALIDATION_ERROR", errors: [{ field: "actor", message: "أكثر من مستخدم بهذا الاسم، اختر من القائمة", messageEn: "More than one user has this name; pick one from the list." }] });
    }
  });

  it("reports every named control, at zero when it did not fire", async () => {
    const body = await run();
    const byAction = new Map(body.watchlist.map((w) => [w.action, w]));
    for (const action of [
      "PRIVILEGE_ESCALATION_DENIED",
      "CREDENTIAL_RESET_BY_ADMIN",
      "ACCOUNT_LOCKED",
      "LOGIN_FAILED",
      "LOGIN_BLOCKED",
      "LOGIN_SUCCEEDED",
      "ACCOUNT_UNLOCKED",
      "BOOTSTRAP_REFUSED",
      "TENANT_CLAIMED",
    ]) {
      expect(byAction.has(action), action).toBe(true);
    }
    expect(byAction.get("ACCOUNT_LOCKED")).toMatchObject({ count: 0, actorCount: 0, lastAt: null });
    expect(byAction.get("PRIVILEGE_ESCALATION_DENIED")).toMatchObject({ count: 2, actorCount: 1 });
  });

  it("pages past the port's 200-row ceiling instead of reporting the first page as the total", async () => {
    const many = Array.from({ length: 470 }, (_, i) =>
      event({
        stream: "security",
        module: "auth",
        entityType: "AUTH_USER",
        action: "LOGIN_FAILED",
        actor: "anonymous",
        severity: "WARNING",
        timestamp: `2026-03-05T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
      }),
    );
    const app = createSecurityReportsRoutes({ audit: fakePort(many), now: NOW }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/exceptions?from=2026-03-01&to=2026-03-31"));
    const body = (await res.json()) as { grandTotals: { count: number }; coverage: { matched: number; truncated: boolean } };
    expect(body.grandTotals.count).toBe(470);
    expect(body.coverage).toMatchObject({ matched: 470, truncated: false });
  });

  it("ignores a caller-supplied limit — the bound is the server's", async () => {
    const port = fakePort([]);
    const app = createSecurityReportsRoutes({ audit: port, now: NOW }, insecureHeaderAuthContextResolver);
    await app.fetch(req("/exceptions?from=2026-03-01&to=2026-03-31&limit=1&offset=999"));
    expect(port.calls.every((call) => call.limit === 200)).toBe(true);
    expect(port.calls[0]?.offset).toBe(0);
  });

  it("400s a range whose start is after its end", async () => {
    const app = createSecurityReportsRoutes({ audit: fakePort([]), now: NOW }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req("/exceptions?from=2026-03-31&to=2026-03-01"));
    expect(res.status).toBe(400);
  });
});

describe("تقرير الاستثناءات الأمنية — أحداث لم يسجّلها سجل التدقيق", () => {
  it("shows how many security events the audit log refused and the latest of them, and zero when there is no fallback", async () => {
    const unrecorded = createMemorySecurityEventFallback();
    for (let n = 1; n <= 25; n += 1) {
      unrecorded.record({ at: `2026-03-05T10:00:${String(n).padStart(2, "0")}.000Z`, module: "auth", action: "LOGIN_FAILED", severity: "WARNING", actor: `u-${n}`, entityId: null, details: { origin: "10.0.0.9" }, reason: "disk full" });
    }
    const withFallback = createSecurityReportsRoutes({ audit: fakePort([]), unrecorded, now: NOW }, insecureHeaderAuthContextResolver);
    const body = (await (await withFallback.fetch(req("/exceptions?from=2026-03-01&to=2026-03-31"))).json()) as {
      unrecorded: { count: number; recent: Record<string, unknown>[] };
    };
    expect(body.unrecorded.count).toBe(25);
    expect(body.unrecorded.recent).toHaveLength(20);
    expect(body.unrecorded.recent[0]).toEqual({ at: "2026-03-05T10:00:25.000Z", module: "auth", action: "LOGIN_FAILED", severity: "WARNING", actor: "u-25", actorNameAr: "u-25", entityId: null, reason: "disk full" });

    const without = createSecurityReportsRoutes({ audit: fakePort([]), now: NOW }, insecureHeaderAuthContextResolver);
    expect(((await (await without.fetch(req("/exceptions?from=2026-03-01&to=2026-03-31"))).json()) as { unrecorded: unknown }).unrecorded).toEqual({ count: 0, recent: [], dropped: 0, corrupted: 0 });
  });
});

describe("تقرير التعديلات بعد الترحيل", () => {
  const events = [
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-1", action: "CANCEL", actor: "u-clerk", severity: "WARNING", timestamp: "2026-03-06T10:00:00.000Z", details: { docNo: "SI-0001", status: "cancelled" } }),
    event({ stream: "sensitive", module: "accounting", entityType: "JOURNAL_ENTRY", entityId: "je-1", action: "REVERSE", actor: "u-boss", severity: "WARNING", timestamp: "2026-03-07T10:00:00.000Z", details: { entryNo: "JE-0007", reversalId: "je-2" } }),
    event({ stream: "sensitive", module: "accounting", entityType: "FISCAL_PERIOD", entityId: "fp-1", action: "REOPEN", actor: "u-boss", severity: "WARNING", timestamp: "2026-03-08T10:00:00.000Z", details: { previousStatus: "closed" } }),
    event({ stream: "sensitive", module: "admin", entityType: "SEQUENCE", entityId: "SI", action: "SEQUENCE_COUNTER_ADJUSTED", actor: "u-boss", severity: "CRITICAL", timestamp: "2026-03-09T10:00:00.000Z", details: { from: 10, to: 90 } }),
    // Ordinary posting — never a post-posting change.
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-2", action: "CONFIRM", actor: "u-clerk", severity: "INFO", timestamp: "2026-03-09T11:00:00.000Z" }),
  ];

  async function run(query = "?from=2026-03-01&to=2026-03-31") {
    const app = createSecurityReportsRoutes({ audit: fakePort(events), now: NOW }, insecureHeaderAuthContextResolver);
    const res = await app.fetch(req(`/post-posting-changes${query}`));
    expect(res.status).toBe(200);
    return (await res.json()) as {
      rows: { action: string; changeType: string; docNo: string | null; reason: string | null; reversalId: string | null }[];
      groups: { key: string; totals: { count: number; withoutReason: number } }[];
      grandTotals: { count: number; withoutReason: number };
    };
  }

  it("selects voids, reversals, period reopens and numbering adjustments — and nothing else", async () => {
    const body = await run();
    expect(body.grandTotals.count).toBe(4);
    expect(body.rows.map((r) => r.changeType).sort()).toEqual(["NUMBERING_ADJUSTED", "PERIOD_REOPENED", "REVERSE", "VOID"]);
    expect(body.rows.some((r) => r.action === "CONFIRM")).toBe(false);
  });

  it("reads the document number and the reversing document out of the recorded details", async () => {
    const body = await run();
    expect(body.rows.find((r) => r.changeType === "VOID")?.docNo).toBe("SI-0001");
    expect(body.rows.find((r) => r.changeType === "REVERSE")?.docNo).toBe("JE-0007");
    expect(body.rows.find((r) => r.changeType === "REVERSE")?.reversalId).toBe("je-2");
  });

  it("leaves the reason null rather than inventing one, and counts the omissions", async () => {
    const body = await run();
    expect(body.rows.every((r) => r.reason === null)).toBe(true);
    expect(body.grandTotals.withoutReason).toBe(4);
  });

  it("narrows to one change type when asked", async () => {
    const body = await run("?from=2026-03-01&to=2026-03-31&changeType=VOID");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.changeType).toBe("VOID");
  });

  it("groups by the user who made the change", async () => {
    const body = await run();
    expect(body.groups.find((g) => g.key === "u-boss")?.totals.count).toBe(3);
    expect(body.groups.find((g) => g.key === "u-clerk")?.totals.count).toBe(1);
  });
});

describe("نشاط خارج أوقات العمل", () => {
  // Africa/Cairo is UTC+2 in March 2026 (DST starts late April), so these
  // instants are 07:00, 11:00 and 23:00 local on a Tuesday, plus one Friday.
  const events = [
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "a", action: "CONFIRM", actor: "u-clerk", severity: "INFO", timestamp: "2026-03-10T05:00:00.000Z" }),
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "b", action: "CONFIRM", actor: "u-clerk", severity: "INFO", timestamp: "2026-03-10T09:00:00.000Z" }),
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "c", action: "CANCEL", actor: "u-clerk", severity: "WARNING", timestamp: "2026-03-10T21:00:00.000Z" }),
    event({ stream: "security", module: "auth", entityType: "AUTH_USER", action: "LOGIN_SUCCEEDED", actor: "u-boss", severity: "INFO", timestamp: "2026-03-13T11:00:00.000Z" }),
  ];

  async function run(query = "?from=2026-03-01&to=2026-03-31", settings = settingsPort()) {
    const app = createSecurityReportsRoutes(
      { audit: fakePort(events), settings, now: NOW },
      insecureHeaderAuthContextResolver,
    );
    const res = await app.fetch(req(`/after-hours${query}`));
    expect(res.status).toBe(200);
    return (await res.json()) as {
      rows: { entityId: string | null; outsideReason: string; localTime: string; localDate: string; weekday: number; actor: string }[];
      grandTotals: { count: number; weekend: number; critical: number };
      workingHours: { timezone: string; startHour: number; endHour: number; startHourSource: string; weekendSource: string; weekendDays: number[] };
    };
  }

  it("flags before-hours, after-hours and weekend activity in the tenant's timezone, and nothing inside the working day", async () => {
    const body = await run();
    const byEntity = new Map(body.rows.map((r) => [r.entityId, r]));
    expect(byEntity.get("a")).toMatchObject({ outsideReason: "BEFORE_HOURS", localTime: "07:00", localDate: "2026-03-10" });
    expect(byEntity.has("b")).toBe(false);
    expect(byEntity.get("c")).toMatchObject({ outsideReason: "AFTER_HOURS", localTime: "23:00" });
    const friday = body.rows.find((r) => r.actor === "u-boss");
    expect(friday).toMatchObject({ outsideReason: "WEEKEND", weekday: 5 });
    expect(body.grandTotals).toEqual({ count: 3, weekend: 1, critical: 0 });
  });

  it("declares that the start of the working day is an assumption, not a setting", async () => {
    const body = await run();
    expect(body.workingHours.startHourSource).toBe("default");
    expect(body.workingHours.weekendSource).toBe("settings");
    expect(body.workingHours.startHour).toBe(8);
    expect(body.workingHours.endHour).toBe(16);
  });

  it("uses the tenant's configured weekend, not a hard-coded one", async () => {
    const body = await run("?from=2026-03-01&to=2026-03-31", settingsPort({ weekendDays: [2] }));
    expect(body.workingHours.weekendDays).toEqual([2]);
    // Tuesday is now the weekend, so every event of 2026-03-10 is outside hours
    // and the Friday one falls back inside the working day.
    expect(body.rows.filter((r) => r.outsideReason === "WEEKEND")).toHaveLength(3);
  });

  it("narrows to one stream when asked", async () => {
    const body = await run("?from=2026-03-01&to=2026-03-31&stream=security");
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.actor).toBe("u-boss");
  });

  it("pages the rows across actor groups while every count stays over the whole result", async () => {
    const full = await run();
    const paged = (await run("?from=2026-03-01&to=2026-03-31&pageSize=1&page=2")) as typeof full & {
      groups: { key: string; rows: unknown[]; totals: { count: number } }[];
      kpis: unknown;
      page: unknown;
    };
    const fullGroups = (full as typeof paged).groups;
    expect(paged.page).toEqual({ page: 2, pageSize: 1, totalRows: 3 });
    expect(paged.rows).toEqual([fullGroups.flatMap((g) => g.rows)[1]]);
    expect(paged.groups).toHaveLength(1);
    expect(paged.groups[0]?.totals).toEqual(fullGroups.find((g) => g.key === paged.groups[0]?.key)?.totals);
    expect(paged.grandTotals).toEqual(full.grandTotals);
    expect(paged.kpis).toEqual((full as typeof paged).kpis);
  });

  it("hands every row in the order the pages show them, so an export reads like the screen", async () => {
    const full = (await run()) as Awaited<ReturnType<typeof run>> & { groups: { rows: unknown[] }[] };
    expect(full.rows).toEqual(full.groups.flatMap((g) => g.rows));
    const pages: unknown[] = [];
    for (const page of [1, 2, 3]) pages.push(...(await run(`?from=2026-03-01&to=2026-03-31&pageSize=1&page=${page}`)).rows);
    expect(pages).toEqual(full.rows);
  });
});

describe("حسابات أُنشئت حديثاً", () => {
  const users = [
    user({ id: "u-ghost", nameAr: "حساب مؤقت", createdAt: "2026-03-01T08:00:00.000Z", status: "inactive" }),
    user({ id: "u-new", nameAr: "موظف جديد", createdAt: "2026-03-05T08:00:00.000Z", lastLoginAt: "2026-03-06T08:00:00.000Z" }),
    user({ id: "u-old", nameAr: "موظف قديم", createdAt: "2024-01-01T08:00:00.000Z" }),
  ];
  const events = [
    event({ stream: "sensitive", module: "admin", entityType: "USER", entityId: "u-ghost", action: "CREATE", actor: "u-boss", severity: "WARNING", timestamp: "2026-03-01T08:00:00.000Z" }),
    event({ stream: "security", module: "admin", entityType: "USER", entityId: "u-ghost", action: "CREDENTIAL_RESET_BY_ADMIN", actor: "u-boss", severity: "CRITICAL", timestamp: "2026-03-02T08:00:00.000Z" }),
    // The ghost transacts: two CONFIRM rows on one document must count once.
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-9", action: "CONFIRM", actor: "u-ghost", severity: "INFO", timestamp: "2026-03-03T08:00:00.000Z" }),
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-9", action: "CONFIRM", actor: "u-ghost", severity: "INFO", timestamp: "2026-03-03T08:01:00.000Z" }),
    event({ stream: "sensitive", module: "sales", entityType: "SALES_INVOICE", entityId: "inv-9", action: "CANCEL", actor: "u-ghost", severity: "WARNING", timestamp: "2026-03-04T08:00:00.000Z" }),
  ];

  async function run(query = "") {
    const app = createSecurityReportsRoutes(
      { audit: fakePort(events), users: usersPort(users), now: NOW },
      insecureHeaderAuthContextResolver,
    );
    const res = await app.fetch(req(`/new-accounts${query}`));
    expect(res.status).toBe(200);
    return (await res.json()) as {
      params: { days: number; since: string };
      rows: {
        userId: string;
        createdBy: string | null;
        postedDocumentCount: number;
        voidedDocumentCount: number;
        credentialResetCount: number;
        lastActivityAt: string | null;
      }[];
      groups: { key: string; labelAr: string; totals: { count: number; postedDocumentCount: number } }[];
      grandTotals: { count: number };
    };
  }

  it("joins the created account to the administrator who created it", async () => {
    const body = await run();
    const ghost = body.rows.find((r) => r.userId === "u-ghost");
    expect(ghost?.createdBy).toBe("u-boss");
    expect((ghost as { createdByNameAr?: string | null } | undefined)?.createdByNameAr).toBe("u-boss");
    expect(body.groups.find((g) => g.key === "u-boss")?.totals.count).toBe(1);
  });

  it("counts distinct documents posted and voided by the new account", async () => {
    const ghost = (await run()).rows.find((r) => r.userId === "u-ghost");
    expect(ghost?.postedDocumentCount).toBe(1);
    expect(ghost?.voidedDocumentCount).toBe(1);
    expect(ghost?.credentialResetCount).toBe(1);
    expect(ghost?.lastActivityAt).toBe("2026-03-04T08:00:00.000Z");
  });

  it("says so when no CREATE row names a creator, instead of guessing one", async () => {
    const body = await run();
    const fresh = body.rows.find((r) => r.userId === "u-new");
    expect(fresh?.createdBy).toBeNull();
    expect(body.groups.find((g) => g.key === "__unknown__")?.labelAr).toBe("منشئ غير مسجَّل");
  });

  it("excludes accounts older than the window and clamps the window server-side", async () => {
    const body = await run("?days=99999");
    expect(body.params.days).toBe(365);
    expect(body.rows.some((r) => r.userId === "u-old")).toBe(false);
    expect(body.grandTotals.count).toBe(2);
  });

  it("filters by creator id or by the creator's unique name, and refuses an ambiguous name with 422", async () => {
    const withBoss = [...users, user({ id: "u-boss", nameAr: "المدير", createdAt: "2020-01-01T08:00:00.000Z" })];
    const app = (register: readonly User[]) => createSecurityReportsRoutes({ audit: fakePort(events), users: usersPort(register), now: NOW }, insecureHeaderAuthContextResolver);
    for (const createdBy of ["u-boss", "المدير"]) {
      const body = (await (await app(withBoss).fetch(req(`/new-accounts?createdBy=${encodeURIComponent(createdBy)}`))).json()) as { rows: { userId: string }[] };
      expect(body.rows.map((r) => r.userId), createdBy).toEqual(["u-ghost"]);
    }
    const twin = user({ id: "u-boss-2", nameAr: "المدير", createdAt: "2020-01-01T08:00:00.000Z" });
    const res = await app([...withBoss, twin]).fetch(req(`/new-accounts?createdBy=${encodeURIComponent("المدير")}`));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { errors: { field: string }[] }).errors[0]?.field).toBe("createdBy");
  });

  it("is not mounted at all when no user register is wired", async () => {
    const app = createSecurityReportsRoutes({ audit: fakePort([]), now: NOW }, insecureHeaderAuthContextResolver);
    expect((await app.fetch(req("/new-accounts"))).status).toBe(404);
  });
});

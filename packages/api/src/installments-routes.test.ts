import { describe, it, expect, afterEach } from "vitest";
import {
  DocumentService,
  Money,
  installmentPlanDocumentType,
  type InstallmentLine,
  type InstallmentPlanDocument,
} from "@mezan/domain";
import {
  createSqliteLedgerStore,
  createStandaloneSqliteInstallmentPlanStore,
  createStandaloneSqliteFollowUpStore,
} from "@mezan/persistence";
import { createInstallmentsRoutes, type InstallmentsRoutesDeps } from "./installments-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

async function buildDeps(): Promise<InstallmentsRoutesDeps> {
  const ledger = createSqliteLedgerStore();
  const plansRepo = createStandaloneSqliteInstallmentPlanStore();
  const followUps = createStandaloneSqliteFollowUpStore();
  closers.push(ledger, plansRepo, followUps);

  const numbering = ledger.numbering;
  const plans = new DocumentService(installmentPlanDocumentType, {
    repo: plansRepo,
    numbering: { next: () => numbering.next("INSTALLMENT_PLAN") },
  });

  return { plans, plansRepo, followUps };
}

async function newApp() {
  return createInstallmentsRoutes(await buildDeps(), insecureHeaderAuthContextResolver);
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const VIEW = "installments.plan.view";
const CREATE = "installments.plan.create";
const CANCEL = "installments.plan.cancel";
const OVERDUE = "installments.overdue.process";
const FU_VIEW = "installments.follow_up.view";
const FU_MANAGE = "installments.follow_up.manage";

const planPayload = {
  id: "IP1",
  date: "2026-08-01",
  memo: "",
  customerId: "CUST1",
  sourceInvoiceId: "INV1",
  sourceInvoiceNumber: "INV-000014",
  invoiceTotal: "10000.00",
  downPayment: "0",
  installmentCount: 3,
  frequency: "MONTHLY" as const,
  startDate: "2026-09-01",
};

interface PlanBody {
  id: string;
  docType: string;
  docNo: string | null;
  status: string;
  confirmedAt: string | null;
  lines: {
    no: number;
    customerId: string;
    sourceInvoiceId: string;
    sourceInvoiceNumber: string | null;
    frequency: string;
    downPayment: string;
    dueDate: string;
    amount: string;
    paidAmount: string;
    status: string;
    lateFeeAmount: string;
  }[];
}

describe("installments plan router — permission gate", () => {
  it("403s with no permissions and names the permission it wanted", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe(VIEW);
  });

  it("403s with a permission from an unrelated module", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans", { permissions: "sales.invoice.view" }));
    expect(res.status).toBe(403);
  });

  it("200s with the right permission", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans", { permissions: VIEW }));
    expect(res.status).toBe(200);
  });

  it("gates create separately from view", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans", { method: "POST", permissions: VIEW, body: JSON.stringify(planPayload) }),
    );
    expect(res.status).toBe(403);
  });

  it("gates cancel separately from view", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans/IP1/cancel", { method: "POST", permissions: VIEW, body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("gates the overdue batch on its own permission", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans/overdue/process", { method: "POST", permissions: VIEW, body: JSON.stringify({ asOfDate: "2026-09-01" }) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("installments plan router — schedule generation (largest-remainder)", () => {
  it("splits 10,000.00 over 3 monthly installments so the parts sum EXACTLY, extra micro-unit on the first", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as PlanBody;

    expect(body.status).toBe("draft");
    expect(body.docNo).toBeNull();
    expect(body.lines).toHaveLength(3);

    // 10,000.000000 / 3 = 3,333.333333 remainder 1 micro-unit each (equal
    // remainders), tie-broken to the lowest index — hand-derived, not copied
    // from the response.
    expect(body.lines[0]?.amount).toBe("3333.333334");
    expect(body.lines[1]?.amount).toBe("3333.333333");
    expect(body.lines[2]?.amount).toBe("3333.333333");

    const total = body.lines.reduce((sum, l) => sum + Money.fromMajor(l.amount).scaled, 0n);
    expect(total).toBe(Money.fromMajor("10000.00").scaled);

    // Due dates: MONTHLY from 2026-09-01 → 2026-09-01, 2026-10-01, 2026-11-01.
    expect(body.lines[0]?.dueDate).toBe("2026-09-01");
    expect(body.lines[1]?.dueDate).toBe("2026-10-01");
    expect(body.lines[2]?.dueDate).toBe("2026-11-01");

    for (const line of body.lines) {
      expect(line.customerId).toBe("CUST1");
      expect(line.sourceInvoiceId).toBe("INV1");
      expect(line.sourceInvoiceNumber).toBe("INV-000014");
      expect(line.frequency).toBe("MONTHLY");
      expect(line.status).toBe("pending");
      expect(line.paidAmount).toBe("0.000000");
      expect(line.lateFeeAmount).toBe("0.000000");
      expect(line.downPayment).toBe("0.000000");
    }
    expect(body.lines[0]?.no).toBe(1);
    expect(body.lines[1]?.no).toBe(2);
    expect(body.lines[2]?.no).toBe(3);
  });

  it("takes the down payment off the top before splitting the remainder", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans", {
        method: "POST",
        permissions: CREATE,
        body: JSON.stringify({ ...planPayload, id: "IP-DP", downPayment: "1000.00", installmentCount: 2 }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as PlanBody;
    // (10000.00 - 1000.00) / 2 = 4500.00 exactly, no remainder to distribute.
    expect(body.lines[0]?.amount).toBe("4500.000000");
    expect(body.lines[1]?.amount).toBe("4500.000000");
    expect(body.lines[0]?.downPayment).toBe("1000.000000");
    const total = body.lines.reduce((sum, l) => sum + Money.fromMajor(l.amount).scaled, 0n);
    expect(total).toBe(Money.fromMajor("9000.00").scaled);
  });
});

describe("installments plan router — validation refusals", () => {
  it("400s a missing customerId and names the field, and creates nothing", async () => {
    const app = await newApp();
    const { customerId: _drop, ...bad } = planPayload;
    const res = await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(bad) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: { fieldErrors: Record<string, string[]> } };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.details.fieldErrors.customerId).toBeTruthy();

    const list = await app.fetch(req("/plans", { permissions: VIEW }));
    expect(((await list.json()) as unknown[]).length).toBe(0);
  });

  it("400s installmentCount below 1", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "IP-ZERO", installmentCount: 0 }) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
    expect(body.details.fieldErrors.installmentCount).toBeTruthy();
  });

  it("400s a non-decimal invoiceTotal", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "IP-NAN", invoiceTotal: "abc" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("422s a down payment that exceeds the invoice total, naming the domain error, and creates nothing", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/plans", {
        method: "POST",
        permissions: CREATE,
        body: JSON.stringify({ ...planPayload, id: "IP-BADDP", downPayment: "20000.00" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_INSTALLMENT_SCHEDULE");

    const found = await app.fetch(req("/plans/IP-BADDP", { permissions: VIEW }));
    expect(found.status).toBe(404);
  });

  it("409s a duplicate id and leaves the original untouched", async () => {
    const app = await newApp();
    const first = await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }));
    expect(first.status).toBe(201);
    const dup = await app.fetch(
      req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, memo: "different" }) }),
    );
    expect(dup.status).toBe(409);

    const still = await app.fetch(req("/plans/IP1", { permissions: VIEW }));
    const body = (await still.json()) as PlanBody & { memo: string };
    expect(body.memo).toBe("");
  });
});

describe("installments plan router — not found", () => {
  it("404s GET /plans/:id for an id that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans/GHOST", { permissions: VIEW }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("NOT_FOUND");
  });

  it("404s confirming an id that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans/GHOST/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    expect(res.status).toBe(404);
  });

  it("404s cancelling an id that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans/GHOST/cancel", { method: "POST", permissions: CANCEL, body: "{}" }));
    expect(res.status).toBe(404);
  });
});

describe("installments plan router — confirm and cancel lifecycle", () => {
  async function createdApp() {
    const app = await newApp();
    const created = await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }));
    expect(created.status).toBe(201);
    return app;
  }

  it("confirms a draft: stamps a docNo from the INSTALLMENT_PLAN sequence and moves it to confirmed", async () => {
    const app = await createdApp();
    const res = await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: PlanBody; held: boolean };
    expect(body.held).toBe(false);
    expect(body.document.status).toBe("confirmed");
    expect(body.document.docNo).toBe("IP-000001");
    expect(body.document.confirmedAt).not.toBeNull();

    const readBack = await app.fetch(req("/plans/IP1", { permissions: VIEW }));
    const readBackBody = (await readBack.json()) as PlanBody;
    expect(readBackBody.status).toBe("confirmed");
    expect(readBackBody.docNo).toBe("IP-000001");
  });

  it("409s confirming an already-confirmed plan a second time", async () => {
    const app = await createdApp();
    const first = await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    expect(first.status).toBe(200);
    const second = await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("INVALID_DOCUMENT_TRANSITION");
  });

  it("cancels a draft plan", async () => {
    const app = await createdApp();
    const res = await app.fetch(req("/plans/IP1/cancel", { method: "POST", permissions: CANCEL, body: "{}" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanBody;
    expect(body.status).toBe("cancelled");

    const readBack = await app.fetch(req("/plans/IP1", { permissions: VIEW }));
    expect(((await readBack.json()) as PlanBody).status).toBe("cancelled");
  });

  it("409s cancelling a CONFIRMED plan — a live plan can only be reversed, never cancelled", async () => {
    const app = await createdApp();
    const confirm = await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    expect(confirm.status).toBe(200);

    const res = await app.fetch(req("/plans/IP1/cancel", { method: "POST", permissions: CANCEL, body: "{}" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("INVALID_DOCUMENT_TRANSITION");

    const readBack = await app.fetch(req("/plans/IP1", { permissions: VIEW }));
    expect(((await readBack.json()) as PlanBody).status).toBe("confirmed");
  });
});

describe("installments plan router — the collect route the catalogue always promised (D119)", () => {
  it("mounts a route for installments.collect, and it moves paidAmount off zero", async () => {
    const deps = await buildDeps();
    const app = createInstallmentsRoutes(
      { ...deps, collect: async () => ({ voucherId: "VCH-1" }) },
      insecureHeaderAuthContextResolver,
    );

    const paths = app.routes.map((r) => `${r.method} ${r.path}`);
    expect(paths.some((p) => /collect/i.test(p))).toBe(true);

    const created = await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }));
    expect(created.status).toBe(201);
    await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE, body: "{}" }));

    const collected = await app.fetch(
      req("/plans/IP1/collect", {
        method: "POST",
        permissions: "installments.collect",
        body: JSON.stringify({
          installmentNo: 1,
          amount: "1000.00",
          treasuryAccountId: "TRS-CASH",
          branchId: "BR1",
          date: "2026-09-01",
        }),
      }),
    );
    expect(collected.status).toBe(200);

    const readBack = await app.fetch(req("/plans/IP1", { permissions: VIEW }));
    const body = (await readBack.json()) as PlanBody;
    expect(Number(body.lines.find((l) => l.no === 1)?.paidAmount)).toBeCloseTo(1000, 2);
  });
});

describe("installments plan router — status filters, chips and the KPI strip (R1.1)", () => {
  async function scenario() {
    const app = await newApp();
    // Plan A: confirmed, one line becomes overdue.
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "A", installmentCount: 2, startDate: "2026-08-01" }) }));
    await app.fetch(req("/plans/A/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    await app.fetch(
      req("/plans/overdue/process", { method: "POST", permissions: OVERDUE, body: JSON.stringify({ asOfDate: "2026-09-15" }) }),
    );
    // Plan B: left as a draft.
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "B", installmentCount: 1 }) }));
    // Plan C: confirmed, cancelled draft is illegal so cancel it while still draft.
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "C", installmentCount: 1 }) }));
    await app.fetch(req("/plans/C/cancel", { method: "POST", permissions: CANCEL, body: "{}" }));
    return app;
  }

  it("`all` and unfiltered both return every plan regardless of status", async () => {
    const app = await scenario();
    const res = await app.fetch(req("/plans", { permissions: VIEW }));
    const rows = (await res.json()) as PlanBody[];
    expect(rows.map((r) => r.id).sort()).toEqual(["A", "B", "C"]);
  });

  it("status=confirmed returns only the confirmed plan", async () => {
    const app = await scenario();
    const res = await app.fetch(req("/plans?status=confirmed", { permissions: VIEW }));
    const rows = (await res.json()) as PlanBody[];
    expect(rows.map((r) => r.id)).toEqual(["A"]);
  });

  it("status=overdue (derived) returns the confirmed plan with an overdue line, not the plain confirmed filter's whole set", async () => {
    const app = await scenario();
    const res = await app.fetch(req("/plans?status=overdue", { permissions: VIEW }));
    const rows = (await res.json()) as PlanBody[];
    expect(rows.map((r) => r.id)).toEqual(["A"]);
    expect(rows[0]?.lines.some((l) => l.status === "overdue")).toBe(true);
  });

  it("a filter that matches nothing returns an empty list, not everything", async () => {
    const app = await scenario();
    const res = await app.fetch(req("/plans?status=posted", { permissions: VIEW }));
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("/counts ignores the status query and always reports every bucket", async () => {
    const app = await scenario();
    const filtered = await app.fetch(req("/plans/counts?status=confirmed", { permissions: VIEW }));
    const unfiltered = await app.fetch(req("/plans/counts", { permissions: VIEW }));
    const filteredBody = await filtered.json();
    const unfilteredBody = await unfiltered.json();
    expect(filteredBody).toEqual(unfilteredBody);
    expect((filteredBody as Record<string, number>).all).toBe(3);
    expect((filteredBody as Record<string, number>).draft).toBe(1);
    expect((filteredBody as Record<string, number>).confirmed).toBe(1);
    expect((filteredBody as Record<string, number>).cancelled).toBe(1);
    expect((filteredBody as Record<string, number>).overdue).toBe(1);
  });

  it("/stats sums scheduled money over the filtered set only, honouring the status filter unlike /counts", async () => {
    const app = await scenario();
    // Plan A confirmed, 2 installments of 10000.00 split: 5000.000000 + 5000.000000.
    const confirmedOnly = await app.fetch(req("/plans/stats?status=confirmed", { permissions: VIEW }));
    const confirmedBody = (await confirmedOnly.json()) as { count: number; active: number; overdue: number; scheduled: string; paid: string; remaining: string };
    expect(confirmedBody.count).toBe(1);
    expect(confirmedBody.active).toBe(1);
    expect(confirmedBody.overdue).toBe(1);
    expect(confirmedBody.scheduled).toBe("10000.000000");
    expect(confirmedBody.paid).toBe("0.000000");
    expect(confirmedBody.remaining).toBe("10000.000000");

    // The unfiltered strip counts all three plans but only sums the money
    // still live: C was cancelled, so its 10,000 is out (D120).
    const all = await app.fetch(req("/plans/stats", { permissions: VIEW }));
    const allBody = (await all.json()) as { scheduled: string; count: number };
    expect(allBody.count).toBe(3);
    expect(allBody.scheduled).toBe("20000.000000");
  });

  it("GUARANTEE (D120): cancelling a PLAN cancels its unpaid LINES, so /stats stops counting them as live money", async () => {
    const app = await scenario();
    // `DocumentService.cancel` only flipped the document status and never
    // touched `doc.lines`; nothing in the codebase produced the "cancelled"
    // line status the enum declares, so a cancelled plan kept contributing
    // its full scheduled and remaining amounts to every total (D120).
    const plan = (await (await app.fetch(req("/plans/C", { permissions: VIEW }))).json()) as PlanBody;
    expect(plan.status).toBe("cancelled");
    expect(plan.lines.map((l) => l.status)).toEqual(["cancelled"]);

    const cancelledOnly = await app.fetch(req("/plans/stats?status=cancelled", { permissions: VIEW }));
    const cancelledBody = (await cancelledOnly.json()) as { scheduled: string; remaining: string; count: number };
    expect(cancelledBody.count).toBe(1);
    expect(cancelledBody.scheduled).toBe("0.000000");
    expect(cancelledBody.remaining).toBe("0.000000");

    // And the unfiltered strip drops the cancelled plan out of the money it
    // reports as scheduled, while still counting the plan itself.
    const all = await app.fetch(req("/plans/stats", { permissions: VIEW }));
    const allBody = (await all.json()) as { scheduled: string; count: number };
    expect(allBody.count).toBe(3);
    expect(allBody.scheduled).toBe("20000.000000");
  });

  it("GUARANTEE (D120): a paid installment stays paid when the plan is cancelled", async () => {
    // The negative control. Cancelling the plan cancels what is still OWED;
    // money the customer actually handed over is not erased by it, or the
    // paid total would fall and the treasury receipt would have nothing to
    // reconcile against.
    const deps = await buildDeps();
    const app = createInstallmentsRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "PC", installmentCount: 2 }) }));

    const doc = (await deps.plansRepo.findById("PC")) as InstallmentPlanDocument;
    const settled: InstallmentLine = { ...(doc.lines[0] as InstallmentLine), paidAmount: Money.fromMajor("5000.00"), status: "paid" };
    await deps.plansRepo.update({ ...doc, lines: [settled, doc.lines[1] as InstallmentLine] });

    await app.fetch(req("/plans/PC/cancel", { method: "POST", permissions: CANCEL, body: "{}" }));
    const after = (await (await app.fetch(req("/plans/PC", { permissions: VIEW }))).json()) as PlanBody;
    expect(after.lines.map((l) => l.status)).toEqual(["paid", "cancelled"]);

    const stats = (await (await app.fetch(req("/plans/stats?status=cancelled", { permissions: VIEW }))).json()) as {
      scheduled: string;
      paid: string;
      remaining: string;
    };
    expect(stats.scheduled).toBe("5000.000000");
    expect(stats.paid).toBe("5000.000000");
    expect(stats.remaining).toBe("0.000000");
  });

  it("/stats' remaining figure counts what is owed, not a net position, once a line is overpaid", async () => {
    const deps = await buildDeps();
    const app = createInstallmentsRoutes(deps, insecureHeaderAuthContextResolver);
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify({ ...planPayload, id: "OP", installmentCount: 2 }) }));
    await app.fetch(req("/plans/OP/confirm", { method: "POST", permissions: CREATE, body: "{}" }));

    // Simulate what a (not-yet-built) collection route would do to the
    // document — written through the real repository the routes themselves
    // read from, not a mock: overpay line 1, leave line 2 untouched.
    const doc = (await deps.plansRepo.findById("OP")) as InstallmentPlanDocument;
    const overpaid: InstallmentLine = { ...(doc.lines[0] as InstallmentLine), paidAmount: Money.fromMajor("9000.00") };
    await deps.plansRepo.update({ ...doc, lines: [overpaid, doc.lines[1] as InstallmentLine] });

    const res = await app.fetch(req("/plans/stats", { permissions: VIEW }));
    const body = (await res.json()) as { paid: string; remaining: string };
    // Line 1: amount 5000.00, paid 9000.00 (overpaid by 4000.00, owes nothing).
    // Line 2: amount 5000.00, paid 0.00 (owes the full 5000.00).
    // Remaining must be 5000.00 — the overpayment on line 1 must not net
    // against what line 2 still owes.
    expect(body.paid).toBe("9000.000000");
    expect(body.remaining).toBe("5000.000000");
  });
});

describe("installments plan router — overdue batch at the due-date boundary", () => {
  async function confirmedSingleLine(dueDate: string) {
    const app = await newApp();
    await app.fetch(
      req("/plans", {
        method: "POST",
        permissions: CREATE,
        body: JSON.stringify({ ...planPayload, id: "BND", installmentCount: 1, startDate: dueDate, downPayment: "0", invoiceTotal: "100.00" }),
      }),
    );
    await app.fetch(req("/plans/BND/confirm", { method: "POST", permissions: CREATE, body: "{}" }));
    return app;
  }

  it("due exactly on the asOfDate stays pending, not overdue", async () => {
    const app = await confirmedSingleLine("2026-09-15");
    const res = await app.fetch(
      req("/plans/overdue/process", { method: "POST", permissions: OVERDUE, body: JSON.stringify({ asOfDate: "2026-09-15" }) }),
    );
    const result = (await res.json()) as { newlyOverdueCount: number };
    expect(result.newlyOverdueCount).toBe(0);
    const plan = (await (await app.fetch(req("/plans/BND", { permissions: VIEW }))).json()) as PlanBody;
    expect(plan.lines[0]?.status).toBe("pending");
  });

  it("one day past due flips to overdue", async () => {
    const app = await confirmedSingleLine("2026-09-15");
    const res = await app.fetch(
      req("/plans/overdue/process", { method: "POST", permissions: OVERDUE, body: JSON.stringify({ asOfDate: "2026-09-16" }) }),
    );
    const result = (await res.json()) as { newlyOverdueCount: number };
    expect(result.newlyOverdueCount).toBe(1);
    const plan = (await (await app.fetch(req("/plans/BND", { permissions: VIEW }))).json()) as PlanBody;
    expect(plan.lines[0]?.status).toBe("overdue");
  });

  it("one day early stays pending", async () => {
    const app = await confirmedSingleLine("2026-09-15");
    const res = await app.fetch(
      req("/plans/overdue/process", { method: "POST", permissions: OVERDUE, body: JSON.stringify({ asOfDate: "2026-09-14" }) }),
    );
    const result = (await res.json()) as { newlyOverdueCount: number };
    expect(result.newlyOverdueCount).toBe(0);
    const plan = (await (await app.fetch(req("/plans/BND", { permissions: VIEW }))).json()) as PlanBody;
    expect(plan.lines[0]?.status).toBe("pending");
  });

  it("400s a malformed overdue-process body", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/plans/overdue/process", { method: "POST", permissions: OVERDUE, body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it("the batch's totalLateFeesApplied is always zero — the late-fee rule is an explicit unconfigured stub", async () => {
    const app = await confirmedSingleLine("2026-09-15");
    const res = await app.fetch(
      req("/plans/overdue/process", { method: "POST", permissions: OVERDUE, body: JSON.stringify({ asOfDate: "2026-09-20" }) }),
    );
    const result = (await res.json()) as { totalLateFeesApplied: string };
    expect(result.totalLateFeesApplied).toBe("0.000000");
  });
});

// --- متابعة التحصيل (collection follow-ups) --------------------------------

interface FollowUpBody {
  id: string;
  customerId: string;
  installmentPlanId: string | null;
  type: string;
  followUpDate: string;
  assignedTo: string | null;
  notes: string | null;
  status: string;
  outcome: string | null;
}

const followUpPayload = {
  id: "FU1",
  customerId: "CUST1",
  installmentPlanId: null,
  type: "CALL" as const,
  followUpDate: "2026-09-01",
  assignedTo: null,
  notes: "اتصال متابعة",
};

describe("follow-ups router — permission gate", () => {
  it("403s with no permissions", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/follow-ups", { permissions: undefined }));
    expect(res.status).toBe(403);
  });

  it("gates create/complete/cancel on the manage permission, distinct from view", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/follow-ups", { method: "POST", permissions: FU_VIEW, body: JSON.stringify(followUpPayload) }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { permission: string };
    expect(body.permission).toBe(FU_MANAGE);
  });
});

describe("follow-ups router — create + validation", () => {
  it("creates a pending follow-up and reads it back", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/follow-ups", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify(followUpPayload) }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as FollowUpBody;
    expect(body.status).toBe("pending");
    expect(body.outcome).toBeNull();
    expect(body.notes).toBe("اتصال متابعة");
    expect(body.type).toBe("CALL");

    const list = await app.fetch(req("/follow-ups", { permissions: FU_VIEW }));
    const rows = (await list.json()) as FollowUpBody[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("FU1");
  });

  it("400s a missing customerId, naming the field", async () => {
    const app = await newApp();
    const { customerId: _drop, ...bad } = followUpPayload;
    const res = await app.fetch(req("/follow-ups", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify(bad) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { fieldErrors: Record<string, string[]> } };
    expect(body.details.fieldErrors.customerId).toBeTruthy();
  });
});

describe("follow-ups router — complete/cancel state machine", () => {
  async function createdApp() {
    const app = await newApp();
    await app.fetch(req("/follow-ups", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify(followUpPayload) }));
    return app;
  }

  it("completes a pending follow-up with its outcome", async () => {
    const app = await createdApp();
    const res = await app.fetch(
      req("/follow-ups/FU1/complete", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ outcome: "وعد بالسداد الأسبوع القادم" }) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as FollowUpBody;
    expect(body.status).toBe("completed");
    expect(body.outcome).toBe("وعد بالسداد الأسبوع القادم");
  });

  it("400s completing with an empty outcome", async () => {
    const app = await createdApp();
    const res = await app.fetch(
      req("/follow-ups/FU1/complete", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ outcome: "" }) }),
    );
    expect(res.status).toBe(400);
  });

  it("404s completing a follow-up that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(
      req("/follow-ups/GHOST/complete", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ outcome: "x" }) }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("FOLLOW_UP_NOT_FOUND");
  });

  it("409s completing an already-completed follow-up", async () => {
    const app = await createdApp();
    const first = await app.fetch(
      req("/follow-ups/FU1/complete", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ outcome: "تم السداد" }) }),
    );
    expect(first.status).toBe(200);
    const second = await app.fetch(
      req("/follow-ups/FU1/complete", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ outcome: "مرة أخرى" }) }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("INVALID_FOLLOW_UP_TRANSITION");
  });

  it("cancels a pending follow-up", async () => {
    const app = await createdApp();
    const res = await app.fetch(req("/follow-ups/FU1/cancel", { method: "POST", permissions: FU_MANAGE, body: "{}" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as FollowUpBody).status).toBe("cancelled");
  });

  it("404s cancelling a follow-up that does not exist", async () => {
    const app = await newApp();
    const res = await app.fetch(req("/follow-ups/GHOST/cancel", { method: "POST", permissions: FU_MANAGE, body: "{}" }));
    expect(res.status).toBe(404);
  });

  it("409s cancelling an already-cancelled follow-up", async () => {
    const app = await createdApp();
    const first = await app.fetch(req("/follow-ups/FU1/cancel", { method: "POST", permissions: FU_MANAGE, body: "{}" }));
    expect(first.status).toBe(200);
    const second = await app.fetch(req("/follow-ups/FU1/cancel", { method: "POST", permissions: FU_MANAGE, body: "{}" }));
    expect(second.status).toBe(409);
  });
});

describe("follow-ups router — filters, chip counts and the KPI strip", () => {
  async function scenario() {
    const app = await newApp();
    await app.fetch(req("/follow-ups", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ ...followUpPayload, id: "F1", customerId: "A" }) }));
    await app.fetch(req("/follow-ups", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ ...followUpPayload, id: "F2", customerId: "A" }) }));
    await app.fetch(req("/follow-ups", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ ...followUpPayload, id: "F3", customerId: "B" }) }));
    await app.fetch(req("/follow-ups/F2/complete", { method: "POST", permissions: FU_MANAGE, body: JSON.stringify({ outcome: "done" }) }));
    await app.fetch(req("/follow-ups/F3/cancel", { method: "POST", permissions: FU_MANAGE, body: "{}" }));
    return app;
  }

  it("customerId filters the list, and one that matches nothing returns empty", async () => {
    const app = await scenario();
    const forA = await app.fetch(req("/follow-ups?customerId=A", { permissions: FU_VIEW }));
    expect(((await forA.json()) as FollowUpBody[]).map((r) => r.id).sort()).toEqual(["F1", "F2"]);

    const forNobody = await app.fetch(req("/follow-ups?customerId=NOBODY", { permissions: FU_VIEW }));
    expect((await forNobody.json()) as unknown[]).toEqual([]);
  });

  it("status filters the list", async () => {
    const app = await scenario();
    const pending = await app.fetch(req("/follow-ups?status=pending", { permissions: FU_VIEW }));
    expect(((await pending.json()) as FollowUpBody[]).map((r) => r.id)).toEqual(["F1"]);
  });

  it("/counts ignores status but still honours customerId, and reports every status bucket", async () => {
    const app = await scenario();
    const res = await app.fetch(req("/follow-ups/counts?status=pending&customerId=A", { permissions: FU_VIEW }));
    const body = (await res.json()) as Record<string, number>;
    expect(body.all).toBe(2);
    expect(body.pending).toBe(1);
    expect(body.completed).toBe(1);
    expect(body.cancelled).toBe(0);
  });

  it("/stats honours the status filter (unlike /counts) and counts rather than sums", async () => {
    const app = await scenario();
    const all = await app.fetch(req("/follow-ups/stats", { permissions: FU_VIEW }));
    const allBody = (await all.json()) as { count: number; pending: number; completed: number; cancelled: number };
    expect(allBody).toEqual({ count: 3, pending: 1, completed: 1, cancelled: 1 });

    const completedOnly = await app.fetch(req("/follow-ups/stats?status=completed", { permissions: FU_VIEW }));
    const completedBody = (await completedOnly.json()) as { count: number; pending: number; completed: number; cancelled: number };
    expect(completedBody).toEqual({ count: 1, pending: 0, completed: 1, cancelled: 0 });
  });
});

describe("installments plan router — تحصيل قسط (D119)", () => {
  const COLLECT = "installments.collect";

  async function collectingApp() {
    const deps = await buildDeps();
    const raised: Record<string, unknown>[] = [];
    const app = createInstallmentsRoutes(
      {
        ...deps,
        collect: async (input) => {
          raised.push({ ...input, amount: input.amount.toString() });
          return { voucherId: `VCH-${raised.length}` };
        },
      },
      insecureHeaderAuthContextResolver,
    );
    return { app, raised };
  }

  async function confirmedPlan(app: Awaited<ReturnType<typeof collectingApp>>["app"]): Promise<string> {
    const created = await app.fetch(
      req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }),
    );
    expect(created.status).toBe(201);
    const confirmed = await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE }));
    expect(confirmed.status).toBe(200);
    const body = (await confirmed.json()) as { document: PlanBody };
    return body.document.lines[0]?.amount ?? "0";
  }

  const collection = {
    installmentNo: 1,
    amount: "0",
    treasuryAccountId: "TRS-CASH",
    branchId: "BR1",
    paymentMethod: "cash" as const,
    date: "2026-09-01",
  };

  function collect(body: Record<string, unknown>, permissions = COLLECT) {
    return req("/plans/IP1/collect", { method: "POST", permissions, body: JSON.stringify(body) });
  }

  it("gates on installments.collect", async () => {
    const { app } = await collectingApp();
    const due = await confirmedPlan(app);
    const res = await app.fetch(collect({ ...collection, amount: due }, VIEW));
    expect(res.status).toBe(403);
  });

  it("raises a real customer-collection voucher and marks the installment paid", async () => {
    const { app, raised } = await collectingApp();
    const due = await confirmedPlan(app);
    const res = await app.fetch(collect({ ...collection, amount: due }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: PlanBody; voucherId: string; remaining: string };

    expect(body.voucherId).toBe("VCH-1");
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      invoiceId: "INV1",
      customerId: "CUST1",
      treasuryAccountId: "TRS-CASH",
      branchId: "BR1",
      paymentMethod: "cash",
    });

    const first = body.plan.lines.find((l) => l.no === 1);
    expect(first?.status).toBe("paid");
    expect(Number(first?.paidAmount)).toBeCloseTo(Number(due), 2);
  });

  it("persists the collection — a reload shows the installment still paid", async () => {
    const { app } = await collectingApp();
    const due = await confirmedPlan(app);
    await app.fetch(collect({ ...collection, amount: due }));

    const reloaded = (await (await app.fetch(req("/plans/IP1", { permissions: VIEW }))).json()) as PlanBody;
    expect(reloaded.lines.find((l) => l.no === 1)?.status).toBe("paid");
  });

  it("refuses more than the plan owes, and writes neither a voucher nor a paid line", async () => {
    const { app, raised } = await collectingApp();
    await confirmedPlan(app);
    const res = await app.fetch(collect({ ...collection, installmentNo: undefined, amount: "99999.00" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("INSTALLMENT_OVERPAYMENT");
    expect(raised).toHaveLength(0);

    const reloaded = (await (await app.fetch(req("/plans/IP1", { permissions: VIEW }))).json()) as PlanBody;
    expect(reloaded.lines.every((l) => l.status === "pending")).toBe(true);
  });

  it("refuses a collection against a draft plan", async () => {
    const { app } = await collectingApp();
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }));
    const res = await app.fetch(collect({ ...collection, amount: "100.00" }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("INSTALLMENT_PLAN_NOT_COLLECTABLE");
  });

  it("refuses rather than moving paidAmount when no treasury port is wired", async () => {
    const app = createInstallmentsRoutes(await buildDeps(), insecureHeaderAuthContextResolver);
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }));
    await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE }));
    const res = await app.fetch(collect({ ...collection, amount: "100.00" }));
    expect(res.status).toBe(503);

    const reloaded = (await (await app.fetch(req("/plans/IP1", { permissions: VIEW }))).json()) as PlanBody;
    expect(reloaded.lines.every((l) => Number(l.paidAmount) === 0)).toBe(true);
  });

  it("leaves the plan untouched when the treasury posting throws", async () => {
    const deps = await buildDeps();
    const app = createInstallmentsRoutes(
      {
        ...deps,
        collect: async () => {
          throw new Error("treasury down");
        },
      },
      insecureHeaderAuthContextResolver,
    );
    await app.fetch(req("/plans", { method: "POST", permissions: CREATE, body: JSON.stringify(planPayload) }));
    await app.fetch(req("/plans/IP1/confirm", { method: "POST", permissions: CREATE }));
    const failed = await app.fetch(collect({ ...collection, amount: "100.00" }));
    expect(failed.status).toBe(500);

    const reloaded = (await (await app.fetch(req("/plans/IP1", { permissions: VIEW }))).json()) as PlanBody;
    expect(reloaded.lines.every((l) => Number(l.paidAmount) === 0)).toBe(true);
  });

  it("reports what each installment still owes", async () => {
    const { app } = await collectingApp();
    const due = await confirmedPlan(app);
    await app.fetch(collect({ ...collection, amount: due }));

    const res = await app.fetch(req("/plans/IP1/outstanding", { permissions: VIEW }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { remaining: string; lines: { no: number; outstanding: string }[] };
    expect(Number(body.lines.find((l) => l.no === 1)?.outstanding)).toBe(0);
    expect(Number(body.remaining)).toBeCloseTo(10000 - Number(due), 2);
  });
});

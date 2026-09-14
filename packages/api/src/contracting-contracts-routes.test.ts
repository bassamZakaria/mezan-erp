import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { NextNumberService, type SequenceStore } from "@mezan/domain";
import {
  createSqliteWorksContractStore,
  type SqliteWorksContractStoreHandle,
} from "@mezan/persistence";
import {
  createContractingContractsRoutes,
  createVariationOrdersRoutes,
} from "./contracting-contracts-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

const handles: SqliteWorksContractStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const counters = new Map<string, number>();
const sequences: SequenceStore = {
  async increment(code) {
    const next = (counters.get(code) ?? 0) + 1;
    counters.set(code, next);
    return next;
  },
};

let contracts: ReturnType<typeof createContractingContractsRoutes>;
let variations: ReturnType<typeof createVariationOrdersRoutes>;

beforeEach(() => {
  counters.clear();
  const store = createSqliteWorksContractStore();
  handles.push(store);
  const deps = {
    store,
    numbering: new NextNumberService(sequences),
    projects: { findById: async (id: string) => (id === "PRJ-1" ? ({ id } as never) : null) },
    customers: { findById: async (id: string) => (id === "CUST-1" ? ({ id } as never) : null) },
  };
  contracts = createContractingContractsRoutes(deps, insecureHeaderAuthContextResolver);
  variations = createVariationOrdersRoutes(deps, insecureHeaderAuthContextResolver);
});

/** `Response.json()` answers `unknown`; every assertion below reads a known shape off it. */
async function readJson(res: Response): Promise<any> {
  return (await res.json()) as any;
}

function req(path: string, init: RequestInit & { permissions?: string; userId?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.userId !== undefined) headers.set("x-user-id", init.userId);
  headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const MANAGE = "contracting.boq.manage";
const VIEW = "contracting.boq.view";
const APPROVE = "contracting.variation.approve";

const contract = {
  id: "CTR-1",
  projectId: "PRJ-1",
  customerId: "CUST-1",
  titleAr: "عقد إنشاء برج",
  contractType: "private",
  signedDate: "2026-02-15",
  startDate: "2026-03-01",
  plannedEndDate: "2027-02-28",
  tenderDiscountPercent: "4.5",
};

const boq = {
  lines: [
    { id: "CTR-1-B1", code: "1", descriptionAr: "أعمال الحفر والردم", unit: "m3", qty: "12000", unitRate: "185.00" },
    { id: "CTR-1-B2", code: "2", descriptionAr: "الخرسانة العادية", unit: "m3", qty: "1450", unitRate: "1980.00" },
  ],
};

async function seedActive(permissions = MANAGE) {
  await contracts.fetch(req("/", { method: "POST", permissions, body: JSON.stringify(contract) }));
  await contracts.fetch(req("/CTR-1/boq", { method: "PUT", permissions, body: JSON.stringify(boq) }));
  await contracts.fetch(req("/CTR-1/activate", { method: "POST", permissions, body: JSON.stringify({ activatedAt: "2026-03-01" }) }));
}

describe("contracting contracts router — permission gate", () => {
  it("refuses a read with no permission", async () => {
    const res = await contracts.fetch(req("/"));
    expect(res.status).toBe(403);
    expect((await readJson(res)).permission).toBe(VIEW);
  });

  it("refuses a create with only the view permission", async () => {
    const res = await contracts.fetch(req("/", { method: "POST", permissions: VIEW, body: JSON.stringify(contract) }));
    expect(res.status).toBe(403);
  });

  it("refuses an approval with only the manage permission", async () => {
    await seedActive();
    const res = await variations.fetch(
      req("/VO-1/approve", { method: "POST", permissions: MANAGE, body: JSON.stringify({ approvedAt: "2026-08-02" }) }),
    );
    expect(res.status).toBe(403);
    expect((await readJson(res)).permission).toBe(APPROVE);
  });
});

describe("contracting contracts router — round trip", () => {
  it("creates a draft with a docNo off the sequence and the defaults filled in", async () => {
    const res = await contracts.fetch(req("/", { method: "POST", permissions: MANAGE, body: JSON.stringify(contract) }));
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.docNo).toBe("CTR-0001");
    expect(body.status).toBe("draft");
    expect(body.vatBasis).toBe("standard");
    expect(body.retentionPercent).toBe("5");
    expect(body.paymentTermDays).toBe(30);
    expect(body.contractValue).toBe("0.000000");
  });

  it("refuses a malformed percentage at the edge with a 400, never a 500", async () => {
    const res = await contracts.fetch(
      req("/", { method: "POST", permissions: MANAGE, body: JSON.stringify({ ...contract, retentionPercent: "abc" }) }),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error).toBe("VALIDATION_ERROR");
  });

  it("answers 404 for a contract that does not exist and 422 for an unknown project", async () => {
    expect((await contracts.fetch(req("/CTR-NOPE", { permissions: VIEW }))).status).toBe(404);
    const res = await contracts.fetch(
      req("/", { method: "POST", permissions: MANAGE, body: JSON.stringify({ ...contract, projectId: "PRJ-NOPE" }) }),
    );
    expect(res.status).toBe(422);
    expect((await readJson(res)).message).toContain("غير موجود");
  });

  it("stores the BOQ, derives each line value and the bill total", async () => {
    await contracts.fetch(req("/", { method: "POST", permissions: MANAGE, body: JSON.stringify(contract) }));
    const res = await contracts.fetch(req("/CTR-1/boq", { method: "PUT", permissions: MANAGE, body: JSON.stringify(boq) }));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.total).toBe("5091000.000000");
    expect(body.lines[0].lineValue).toBe("2220000.000000");
    expect(body.lines[0].unitLabelAr).toBe("م٣");
  });

  it("refuses to change the BOQ of an active contract with a 409 in Arabic", async () => {
    await seedActive();
    const res = await contracts.fetch(req("/CTR-1/boq", { method: "PUT", permissions: MANAGE, body: JSON.stringify(boq) }));
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.error).toBe("CONTRACT_NOT_DRAFT");
    expect(body.message).toContain("أمر تغيير");
  });

  it("reviews an import without persisting it, then commits only the accepted rows", async () => {
    await contracts.fetch(req("/", { method: "POST", permissions: MANAGE, body: JSON.stringify(contract) }));
    await contracts.fetch(req("/CTR-1/boq", { method: "PUT", permissions: MANAGE, body: JSON.stringify(boq) }));
    const rows = {
      rows: [
        { code: "1", descriptionAr: "حفر مكرر", unit: "م٣", qty: "10", unitRate: "5" },
        { code: "9", descriptionAr: "أعمال العزل", unit: "فدان", qty: "10", unitRate: "5" },
        { code: "10", descriptionAr: "أعمال الدهانات", unit: "م٢", qty: "500", unitRate: "40" },
      ],
    };
    const review = await readJson(
      await contracts.fetch(req("/CTR-1/boq/import", { method: "POST", permissions: MANAGE, body: JSON.stringify(rows) })),
    );
    expect(review.acceptedCount).toBe(1);
    expect(review.rows[0].problems[0]).toContain("مكرر");
    expect(review.rows[1].problems[0]).toContain("وحدة غير معروفة");
    // A review persists nothing.
    expect((await readJson(await contracts.fetch(req("/CTR-1/boq", { permissions: VIEW })))).lines).toHaveLength(2);

    const committed = await readJson(
      await contracts.fetch(req("/CTR-1/boq/import/commit", { method: "POST", permissions: MANAGE, body: JSON.stringify(rows) })),
    );
    expect(committed.lines).toHaveLength(3);
    expect(committed.review.rejectedCount).toBe(2);
  });

  it("walks the lifecycle and refuses an illegal move", async () => {
    await seedActive();
    const completed = await contracts.fetch(
      req("/CTR-1/complete", { method: "POST", permissions: MANAGE, body: JSON.stringify({ completedAt: "2026-12-31" }) }),
    );
    expect(completed.status).toBe(200);
    const again = await contracts.fetch(
      req("/CTR-1/activate", { method: "POST", permissions: MANAGE, body: JSON.stringify({ activatedAt: "2027-01-01" }) }),
    );
    expect(again.status).toBe(409);
    expect((await readJson(again)).error).toBe("INVALID_CONTRACT_TRANSITION");
  });
});

describe("variation orders router", () => {
  const order = {
    id: "VO-1",
    contractId: "CTR-1",
    date: "2026-07-21",
    titleAr: "زيادة كميات الحفر",
    reason: "منسوب التأسيس",
    requestedBy: "consultant",
    lines: [{ kind: "change", boqLineId: "CTR-1-B1", qtyDelta: "600" }],
  };

  it("creates, approves and moves the contract value forward only", async () => {
    await seedActive();
    const created = await variations.fetch(req("/", { method: "POST", permissions: MANAGE, userId: "u1", body: JSON.stringify(order) }));
    expect(created.status).toBe(201);
    const createdBody = await readJson(created);
    expect(createdBody.docNo).toBe("VO-0001");
    expect(createdBody.netValue).toBe("111000.000000");
    expect(createdBody.contractDocNo).toBe("CTR-0001");

    // Draft: the contract value has not moved.
    expect((await readJson(await contracts.fetch(req("/CTR-1", { permissions: VIEW })))).contractValueAfterVariations).toBe(
      "5091000.000000",
    );

    const approved = await variations.fetch(
      req("/VO-1/approve", { method: "POST", permissions: APPROVE, userId: "u2", body: JSON.stringify({ approvedAt: "2026-08-02" }) }),
    );
    expect(approved.status).toBe(200);
    expect((await readJson(approved)).status).toBe("approved");
    expect((await readJson(await contracts.fetch(req("/CTR-1", { permissions: VIEW })))).contractValueAfterVariations).toBe(
      "5202000.000000",
    );
  });

  it("refuses the approval when the approver is the preparer", async () => {
    await seedActive();
    await variations.fetch(req("/", { method: "POST", permissions: MANAGE, userId: "u1", body: JSON.stringify(order) }));
    const res = await variations.fetch(
      req("/VO-1/approve", { method: "POST", permissions: APPROVE, userId: "u1", body: JSON.stringify({ approvedAt: "2026-08-02" }) }),
    );
    expect(res.status).toBe(403);
    expect((await readJson(res)).error).toBe("SELF_APPROVAL_REFUSED");
  });

  it("excludes a late-approved variation from the quantity contracted on the execution date", async () => {
    await seedActive();
    await variations.fetch(req("/", { method: "POST", permissions: MANAGE, userId: "u1", body: JSON.stringify(order) }));
    await variations.fetch(
      req("/VO-1/approve", { method: "POST", permissions: APPROVE, userId: "u2", body: JSON.stringify({ approvedAt: "2026-08-02" }) }),
    );
    const before = await readJson(
      await contracts.fetch(req("/CTR-1/boq/contracted-qty?asOfDate=2026-07-01", { permissions: VIEW })),
    );
    expect(before.rows[0].contractedQty).toBe("12000.000000");
    const after = await readJson(
      await contracts.fetch(req("/CTR-1/boq/contracted-qty?asOfDate=2026-08-02", { permissions: VIEW })),
    );
    expect(after.rows[0].contractedQty).toBe("12600.000000");
    expect(after.rows[0].adjustmentQty).toBe("600.000000");
  });

  it("filters the list by contract and status", async () => {
    await seedActive();
    await variations.fetch(req("/", { method: "POST", permissions: MANAGE, userId: "u1", body: JSON.stringify(order) }));
    const drafts = await readJson(await variations.fetch(req("/?contractId=CTR-1&status=draft", { permissions: VIEW })));
    expect(drafts).toHaveLength(1);
    const approved = await readJson(await variations.fetch(req("/?status=approved", { permissions: VIEW })));
    expect(approved).toHaveLength(0);
  });
});

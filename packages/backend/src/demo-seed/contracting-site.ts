import type { App } from "@mezan/api";
import { step, stepIfMounted, seedActorHeaders, BRANCH_ID, WAREHOUSE_ID, CORE } from "./shared.js";

/**
 * مستودعات المواقع — slice 4A of المقاولات
 * (docs/artifacts/mezan-contracting-designs.html D-11).
 *
 * The point of the profile is the SHORTFALL: 30 units leave the main store, 24
 * are signed for on site by someone other than the person who issued them, and
 * 6 stand in the branch transit store where the exception report can see them.
 * A tenant where every issue arrived proves nothing about the control.
 */

const TOWER = "PRJ-DEMO-1";
const SITE_WAREHOUSE_ID = "WH-SITE-TOWER";
const PLANT_ASSET_ID = "ASSET-DEMO-PLANT-1";
const PLANT_CATEGORY_ID = "ASSET-CAT-DEMO-1";
const TENANT_DOMAIN = "cyag.example";

interface SeededUser {
  readonly id: string;
  readonly email: string;
}

/** Two DIFFERENT people, because the whole document pair turns on their being different. */
const STOREKEEPER_EMAIL = `sayed.gamal@${TENANT_DOMAIN}`;
const SITE_SUPERVISOR_EMAIL = `omar.hilal@${TENANT_DOMAIN}`;

const TRANSFER_PERMISSIONS = ["inventory.transfer.view", "inventory.transfer.create", "inventory.transfer.confirm"];

async function actorStep(
  app: App,
  headers: Record<string, string> | Promise<Record<string, string>>,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers: await headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

interface SeededContract {
  readonly id: string;
  readonly projectId: string;
}

interface SeededBoqLine {
  readonly id: string;
  readonly costCategory: string | null;
}

/**
 * The BOQ line a document is measured against belongs to slice 1's contract.
 * Resolved by lookup rather than by a hard-coded id so this profile does not
 * break the moment that seed renumbers its lines — and degraded to null when
 * the contracts route is not mounted at all.
 */
async function boqLineFor(app: App, costCategory: string): Promise<string | null> {
  const contracts = (await stepIfMounted(app, "GET", "/contracting/contracts")) as SeededContract[] | undefined;
  const contract = contracts?.find((c) => c.projectId === TOWER);
  if (!contract) return null;
  const boq = (await stepIfMounted(app, "GET", `/contracting/contracts/${contract.id}/boq`)) as
    | { lines: SeededBoqLine[] }
    | undefined;
  return boq?.lines.find((line) => line.costCategory === costCategory)?.id ?? boq?.lines[0]?.id ?? null;
}

function findUser(users: readonly SeededUser[], email: string): SeededUser {
  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`[demo-seed] contracting-site expected a seeded user "${email}"`);
  return user;
}

export async function seedContractingSite(app: App): Promise<void> {
  const users = (await step(app, "GET", "/users")) as SeededUser[];
  const storekeeper = findUser(users, STOREKEEPER_EMAIL);
  const supervisor = findUser(users, SITE_SUPERVISOR_EMAIL);

  // --- مستودع الموقع ---
  await step(app, "POST", "/warehouses", {
    id: SITE_WAREHOUSE_ID,
    code: "WH-SITE-TOWER",
    name: "مستودع موقع برج الأمل",
    nameEn: "Tower Site Store",
    branchId: BRANCH_ID,
    type: "SITE",
    projectId: TOWER,
    custodianUserId: storekeeper.id,
  });

  // --- تحويل إلى مستودع الموقع: valuation-neutral, no posting (D-11) ---
  // INVARIANT: CORE.items[1], not items[0] — see the note in contracting.ts.
  await step(app, "POST", "/inventory/stock-transfers/draft", {
    id: "XFER-DEMO-SITE-1",
    date: "2026-08-21",
    memo: "تحويل مواد إلى مستودع موقع برج الأمل",
    lines: [
      { itemId: CORE.items[1], fromWarehouseId: WAREHOUSE_ID, toWarehouseId: SITE_WAREHOUSE_ID, qty: "40" },
    ],
  });
  await step(app, "POST", "/inventory/stock-transfers/XFER-DEMO-SITE-1/confirm", {});

  // --- إذن الصرف والاستلام بالموقع, by two different people ---
  const issuerHeaders = await seedActorHeaders(storekeeper.id, TRANSFER_PERMISSIONS, "WAREHOUSE_KEEPER");
  const receiverHeaders = await seedActorHeaders(supervisor.id, TRANSFER_PERMISSIONS, "SUPERVISOR");

  await actorStep(app, issuerHeaders, "POST", "/contracting/site/issues", {
    id: "ISS-DEMO-1",
    date: "2026-08-23",
    fromWarehouseId: WAREHOUSE_ID,
    toWarehouseId: SITE_WAREHOUSE_ID,
    notes: "أسمنت للموقع — عهدة أمين المستودع",
    lines: [{ itemId: CORE.items[2], qty: "30" }],
  });
  await actorStep(app, issuerHeaders, "POST", "/contracting/site/issues/ISS-DEMO-1/confirm", {});

  await actorStep(app, receiverHeaders, "POST", "/contracting/site/receipts", {
    id: "SRC-DEMO-1",
    issueId: "ISS-DEMO-1",
    date: "2026-08-24",
    notes: "وصل 24 فقط — 6 ما زالت بالطريق",
    lines: [{ itemId: CORE.items[2], qtyReceived: "24" }],
  });
  await actorStep(app, receiverHeaders, "POST", "/contracting/site/receipts/SRC-DEMO-1/confirm", {});

  // --- استهلاك مواد: the only stock → project-cost conversion (Dr 1230 / Cr 1200) ---
  await step(app, "POST", "/contracting/site/consumptions", {
    id: "CON-DEMO-1",
    date: "2026-08-26",
    warehouseId: SITE_WAREHOUSE_ID,
    boqLineId: await boqLineFor(app, "materials"),
    notes: "صرف مواد لأعمال الأساسات",
    lines: [{ itemId: CORE.items[1], qty: "25" }],
  });
  await step(app, "POST", "/contracting/site/consumptions/CON-DEMO-1/confirm", {});

  // --- عهدة الشدة والسقالات: a register, no valuation and no posting ---
  await step(app, "POST", "/contracting/site/custody", {
    id: "CUST-DEMO-1",
    warehouseId: SITE_WAREHOUSE_ID,
    descriptionAr: "شدة معدنية — ألواح وقوائم",
    qtyOut: "120",
    issuedDate: "2026-08-21",
    expectedReturnDate: "2026-11-30",
    notes: "تُرد بعد فك الشدة للدور الثاني",
  });
  await step(app, "POST", "/contracting/site/custody/CUST-DEMO-1/return", { qty: "40", date: "2026-09-05" });

  // --- تشغيل المعدات: Dr 1230 (equipment) / Cr 5160 ---
  await step(app, "POST", "/assets", {
    id: PLANT_ASSET_ID,
    code: "AST-0101",
    nameAr: "خلاطة خرسانة مركزية",
    nameEn: "Central Concrete Mixer",
    categoryId: PLANT_CATEGORY_ID,
    scope: "branch",
    branchId: BRANCH_ID,
    warehouseId: null,
    acquisitionDate: "2025-02-01",
    acquisitionCost: "900000",
    projectId: TOWER,
    internalHourlyRate: "450",
  });
  // The rate as a DATED series, so every log below prices at the rate in force
  // on its own date rather than at whatever the register last happened to hold.
  await step(app, "PATCH", `/assets/${PLANT_ASSET_ID}/internal-hourly-rate`, {
    hourlyRate: "450",
    effectiveFrom: "2026-01-01",
    reason: "سعر الساعة المعتمد لسنة ٢٠٢٦",
  });
  await step(app, "POST", "/contracting/site/equipment-logs", {
    id: "EQL-DEMO-1",
    projectId: TOWER,
    assetId: PLANT_ASSET_ID,
    date: "2026-08-27",
    hours: "62",
    boqLineId: await boqLineFor(app, "equipment"),
    notes: "صب خرسانة الأساسات",
  });
  await step(app, "POST", "/contracting/site/equipment-logs/EQL-DEMO-1/confirm", {});

  /**
   * ساعات معدات بلا بند — the hours nobody allocated, which «ساعات معدات بلا
   * مستخلص مقابل» exists to find.
   *
   * INVARIANT: it is seeded HERE, before `seedContractingRecognition`, not with
   * the controls profile that reads it. Confirmed after the July run, its
   * 2026-07-20 debit lands dated inside a month already closed, so no run ever
   * relieves it and 18,000 sits in 1230 for the life of the contract while
   * every posted run still reports a closing balance of zero.
   */
  await step(app, "POST", "/contracting/site/equipment-logs", {
    id: "EQL-DEMO-2",
    projectId: TOWER,
    assetId: PLANT_ASSET_ID,
    date: "2026-07-20",
    hours: "40",
    boqLineId: null,
    notes: "ساعات تشغيل بالموقع لم تُنسب إلى بند — تحتاج مراجعة المكتب الفني.",
  });
  await step(app, "POST", "/contracting/site/equipment-logs/EQL-DEMO-2/confirm", {});
}

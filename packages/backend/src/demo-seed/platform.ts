import type { App } from "@mezan/api";
import { CORE, VAT_PERCENT, WAREHOUSE_ID, seedActorHeaders, step } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Platform administration: notification rules, notifications, and workflow
 * configs/requests.
 *
 * A notification rule may only subscribe to an event this build actually
 * emits — `GET /notification-rules/triggers` reports that live set, so it is
 * read here rather than assumed.
 *
 * `/eta/submissions` is deliberately NOT seeded here: this build has no HTTP
 * route that enqueues an ETA submission (`EtaService.enqueue` is never wired
 * to a confirm flow or exposed as a route — see `eta-routes.ts`), so there is
 * no user click this module could replay to populate it.
 */

interface ActorOptions {
  readonly userId: string;
  readonly permissions?: string;
  readonly roles?: string;
}

function actorHeaders({ userId, permissions = "", roles = "" }: ActorOptions): Record<string, string> {
  const codes = permissions.split(",").map((s) => s.trim()).filter(Boolean);
  const role = roles.split(",").map((s) => s.trim()).filter(Boolean)[0] ?? null;
  return seedActorHeaders(userId, codes, role);
}

/**
 * Like `shared.ts`'s `step`, but as a NAMED, non-admin actor. The workflow
 * gate's admin bypass triggers on `x-permissions: "*"` alone (see
 * `domain/workflow/gate.ts`'s `hasAdminRole`), so `shared.step`'s
 * ADMIN_HEADERS would auto-approve every submitted request on the spot —
 * useless for seeding a request that must stay pending, or one a specific
 * approver rejects. This simulates the OTHER users whose clicks those are.
 */
async function stepAs(app: App, method: string, path: string, actor: ActorOptions, body?: unknown): Promise<unknown> {
  const res = await app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers: actorHeaders(actor),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} as ${actor.userId} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

/**
 * `shared.step`'s ADMIN_HEADERS attributes writes to "SEED-ADMIN", a synthetic
 * seeder identity — fine for most modules, but the writes below are
 * audited (`recordSensitiveEvent`) and `/profile/activity` shows only the
 * CALLING user's own trail. Attributing these to the real bootstrapped tenant
 * admin (USER-ADMIN — see `backend/src/seed.ts`) is both more realistic and
 * the only way that admin's own activity feed has anything in it.
 */
const PLATFORM_ADMIN: ActorOptions = { userId: "USER-ADMIN", permissions: "*" };

interface EventTrigger {
  readonly code: string;
  readonly emitted: boolean;
}


export async function seedPlatform(app: App): Promise<void> {
  // --- إعدادات الموافقات (workflow configs) — chains a later request can reference. ---
  await step(app, "POST", "/workflow/configs", {
    actionType: "SALES_INVOICE_CONFIRM",
    steps: [{ role: "SUPERVISOR", description: "مراجعة المشرف قبل تأكيد الفاتورة" }],
  });
  await step(app, "POST", "/workflow/configs", {
    actionType: "PURCHASE_INVOICE_CONFIRM",
    steps: [{ role: "FINANCE_MANAGER", description: "اعتماد المدير المالي قبل تأكيد فاتورة المشتريات" }],
  });

  // --- الموافقات — the approvals inbox: one pending, one approved, one rejected. ---
  await stepAs(
    app,
    "POST",
    "/workflow/requests",
    { userId: "USER-SALES-REP-1", permissions: "sales.invoice.create" },
    {
      requestId: "APR-DEMO-1",
      actionType: "SALES_INVOICE_CONFIRM",
      entityLabel: "فاتورة مبيعات بقيمة 5,200 ج.م — مجموعة الفجر التجارية",
    },
  );

  await stepAs(
    app,
    "POST",
    "/workflow/requests",
    { userId: "USER-PURCHASING-1", permissions: "purchases.invoice.create" },
    {
      requestId: "APR-DEMO-2",
      actionType: "PURCHASE_INVOICE_CONFIRM",
      entityLabel: "فاتورة مشتريات من مصنع الوادي الأخضر بقيمة 32,000 ج.م",
    },
  );
  await stepAs(
    app,
    "POST",
    "/workflow/requests/APR-DEMO-2/decide",
    { userId: "USER-FINANCE-MGR", permissions: "workflow.approve", roles: "FINANCE_MANAGER" },
    { decision: "approve", comment: "المستندات مكتملة والمبلغ ضمن حدود الميزانية." },
  );

  await stepAs(
    app,
    "POST",
    "/workflow/requests",
    { userId: "USER-SALES-REP-2", permissions: "sales.invoice.create" },
    {
      requestId: "APR-DEMO-3",
      actionType: "SALES_INVOICE_CONFIRM",
      entityLabel: "فاتورة مبيعات بقيمة 18,500 ج.م — شركة الأمل للتجارة",
    },
  );
  await stepAs(
    app,
    "POST",
    "/workflow/requests/APR-DEMO-3/decide",
    { userId: "USER-SUPERVISOR-1", permissions: "workflow.reject", roles: "SUPERVISOR" },
    { decision: "reject", comment: "تم الرفض: تجاوز الفاتورة الحد الائتماني المسموح للعميل." },
  );

  // --- قواعد الإشعارات — only subscribe to what this build really emits. ---
  const triggerCatalog = (await step(app, "GET", "/notification-rules/triggers")) as {
    triggers: readonly EventTrigger[];
  };
  const emittedEvents = new Set(triggerCatalog.triggers.filter((t) => t.emitted).map((t) => t.code));

  function requireEmitted(code: string): string {
    if (!emittedEvents.has(code)) {
      throw new Error(`[demo-seed] platform: "${code}" is not in this build's emitted event set`);
    }
    return code;
  }

  await step(app, "POST", "/notification-rules", {
    id: "NR-DEMO-1",
    name: "تنبيه تأكيد فاتورة مبيعات",
    eventCode: requireEmitted("SALES_INVOICE_CONFIRMED"),
    recipientType: "permission",
    recipientValue: "sales.invoice.view",
    priority: "normal",
    channels: ["in_app"],
    titleAr: "تم تأكيد فاتورة مبيعات",
    bodyAr: "تم تأكيد فاتورة مبيعات بقيمة {{amount}} ج.م للعميل {{customerName}}.",
    active: true,
  });
  await step(app, "POST", "/notification-rules", {
    id: "NR-DEMO-2",
    name: "تنبيه مرتجع مبيعات",
    eventCode: requireEmitted("SALES_RETURN_CONFIRMED"),
    recipientType: "user",
    recipientValue: "USER-ADMIN",
    priority: "high",
    channels: ["in_app", "email"],
    titleAr: "تم تسجيل مرتجع مبيعات",
    bodyAr: "تم تأكيد مرتجع مبيعات على المستند {{documentNumber}}.",
    active: true,
  });
  await step(app, "POST", "/notification-rules", {
    id: "NR-DEMO-3",
    name: "تنبيه مرتجع مشتريات",
    eventCode: requireEmitted("PURCHASE_RETURN_CONFIRMED"),
    recipientType: "permission",
    recipientValue: "purchases.return.view",
    priority: "urgent",
    channels: ["in_app"],
    titleAr: "تم تسجيل مرتجع مشتريات",
    bodyAr: "تم تأكيد مرتجع مشتريات على المستند {{documentNumber}}.",
    active: true,
  });
  await step(app, "POST", "/notification-rules", {
    id: "NR-DEMO-4",
    name: "تنبيه إلغاء مرتجع مشتريات",
    eventCode: requireEmitted("PURCHASE_RETURN_VOIDED"),
    recipientType: "role",
    recipientValue: "ROLE-ADMIN",
    priority: "low",
    channels: ["push"],
    active: true,
  });
  await step(app, "POST", "/notification-rules/NR-DEMO-4/deactivate", {});

  // --- Real events, fired through the SAME document routes a return-desk
  // click hits, so the rules just seeded have something to react to
  // and /notifications ends up with real, engine-generated rows. ---
  await step(app, "POST", "/sales-returns", {
    id: "SRET-DEMO-1",
    date: "2026-08-22",
    memo: "مرتجع صنف تالف — فاتورة INV-DEMO-1",
    lines: [
      {
        itemId: CORE.items[2],
        warehouseId: WAREHOUSE_ID,
        customerId: CORE.customers[0],
        sourceInvoiceId: CORE.salesInvoices[0],
        sourceInvoiceNumber: null,
        reason: "DEFECTIVE",
        availableQty: "120",
        qty: "5",
        unitPrice: "42",
        unitCost: "31",
        taxAmount: (5 * 42 * (VAT_PERCENT / 100)).toFixed(2),
      },
    ],
  });
  await step(app, "POST", "/sales-returns/SRET-DEMO-1/confirm", {});

  await step(app, "POST", "/purchase-returns", {
    id: "PRET-DEMO-1",
    date: "2026-08-22",
    memo: "مرتجع بضاعة تالفة — فاتورة PI-DEMO-1",
    lines: [
      {
        itemId: CORE.items[0],
        warehouseId: WAREHOUSE_ID,
        supplierId: CORE.suppliers[0],
        sourceInvoiceId: CORE.purchaseInvoices[0],
        sourceInvoiceNumber: null,
        reason: "DEFECTIVE",
        availableQty: "200",
        qty: "10",
        unitCost: "140",
        taxAmount: (10 * 140 * (VAT_PERCENT / 100)).toFixed(2),
      },
    ],
  });
  await step(app, "POST", "/purchase-returns/PRET-DEMO-1/confirm", {});

  await step(app, "POST", "/purchase-returns", {
    id: "PRET-DEMO-2",
    date: "2026-08-22",
    memo: "صنف خاطئ — فاتورة PI-DEMO-2 (ملغى قبل التأكيد)",
    lines: [
      {
        itemId: CORE.items[1],
        warehouseId: WAREHOUSE_ID,
        supplierId: CORE.suppliers[1],
        sourceInvoiceId: CORE.purchaseInvoices[1],
        sourceInvoiceNumber: null,
        reason: "WRONG_ITEM",
        availableQty: "300",
        qty: "15",
        unitCost: "72",
        taxAmount: (15 * 72 * (VAT_PERCENT / 100)).toFixed(2),
      },
    ],
  });
  await step(app, "POST", "/purchase-returns/PRET-DEMO-2/cancel", {});

  // A second مرتجع مبيعات (different customer, different invoice) — the
  // notification centre needs more than one row to prove its tabs and
  // "تحديد الكل كمقروء" actually do something, not just render an empty list.
  await step(app, "POST", "/sales-returns", {
    id: "SRET-DEMO-2",
    date: "2026-08-23",
    memo: "مرتجع كمية زائدة — فاتورة INV-DEMO-2",
    lines: [
      {
        itemId: CORE.items[1],
        warehouseId: WAREHOUSE_ID,
        customerId: CORE.customers[1],
        sourceInvoiceId: CORE.salesInvoices[1],
        sourceInvoiceNumber: null,
        reason: "EXCESS_QTY",
        availableQty: "90",
        qty: "8",
        unitPrice: "95",
        unitCost: "72",
        taxAmount: (8 * 95 * (VAT_PERCENT / 100)).toFixed(2),
      },
    ],
  });
  await step(app, "POST", "/sales-returns/SRET-DEMO-2/confirm", {});

  // Marks the FIRST return's notification read through the real endpoint, as
  // USER-ADMIN — its own recipient. The bell panel then opens onto a mix of
  // read and unread rows rather than a stack that all looks the same, and
  // "تحديد الكل كمقروء" (R1.6) has at least one still-unread row to prove it
  // clears.
  const adminNotifications = (await stepAs(app, "GET", "/notifications", PLATFORM_ADMIN)) as Array<{
    id: string;
    eventCode: string;
  }>;
  // `/notifications` orders newest first, so the LAST match here is SRET-DEMO-1's row.
  const returnNotifications = adminNotifications.filter((n) => n.eventCode === "SALES_RETURN_CONFIRMED");
  const firstReturnNotification = returnNotifications[returnNotifications.length - 1];
  if (firstReturnNotification) {
    await stepAs(app, "POST", `/notifications/${firstReturnNotification.id}/read`, PLATFORM_ADMIN, {});
  }

  await seedPreferences(app);
}

/**
 * الوضع الشخصي — one real per-user layout for USER-ADMIN, written through
 * `PUT /preferences` as that user, so the shell opens onto pins, recents,
 * shortcut tiles and a customised invoice table instead of an empty default.
 * A user who has never customised anything is a valid state, but it proves
 * nothing: an unpinned rail cannot show that pins survive a device change.
 *
 * Every `entityId` below is a real seeded document id (see `./shared.ts`'s
 * CORE) and every `route` is a real hash route from `apps/web/src/nav-config.tsx`.
 */
async function seedPreferences(app: App): Promise<void> {
  const pinnedAt = "2026-08-20T08:15:00.000Z";
  await stepAs(app, "PUT", "/preferences", PLATFORM_ADMIN, {
    layoutName: "تخطيط محمد — المبيعات والخزينة",
    numerals: "arabic",
    railCollapsed: false,
    pinnedScreens: [
      { id: "PIN-SALES-INVOICES", route: "#/sell/sales-invoices", labelAr: "فواتير المبيعات", labelEn: "Sales invoices", icon: "receipt", group: "sell", order: 0, pinnedAt },
      { id: "PIN-CUSTOMERS", route: "#/sell/customers", labelAr: "العملاء", labelEn: "Customers", icon: "users", group: "sell", order: 1, pinnedAt },
      { id: "PIN-VOUCHERS", route: "#/money/treasury-vouchers", labelAr: "سندات الخزينة", labelEn: "Treasury vouchers", icon: "wallet", group: "money", order: 2, pinnedAt },
      { id: "PIN-STOCK-BALANCE", route: "#/stock/stock-balance", labelAr: "أرصدة المخزون", labelEn: "Stock balance", icon: "boxes", group: "stock", order: 3, pinnedAt },
    ],
    recentRecords: [
      { id: "RCNT-1", route: `#/sell/sales-invoices/${CORE.salesInvoices[0]}`, entityType: "SALES_INVOICE", entityId: CORE.salesInvoices[0], labelAr: "فاتورة مبيعات — شركة الأمل للتجارة", labelEn: "Sales invoice — Al Amal Trading", documentNumber: null, icon: "receipt", branchId: "BR-MAIN", openedAt: "2026-08-26T09:05:00.000Z" },
      { id: "RCNT-2", route: `#/buy/purchase-invoices/${CORE.purchaseInvoices[0]}`, entityType: "PURCHASE_INVOICE", entityId: CORE.purchaseInvoices[0], labelAr: "فاتورة مشتريات", labelEn: "Purchase invoice", documentNumber: null, icon: "truck", branchId: "BR-MAIN", openedAt: "2026-08-26T08:40:00.000Z" },
      { id: "RCNT-3", route: `#/sell/customers/${CORE.customers[1]}`, entityType: "CUSTOMER", entityId: CORE.customers[1], labelAr: "مجموعة الفجر التجارية", labelEn: "Al Fajr Group", documentNumber: null, icon: "users", branchId: null, openedAt: "2026-08-25T13:20:00.000Z" },
    ],
    dashboard: {
      columns: 3,
      widgets: [
        { id: "WGT-RECEIVABLES", kind: "receivables", column: 0, order: 0, size: "md", visible: true, settings: { range: "month" } },
        { id: "WGT-CASH", kind: "cash-position", column: 1, order: 0, size: "md", visible: true, settings: {} },
        { id: "WGT-SALES-TREND", kind: "sales-trend", column: 2, order: 0, size: "lg", visible: true, settings: { range: "quarter" } },
        { id: "WGT-LOW-STOCK", kind: "low-stock", column: 0, order: 1, size: "sm", visible: false, settings: {} },
      ],
    },
    shortcutTiles: [
      { id: "TILE-NEW-INVOICE", route: "#/sell/sales-invoices/new", labelAr: "فاتورة مبيعات جديدة", labelEn: "New sales invoice", icon: "plus", tone: "primary", order: 0 },
      { id: "TILE-COLLECT", route: "#/money/treasury-vouchers/new", labelAr: "تحصيل نقدي", labelEn: "Collect cash", icon: "wallet", tone: "accent", order: 1 },
      { id: "TILE-STOCK", route: "#/stock/stock-balance", labelAr: "أرصدة المخزون", labelEn: "Stock balance", icon: "boxes", tone: null, order: 2 },
    ],
    tableViews: [
      {
        tableId: "sales-invoices",
        columns: [
          { key: "number", visible: true, order: 0, widthPx: 120, pinned: "start" },
          { key: "date", visible: true, order: 1, widthPx: null, pinned: null },
          { key: "customer", visible: true, order: 2, widthPx: 220, pinned: null },
          { key: "total", visible: true, order: 3, widthPx: null, pinned: null },
          { key: "status", visible: true, order: 4, widthPx: null, pinned: "end" },
          { key: "salesperson", visible: false, order: 5, widthPx: null, pinned: null },
        ],
        sortKey: "date",
        sortDirection: "desc",
        pageSize: 50,
        density: "compact",
      },
    ],
  });
}

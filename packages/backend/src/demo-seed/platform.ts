import type { App } from "@mezan/api";
import { step, WAREHOUSE_ID, CORE, VAT_PERCENT } from "./shared.js";

/**
 * Seed profile module — see `./shared.ts`. Local and test environments only.
 *
 * Platform administration: API keys, webhooks, notification rules,
 * notifications, and workflow configs/requests.
 *
 * Webhooks and notification rules may only subscribe to events this build
 * actually emits — `GET /webhooks/events` and `GET /notification-rules/triggers`
 * report that live set, so both are read here rather than assumed.
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
  return {
    "content-type": "application/json",
    "x-user-id": userId,
    "x-permissions": permissions,
    "x-role-codes": roles,
    "x-branch-scope": "*",
    "x-warehouse-scope": "*",
  };
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
 * seeder identity — fine for most modules, but api-key/webhook writes are
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

interface WebhookEvent {
  readonly code: string;
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

  // --- مفاتيح API — one revoked, so the list shows both live and dead keys. ---
  await stepAs(app, "POST", "/api-keys", PLATFORM_ADMIN, {
    name: "تكامل المتجر الإلكتروني",
    scopes: ["sales.invoice.view", "sales.invoice.create"],
  });
  await stepAs(app, "POST", "/api-keys", PLATFORM_ADMIN, {
    name: "لوحة التقارير المالية الخارجية",
    scopes: ["accounting.coa.view", "accounting.journal.view"],
  });
  const legacyKey = (await stepAs(app, "POST", "/api-keys", PLATFORM_ADMIN, {
    name: "مفتاح تكامل قديم",
    scopes: ["inventory.item.view"],
  })) as { id: string };
  await stepAs(app, "POST", `/api-keys/${legacyKey.id}/revoke`, PLATFORM_ADMIN, {});

  // --- الويب هوك + قواعد الإشعارات — only subscribe to what this build really emits. ---
  const webhookEvents = (await step(app, "GET", "/webhooks/events")) as { events: readonly WebhookEvent[] };
  const deliverableEvents = new Set(webhookEvents.events.map((e) => e.code));

  const triggerCatalog = (await step(app, "GET", "/notification-rules/triggers")) as {
    triggers: readonly EventTrigger[];
  };
  const emittedEvents = new Set(triggerCatalog.triggers.filter((t) => t.emitted).map((t) => t.code));

  function requireDeliverable(code: string): string {
    if (!deliverableEvents.has(code)) {
      throw new Error(`[demo-seed] platform: "${code}" is not in this build's deliverable webhook events`);
    }
    return code;
  }
  function requireEmitted(code: string): string {
    if (!emittedEvents.has(code)) {
      throw new Error(`[demo-seed] platform: "${code}" is not in this build's emitted event set`);
    }
    return code;
  }

  // Loopback and unbound — nothing is listening, so every real delivery
  // attempt fails locally and nothing leaves the machine.
  const webhookSales = (await stepAs(app, "POST", "/webhooks", PLATFORM_ADMIN, {
    name: "تكامل نظام نقطة البيع الخارجي",
    targetUrl: "http://127.0.0.1:39217/hooks/mezan",
    events: [
      requireDeliverable("SALES_INVOICE_CONFIRMED"),
      requireDeliverable("SALES_INVOICE_VOIDED"),
      requireDeliverable("SALES_RETURN_CONFIRMED"),
    ],
  })) as { id: string };

  const webhookLegacy = (await stepAs(app, "POST", "/webhooks", PLATFORM_ADMIN, {
    name: "تكامل النظام المحاسبي القديم",
    targetUrl: "http://127.0.0.1:39218/legacy/receiver",
    events: [requireDeliverable("PURCHASE_RETURN_CONFIRMED"), requireDeliverable("PURCHASE_RETURN_VOIDED")],
  })) as { id: string };
  await stepAs(app, "PATCH", `/webhooks/${webhookLegacy.id}`, PLATFORM_ADMIN, { active: false });

  await step(app, "POST", `/webhooks/${webhookSales.id}/deliveries`, {
    eventCode: "SALES_INVOICE_CONFIRMED",
    statusCode: 200,
    success: true,
    errorMessage: null,
  });
  await step(app, "POST", `/webhooks/${webhookSales.id}/deliveries`, {
    eventCode: "SALES_RETURN_CONFIRMED",
    statusCode: null,
    success: false,
    errorMessage: "connect ECONNREFUSED 127.0.0.1:39217",
  });

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
  // click hits, so the rules/webhooks just seeded have something to react to
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
}

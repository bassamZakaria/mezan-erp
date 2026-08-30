import { afterEach, describe, expect, it } from "vitest";
import type { App } from "@mezan/api";
import type { NotificationDTO, NotificationRuleDTO, SessionDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "./create-backend.js";

/**
 * End-to-end proof that the notification-rules engine is actually WIRED at
 * runtime, not just implemented (see the repo's own "engines that are
 * implemented but never wired" pattern, docs/ROADMAP.md §1 / README.md "What is
 * not built"): a rule created over the real `/notification-rules` API fires
 * off a REAL sales-invoice confirm through the real `/sales-invoices` API,
 * and the resulting notification is readable through the real
 * `/notifications` API for the right recipient — no direct domain/engine
 * calls anywhere in this file.
 */

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

async function newBackend() {
  const handle = await createBackend({ dbPath: ":memory:" });
  handles.push(handle);
  return handle.app;
}

function post(app: App, path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request(`http://local${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * The server resolves the caller from its own session registry, so the suite
 * signs the seeded admin in for real and carries the token it was issued.
 */
async function loginAdmin(app: App): Promise<SessionDTO> {
  const res = await post(app, "/auth/login", { username: "admin@cyag.example", pin: "123456" });
  expect(res.status).toBe(200);
  return (await res.json()) as SessionDTO;
}

function bearer(session: SessionDTO): Record<string, string> {
  return { authorization: `Bearer ${session.token}` };
}

/** Every document line names a real catalogue item (D38). */
async function createServiceItem(app: App, session: SessionDTO) {
  const res = await post(
    app,
    "/items",
    { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" },
    bearer(session),
  );
  expect(res.status).toBe(201);
}

async function waitForAsyncBridge() {
  // The document-event bridge's enrichment lookup (packages/backend/src/
  // create-backend.ts's `createDocumentEventBridge`) is fire-and-forget by
  // design (DocumentEventPublisher.publish is synchronous) — give its
  // microtask queue a turn before asserting on the notification it produces.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("notification-rules engine — real end-to-end wiring", () => {
  it("mounts /notification-rules and /notifications on the seeded backend", async () => {
    const app = await newBackend();
    const session = await loginAdmin(app);
    const rulesRes = await app.fetch(new Request("http://local/notification-rules", { headers: bearer(session) }));
    expect(rulesRes.status).toBe(200);
    const notificationsRes = await app.fetch(
      new Request("http://local/notifications", { headers: bearer(session) }),
    );
    expect(notificationsRes.status).toBe(200);
  });

  it("a SALES_INVOICE_CONFIRMED rule fires a real in-app notification when a real invoice confirms", async () => {
    const app = await newBackend();
    const session = await loginAdmin(app);

    const ruleRes = await post(
      app,
      "/notification-rules",
      {
        id: "rule-invoice-confirmed",
        name: "فاتورة مبيعات مؤكدة",
        eventCode: "SALES_INVOICE_CONFIRMED",
        recipientType: "permission",
        recipientValue: "sales.invoice.view",
        priority: "normal",
        channels: ["in_app", "email"],
      },
      bearer(session),
    );
    expect(ruleRes.status).toBe(201);
    const rule = (await ruleRes.json()) as NotificationRuleDTO;
    expect(rule.active).toBe(true);

    await createServiceItem(app, session);
    await post(
      app,
      "/customers",
      {
        id: "cust-notif-1",
        code: "cust-notif-1",
        nameAr: "شركة الأمل للتجارة",
        paymentTermsDays: 30,
        currency: "EGP",
        openingBalance: "0",
        active: true,
        creditLimit: "0",
        taxExempt: false,
        etaBuyerType: "auto",
      },
      bearer(session),
    );

    const invoiceHeaders = bearer(session);
    const createRes = await post(
      app,
      "/sales-invoices",
      {
        id: "inv-notif-1",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        customerId: "cust-notif-1",
        customerNameAr: "شركة الأمل للتجارة",
        warehouseId: "WH1",
        branchId: "BR1",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          {
            lineId: "L1",
            itemId: "SVC-1",
            itemNameAr: "خدمة",
            isStock: false,
            qty: "1",
            unitPrice: "1150.00",
            taxRatePercent: 0,
            revenueAccountId: "4100",
          },
        ],
      },
      invoiceHeaders,
    );
    expect(createRes.status).toBe(201);

    const confirmRes = await post(app, "/sales-invoices/inv-notif-1/confirm", {}, invoiceHeaders);
    expect(confirmRes.status).toBe(200);

    await waitForAsyncBridge();

    const listRes = await app.fetch(
      new Request("http://local/notifications", { headers: bearer(session) }),
    );
    expect(listRes.status).toBe(200);
    const notifications = (await listRes.json()) as NotificationDTO[];
    const generated = notifications.find((n) => n.eventCode === "SALES_INVOICE_CONFIRMED");
    expect(generated).toBeDefined();
    expect(generated?.status).toBe("unread");
    expect(generated?.payload.documentNumber).toBeTruthy();
    expect(generated?.payload.customerName).toBe("شركة الأمل للتجارة");
    expect(generated?.payload.amount).toBe("1150.000000");
    expect(generated?.channelStatus).toEqual({ in_app: "delivered", email: "queued" });
    expect(generated?.body).toContain("شركة الأمل للتجارة");

    const unreadRes = await app.fetch(
      new Request("http://local/notifications/unread-count", { headers: bearer(session) }),
    );
    expect((await unreadRes.json()) as { count: number }).toEqual({ count: 1 });

    const readRes = await post(app, `/notifications/${generated?.id}/read`, {}, bearer(session));
    expect(readRes.status).toBe(200);
    const afterRead = await app.fetch(
      new Request("http://local/notifications/unread-count", { headers: bearer(session) }),
    );
    expect((await afterRead.json()) as { count: number }).toEqual({ count: 0 });
  });

  it("does not notify when the rule's condition does not match", async () => {
    const app = await newBackend();
    const session = await loginAdmin(app);

    await post(
      app,
      "/notification-rules",
      {
        id: "rule-big-invoice-only",
        name: "فاتورة كبيرة فقط",
        eventCode: "SALES_INVOICE_CONFIRMED",
        condition: { field: "amount", operator: "gt", value: "5000" },
        recipientType: "permission",
        recipientValue: "sales.invoice.view",
        priority: "high",
        channels: ["in_app"],
      },
      bearer(session),
    );

    await createServiceItem(app, session);
    await post(
      app,
      "/customers",
      {
        id: "cust-notif-2",
        code: "cust-notif-2",
        nameAr: "عميل صغير",
        paymentTermsDays: 30,
        currency: "EGP",
        openingBalance: "0",
        active: true,
        creditLimit: "0",
        taxExempt: false,
        etaBuyerType: "auto",
      },
      bearer(session),
    );

    const invoiceHeaders = bearer(session);
    const createRes = await post(
      app,
      "/sales-invoices",
      {
        id: "inv-notif-2",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        customerId: "cust-notif-2",
        customerNameAr: "عميل صغير",
        warehouseId: "WH1",
        branchId: "BR1",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          {
            lineId: "L1",
            itemId: "SVC-1",
            itemNameAr: "خدمة",
            isStock: false,
            qty: "1",
            unitPrice: "10.00",
            taxRatePercent: 0,
            revenueAccountId: "4100",
          },
        ],
      },
      invoiceHeaders,
    );
    expect(createRes.status).toBe(201);
    const confirmRes = await post(app, "/sales-invoices/inv-notif-2/confirm", {}, invoiceHeaders);
    expect(confirmRes.status).toBe(200);
    await waitForAsyncBridge();

    const listRes = await app.fetch(
      new Request("http://local/notifications", { headers: bearer(session) }),
    );
    const notifications = (await listRes.json()) as NotificationDTO[];
    expect(notifications.find((n) => n.eventCode === "SALES_INVOICE_CONFIRMED")).toBeUndefined();
  });
});

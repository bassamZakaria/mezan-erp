import { describe, it, expect } from "vitest";
import { createSqliteWebhookStores } from "./webhook-store.js";

function baseWebhook() {
  return {
    id: "wh-1",
    name: "المخزون المنخفض",
    targetUrl: "https://example.com/hooks/mezan",
    events: ["inventory.low_stock", "sales_invoice.confirmed"],
    secret: "whsec_abc123",
    active: true,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("SqliteWebhookStore", () => {
  it("round-trips the events array exactly, in order", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      const loaded = await stores.webhooks.findById("wh-1");
      expect(loaded?.events).toEqual(["inventory.low_stock", "sales_invoice.confirmed"]);
    } finally {
      stores.close();
    }
  });

  it("round-trips an empty events array as empty, not omitted", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save({ ...baseWebhook(), events: [] });
      const loaded = await stores.webhooks.findById("wh-1");
      expect(loaded?.events).toEqual([]);
    } finally {
      stores.close();
    }
  });

  it("round-trips active=false and the secret verbatim", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save({ ...baseWebhook(), active: false });
      const loaded = await stores.webhooks.findById("wh-1");
      expect(loaded?.active).toBe(false);
      expect(loaded?.secret).toBe("whsec_abc123");
    } finally {
      stores.close();
    }
  });

  it("findById returns null for an id with no webhook", async () => {
    const stores = createSqliteWebhookStores();
    try {
      expect(await stores.webhooks.findById("does-not-exist")).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("save() upserts an existing id's fields rather than duplicating the row", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      await stores.webhooks.save({ ...baseWebhook(), name: "اسم محدث", active: false, events: ["purchase_order.received"] });
      const loaded = await stores.webhooks.findById("wh-1");
      expect(loaded?.name).toBe("اسم محدث");
      expect(loaded?.active).toBe(false);
      expect(loaded?.events).toEqual(["purchase_order.received"]);
      expect(await stores.webhooks.list()).toHaveLength(1);
    } finally {
      stores.close();
    }
  });

  it("list() orders by created_at DESC (newest first)", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save({ ...baseWebhook(), id: "wh-old", createdAt: "2026-01-01T00:00:00.000Z" });
      await stores.webhooks.save({ ...baseWebhook(), id: "wh-new", createdAt: "2026-02-01T00:00:00.000Z" });
      const all = await stores.webhooks.list();
      expect(all.map((w) => w.id)).toEqual(["wh-new", "wh-old"]);
    } finally {
      stores.close();
    }
  });
});

describe("SqliteWebhookDeliveryStore", () => {
  function baseAttempt(overrides: Partial<{ id: string; webhookId: string; attemptedAt: string; success: boolean; statusCode: number | null; errorMessage: string | null }> = {}) {
    return {
      id: overrides.id ?? "del-1",
      webhookId: overrides.webhookId ?? "wh-1",
      eventCode: "inventory.low_stock",
      attemptedAt: overrides.attemptedAt ?? "2026-01-01T00:00:00.000Z",
      statusCode: overrides.statusCode !== undefined ? overrides.statusCode : 200,
      success: overrides.success ?? true,
      errorMessage: overrides.errorMessage !== undefined ? overrides.errorMessage : null,
    };
  }

  it("round-trips a successful delivery's statusCode and errorMessage=null", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      await stores.deliveries.record(baseAttempt());
      const all = await stores.deliveries.listForWebhook("wh-1");
      expect(all).toHaveLength(1);
      expect(all[0]!.statusCode).toBe(200);
      expect(all[0]!.success).toBe(true);
      expect(all[0]!.errorMessage).toBeNull();
    } finally {
      stores.close();
    }
  });

  it("round-trips a failed delivery's statusCode=null (e.g. a network error before any response) and its errorMessage", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      await stores.deliveries.record(baseAttempt({ statusCode: null, success: false, errorMessage: "ECONNREFUSED" }));
      const all = await stores.deliveries.listForWebhook("wh-1");
      expect(all[0]!.statusCode).toBeNull();
      expect(all[0]!.success).toBe(false);
      expect(all[0]!.errorMessage).toBe("ECONNREFUSED");
    } finally {
      stores.close();
    }
  });

  it("listForWebhook filters by webhook, and a webhook with no deliveries returns an empty list", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      await stores.webhooks.save({ ...baseWebhook(), id: "wh-2" });
      await stores.deliveries.record(baseAttempt({ id: "del-1", webhookId: "wh-1" }));
      await stores.deliveries.record(baseAttempt({ id: "del-2", webhookId: "wh-2" }));
      expect((await stores.deliveries.listForWebhook("wh-1")).map((d) => d.id)).toEqual(["del-1"]);
      expect(await stores.deliveries.listForWebhook("wh-does-not-exist")).toEqual([]);
    } finally {
      stores.close();
    }
  });

  it("listForWebhook orders by attempted_at DESC and respects the limit", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      await stores.deliveries.record(baseAttempt({ id: "del-1", attemptedAt: "2026-01-01T00:00:00.000Z" }));
      await stores.deliveries.record(baseAttempt({ id: "del-2", attemptedAt: "2026-01-02T00:00:00.000Z" }));
      await stores.deliveries.record(baseAttempt({ id: "del-3", attemptedAt: "2026-01-03T00:00:00.000Z" }));
      const all = await stores.deliveries.listForWebhook("wh-1");
      expect(all.map((d) => d.id)).toEqual(["del-3", "del-2", "del-1"]);
      const limited = await stores.deliveries.listForWebhook("wh-1", 2);
      expect(limited.map((d) => d.id)).toEqual(["del-3", "del-2"]);
    } finally {
      stores.close();
    }
  });

  it("listForWebhook defaults the limit to 50", async () => {
    const stores = createSqliteWebhookStores();
    try {
      await stores.webhooks.save(baseWebhook());
      for (let i = 0; i < 55; i++) {
        await stores.deliveries.record(
          baseAttempt({ id: `del-${i}`, attemptedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z` }),
        );
      }
      const all = await stores.deliveries.listForWebhook("wh-1");
      expect(all).toHaveLength(50);
    } finally {
      stores.close();
    }
  });
});

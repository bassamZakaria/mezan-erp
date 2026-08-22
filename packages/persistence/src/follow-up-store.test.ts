import { describe, it, expect } from "vitest";
import { createFollowUp, completeFollowUp } from "@mezan/domain";
import { createStandaloneSqliteFollowUpStore } from "./follow-up-store.js";

describe("createStandaloneSqliteFollowUpStore", () => {
  it("saves, updates and lists follow-ups", async () => {
    const store = createStandaloneSqliteFollowUpStore();
    try {
      const f = createFollowUp({
        id: "F1",
        customerId: "CUST1",
        type: "CALL",
        followUpDate: "2026-08-21",
        createdAt: "2026-08-21T00:00:00.000Z",
      });
      await store.save(f);

      const found = await store.findById("F1");
      expect(found?.status).toBe("pending");

      await store.update(completeFollowUp(found as NonNullable<typeof found>, "وعد بالدفع"));
      const updated = await store.findById("F1");
      expect(updated?.status).toBe("completed");
      expect(updated?.outcome).toBe("وعد بالدفع");

      const list = await store.list({ customerId: "CUST1" });
      expect(list).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

import { describe, it, expect } from "vitest";
import { undeliverableEventReasons } from "./event-policy.js";

describe("undeliverableEventReasons", () => {
  it("disables the check entirely when deliverableCodes is omitted", () => {
    expect(undeliverableEventReasons(["SALES_INVOICE_CONFIRMED"], {})).toEqual([]);
  });

  it("disables the check entirely when deliverableCodes is empty", () => {
    expect(undeliverableEventReasons(["SALES_INVOICE_CONFIRMED"], { deliverableCodes: [] })).toEqual([]);
  });

  it("passes an event that is in the deliverable set", () => {
    const reasons = undeliverableEventReasons(["SALES_INVOICE_CONFIRMED"], {
      deliverableCodes: ["SALES_INVOICE_CONFIRMED"],
    });
    expect(reasons).toEqual([]);
  });

  it("flags a catalogued event that is not in the deliverable set", () => {
    const reasons = undeliverableEventReasons(["CHEQUE_BOUNCED"], {
      deliverableCodes: ["SALES_INVOICE_CONFIRMED"],
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain("CHEQUE_BOUNCED");
    expect(reasons[0]).toContain("شيك مرتجع");
    expect(reasons[0]).toContain("never emitted");
  });

  it("silently ignores an unknown (non-catalogued) code — that is register-webhook's job to reject", () => {
    const reasons = undeliverableEventReasons(["NOT_A_REAL_EVENT"], {
      deliverableCodes: ["SALES_INVOICE_CONFIRMED"],
    });
    expect(reasons).toEqual([]);
  });

  it("reports one reason per undeliverable code among several events", () => {
    const reasons = undeliverableEventReasons(
      ["SALES_INVOICE_CONFIRMED", "CHEQUE_BOUNCED", "TENANT_CREATED"],
      { deliverableCodes: ["SALES_INVOICE_CONFIRMED"] },
    );
    expect(reasons).toHaveLength(2);
  });
});

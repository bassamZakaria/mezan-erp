import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { CashFlowDirection, CashForecastSourceKind, type CashForecastItem } from "../cash-forecast/types.js";
import type { VoucherAllocation } from "../vouchers/allocation.js";
import { assertValidDunningPolicy, defaultDunningPolicy, stepReached } from "./policy.js";
import { buildCollectionWorklist } from "./worklist.js";
import { planDunningRun } from "./dunning-run.js";
import { createPromiseToPay, evaluatePromise } from "./promise.js";
import { whatsAppLink } from "./message.js";
import { InvalidDunningPolicyError } from "./errors.js";
import { DunningChannel, DunningReminderStatus, DunningVoidReason, PromiseToPayStatus, type DunningReminder } from "./types.js";

const TODAY = "2026-10-17";

function item(id: string, dueDate: string, amount: string, partyId = "C1"): CashForecastItem {
  return {
    id,
    kind: CashForecastSourceKind.Receivable,
    direction: CashFlowDirection.Inflow,
    dueDate,
    amount: Money.fromMajor(amount),
    partyId,
    partyName: "عميل",
    partyNameEn: null,
    reference: id,
    documentId: id.replace("receivable:", ""),
    currency: null,
    branchId: null,
    detail: null,
  };
}

const render = () => ({ subject: "s", body: "b" });

function plan(items: CashForecastItem[], existing: DunningReminder[] = [], extra: Partial<Parameters<typeof planDunningRun>[0]> = {}) {
  return planDunningRun({
    policy: defaultDunningPolicy(),
    rows: buildCollectionWorklist(items, TODAY),
    existing,
    heldCustomerIds: new Set(),
    pendingPromiseCustomerIds: new Set(),
    asOfDate: TODAY,
    now: `${TODAY}T08:00:00.000Z`,
    actor: "u1",
    idGen: (() => {
      let n = 0;
      return () => `r${++n}`;
    })(),
    render,
    ...extra,
  });
}

describe("dunning policy", () => {
  it("picks the highest step reached and none before the first threshold", () => {
    const policy = defaultDunningPolicy();
    expect(stepReached(policy, 3)).toBeNull();
    expect(stepReached(policy, 7)?.level).toBe(1);
    expect(stepReached(policy, 45)?.level).toBe(2);
    expect(stepReached(policy, 90)?.level).toBe(3);
  });

  it("refuses SMS while no provider is connected, in both languages", () => {
    const policy = defaultDunningPolicy();
    const sms = { ...policy, steps: [{ ...policy.steps[0]!, channel: DunningChannel.Sms }] };
    try {
      assertValidDunningPolicy(sms, { smsAvailable: false });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDunningPolicyError);
      expect((err as InvalidDunningPolicyError).messageEn).toMatch(/SMS/);
    }
  });
});

describe("dunning run", () => {
  it("prepares one reminder per overdue item and step, and is idempotent", () => {
    const items = [item("receivable:INV-1", "2026-10-01", "100"), item("receivable:INV-2", "2026-10-15", "50")];
    const first = plan(items);
    expect(first.toInsert.map((r) => [r.itemKey, r.stepLevel])).toEqual([["receivable:INV-1", 1]]);
    const second = plan(items, first.toInsert as DunningReminder[]);
    expect(second.toInsert).toHaveLength(0);
  });

  it("advances to the next step only once its threshold passes", () => {
    const earlier = plan([item("receivable:INV-1", "2026-10-08", "100")]);
    expect(earlier.toInsert[0]?.stepLevel).toBe(1);
    const later = plan([item("receivable:INV-1", "2026-08-01", "100")], earlier.toInsert as DunningReminder[]);
    expect(later.toInsert[0]?.stepLevel).toBe(3);
    expect(later.toVoid.map((r) => r.voidReason)).toEqual([DunningVoidReason.Superseded]);
  });

  it("voids a prepared reminder once its invoice is no longer overdue", () => {
    const first = plan([item("receivable:INV-1", "2026-10-01", "100")]);
    const settled = plan([], first.toInsert as DunningReminder[]);
    expect(settled.toVoid).toHaveLength(1);
    expect(settled.toVoid[0]?.status).toBe(DunningReminderStatus.Voided);
    expect(settled.toVoid[0]?.voidReason).toBe(DunningVoidReason.Settled);
  });

  it("skips held customers, pending promises and amounts under the minimum", () => {
    const items = [item("receivable:INV-1", "2026-10-01", "100")];
    expect(plan(items, [], { heldCustomerIds: new Set(["C1"]) }).skippedHeld).toBe(1);
    expect(plan(items, [], { pendingPromiseCustomerIds: new Set(["C1"]) }).skippedPromised).toBe(1);
    const policy = { ...defaultDunningPolicy(), minimumOverdueAmount: Money.fromMajor("500") };
    const gated = plan(items, [], { policy });
    expect(gated.skippedBelowMinimum).toBe(1);
    expect(gated.toInsert).toHaveLength(0);
  });
});

describe("promise to pay", () => {
  const promise = createPromiseToPay({
    id: "P1",
    customerId: "C1",
    promisedDate: "2026-10-20",
    amount: Money.fromMajor("100"),
    invoiceIds: ["INV-1"],
    note: null,
    today: TODAY,
    now: `${TODAY}T08:00:00.000Z`,
    actor: "u1",
  });

  function allocation(amount: string, date: string, status: "active" | "reversed" = "active"): VoucherAllocation {
    return {
      id: `A-${date}`,
      voucherId: "V1",
      invoiceId: "INV-1",
      amount: Money.fromMajor(amount),
      status,
      createdAt: `${date}T09:00:00.000Z`,
      reversedAt: null,
      date,
    };
  }

  it("is pending before the date, kept when allocations cover it by the date, broken after", () => {
    expect(evaluatePromise(promise, new Map(), "2026-10-18").status).toBe(PromiseToPayStatus.Pending);
    expect(evaluatePromise(promise, new Map(), "2026-10-21").status).toBe(PromiseToPayStatus.Broken);
    const paid = new Map([["INV-1", [allocation("100", "2026-10-19")]]]);
    expect(evaluatePromise(promise, paid, "2026-10-21").status).toBe(PromiseToPayStatus.Kept);
  });

  it("ignores reversed allocations and payments made after the promised date", () => {
    const reversed = new Map([["INV-1", [allocation("100", "2026-10-19", "reversed")]]]);
    expect(evaluatePromise(promise, reversed, "2026-10-21").status).toBe(PromiseToPayStatus.Broken);
    const late = new Map([["INV-1", [allocation("100", "2026-10-22")]]]);
    expect(evaluatePromise(promise, late, "2026-10-23").status).toBe(PromiseToPayStatus.Broken);
  });

  it("refuses a past date and a zero amount", () => {
    const base = { id: "P2", customerId: "C1", invoiceIds: ["INV-1"], note: null, today: TODAY, now: TODAY, actor: "u1" };
    expect(() => createPromiseToPay({ ...base, promisedDate: "2026-10-01", amount: Money.fromMajor("10") })).toThrow();
    expect(() => createPromiseToPay({ ...base, promisedDate: "2026-10-30", amount: Money.zero() })).toThrow();
  });
});

describe("whatsapp link", () => {
  it("normalises an Egyptian mobile number to an international wa.me link", () => {
    expect(whatsAppLink("0100 123 4567", "مرحبا")).toBe(`https://wa.me/201001234567?text=${encodeURIComponent("مرحبا")}`);
    expect(whatsAppLink("", "x")).toBeNull();
  });
});

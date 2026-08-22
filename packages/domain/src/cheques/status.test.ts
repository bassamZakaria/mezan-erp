import { describe, expect, it } from "vitest";
import { effectiveChequeStatus, assertChequeTransition, COLLECTION_WINDOW_DAYS } from "./status.js";
import { InvalidChequeTransitionError } from "./errors.js";
import type { Cheque } from "./cheque.js";
import { Money } from "../money/index.js";

function baseCheque(overrides: Partial<Cheque> = {}): Cheque {
  return {
    id: "chq-1",
    direction: "incoming",
    status: "pending",
    chequeNumber: "CHQ-5001",
    bankName: "بنك مصر",
    bankBranchName: null,
    bankAccountNumber: null,
    amount: Money.fromMajor("1000"),
    currency: "EGP",
    issueDate: "2026-08-01",
    dueDate: "2026-08-20",
    branchId: "b1",
    notes: null,
    partyId: "cust-1",
    counterpartyGlAccountId: "1100",
    controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" },
    bankTreasuryAccountId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    depositedAt: null,
    collectedAt: null,
    bouncedAt: null,
    replacesChequeId: null,
    replacedByChequeId: null,
    creationJournalEntryId: "je-1",
    collectionJournalEntryId: null,
    bounceJournalEntryId: null,
    ...overrides,
  };
}

describe("effectiveChequeStatus", () => {
  it("stays pending well before the collection window", () => {
    const cheque = baseCheque({ dueDate: "2026-08-20" });
    expect(effectiveChequeStatus(cheque, "2026-08-10")).toBe("pending");
  });

  it("becomes under_collection inside the window before the due date", () => {
    const cheque = baseCheque({ dueDate: "2026-08-20" });
    const withinWindowDate = "2026-08-18"; // 2 days before, within COLLECTION_WINDOW_DAYS=3
    expect(effectiveChequeStatus(cheque, withinWindowDate)).toBe("under_collection");
  });

  it("becomes due_today exactly on the due date", () => {
    const cheque = baseCheque({ dueDate: "2026-08-20" });
    expect(effectiveChequeStatus(cheque, "2026-08-20")).toBe("due_today");
  });

  it("stays due_today when overdue (no separate overdue state)", () => {
    const cheque = baseCheque({ dueDate: "2026-08-20" });
    expect(effectiveChequeStatus(cheque, "2026-08-25")).toBe("due_today");
  });

  it("respects the exact boundary of the collection window", () => {
    const cheque = baseCheque({ dueDate: "2026-08-20" });
    const boundaryDate = "2026-08-17"; // exactly COLLECTION_WINDOW_DAYS=3 days before
    expect(effectiveChequeStatus(cheque, boundaryDate)).toBe("under_collection");
    expect(COLLECTION_WINDOW_DAYS).toBe(3);
    expect(effectiveChequeStatus(cheque, "2026-08-16")).toBe("pending");
  });

  it("passes through non-pending stored statuses unchanged regardless of date", () => {
    for (const status of ["deposited", "collected", "bounced", "replaced"] as const) {
      const cheque = baseCheque({ status, dueDate: "2026-08-20" });
      expect(effectiveChequeStatus(cheque, "2026-01-01")).toBe(status);
    }
  });
});

describe("assertChequeTransition", () => {
  it("allows deposit only from pending", () => {
    expect(() => assertChequeTransition(baseCheque({ status: "pending" }), "deposit")).not.toThrow();
    expect(() => assertChequeTransition(baseCheque({ status: "deposited" }), "deposit")).toThrow(InvalidChequeTransitionError);
    expect(() => assertChequeTransition(baseCheque({ status: "collected" }), "deposit")).toThrow(InvalidChequeTransitionError);
  });

  it("allows collect only from deposited", () => {
    expect(() => assertChequeTransition(baseCheque({ status: "deposited" }), "collect")).not.toThrow();
    expect(() => assertChequeTransition(baseCheque({ status: "pending" }), "collect")).toThrow(InvalidChequeTransitionError);
  });

  it("allows bounce only from deposited", () => {
    expect(() => assertChequeTransition(baseCheque({ status: "deposited" }), "bounce")).not.toThrow();
    expect(() => assertChequeTransition(baseCheque({ status: "pending" }), "bounce")).toThrow(InvalidChequeTransitionError);
    expect(() => assertChequeTransition(baseCheque({ status: "collected" }), "bounce")).toThrow(InvalidChequeTransitionError);
  });

  it("allows replace only from bounced", () => {
    expect(() => assertChequeTransition(baseCheque({ status: "bounced" }), "replace")).not.toThrow();
    expect(() => assertChequeTransition(baseCheque({ status: "pending" }), "replace")).toThrow(InvalidChequeTransitionError);
    expect(() => assertChequeTransition(baseCheque({ status: "replaced" }), "replace")).toThrow(InvalidChequeTransitionError);
  });

  it("rejects every illegal (status, action) pair across the whole stored-state matrix", () => {
    const statuses: Cheque["status"][] = ["pending", "deposited", "collected", "bounced", "replaced"];
    const legal: Record<"deposit" | "collect" | "bounce" | "replace", Cheque["status"]> = {
      deposit: "pending",
      collect: "deposited",
      bounce: "deposited",
      replace: "bounced",
    };
    for (const action of Object.keys(legal) as (keyof typeof legal)[]) {
      for (const status of statuses) {
        const call = () => assertChequeTransition(baseCheque({ status }), action);
        if (status === legal[action]) expect(call).not.toThrow();
        else expect(call).toThrow(InvalidChequeTransitionError);
      }
    }
  });

  it("carries the cheque id and from/to status on the error", () => {
    try {
      assertChequeTransition(baseCheque({ id: "chq-42", status: "pending" }), "collect");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidChequeTransitionError);
      const e = err as InvalidChequeTransitionError;
      expect(e.chequeId).toBe("chq-42");
      expect(e.from).toBe("pending");
      expect(e.to).toBe("collected");
    }
  });
});

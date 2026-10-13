import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { Cheque, ChequeStatus, ChequeStoredStatus } from "./cheque.js";
import { CHEQUE_STATUS_DEFINITIONS } from "./cheque.js";
import { COLLECTION_WINDOW_DAYS, ChequeAction, assertChequeTransition, effectiveChequeStatus } from "./status.js";
import { InvalidChequeTransitionError } from "./errors.js";

type Action = Exclude<ChequeAction, ChequeAction.Return>;

const storedArb = fc.constantFrom<ChequeStoredStatus>("pending", "deposited", "collected", "bounced", "replaced");
const actionArb = fc.constantFrom<Action>(ChequeAction.Deposit, ChequeAction.Collect, ChequeAction.Bounce, ChequeAction.Replace);
const dateArb = fc
  .date({ min: new Date("2020-01-01T00:00:00.000Z"), max: new Date("2035-12-31T00:00:00.000Z") })
  .map((d) => d.toISOString().slice(0, 10));

const LEGAL: Record<Action, ChequeStoredStatus> = {
  [ChequeAction.Deposit]: "pending",
  [ChequeAction.Collect]: "deposited",
  [ChequeAction.Bounce]: "deposited",
  [ChequeAction.Replace]: "bounced",
};
const TARGET: Record<Action, ChequeStoredStatus> = {
  [ChequeAction.Deposit]: "deposited",
  [ChequeAction.Collect]: "collected",
  [ChequeAction.Bounce]: "bounced",
  [ChequeAction.Replace]: "replaced",
};

function chequeOf(status: ChequeStoredStatus, dueDate: string): Cheque {
  return { id: "CHQ-1", status, dueDate } as Cheque;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("cheque lifecycle — fuzz", () => {
  it("fuzz: only the four documented transitions are accepted, from exactly one state each", () => {
    fc.assert(
      fc.property(storedArb, actionArb, dateArb, (status, action, dueDate) => {
        const cheque = chequeOf(status, dueDate);
        if (status === LEGAL[action]) {
          expect(() => assertChequeTransition(cheque, action)).not.toThrow();
        } else {
          expect(() => assertChequeTransition(cheque, action)).toThrow(InvalidChequeTransitionError);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: collected and replaced are terminal — no action leaves them", () => {
    fc.assert(
      fc.property(fc.constantFrom<ChequeStoredStatus>("collected", "replaced"), actionArb, dateArb, (status, action, dueDate) => {
        expect(() => assertChequeTransition(chequeOf(status, dueDate), action)).toThrow(InvalidChequeTransitionError);
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: the whole legal walk pending → deposited → bounced → replaced is reachable and ordered", () => {
    fc.assert(
      fc.property(dateArb, (dueDate) => {
        let status: ChequeStoredStatus = "pending";
        for (const action of [ChequeAction.Deposit, ChequeAction.Bounce, ChequeAction.Replace] as const) {
          expect(() => assertChequeTransition(chequeOf(status, dueDate), action)).not.toThrow();
          status = TARGET[action];
        }
        expect(status).toBe("replaced");

        // The shortcut a careless UI might offer — collecting a cheque that was
        // never deposited — must still be refused.
        expect(() => assertChequeTransition(chequeOf("pending", dueDate), ChequeAction.Collect)).toThrow(
          InvalidChequeTransitionError,
        );
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: the derived status only ever splits `pending`, never a settled cheque", () => {
    fc.assert(
      fc.property(storedArb, dateArb, dateArb, (status, dueDate, asOf) => {
        const derived = effectiveChequeStatus(chequeOf(status, dueDate), asOf);
        if (status === "pending") {
          expect(["pending", "under_collection", "due_today"]).toContain(derived);
        } else {
          expect(derived).toBe(status);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: the derived status is exactly the documented function of due date and today", () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -30, max: 30 }), (dueDate, offset) => {
        const asOf = addDays(dueDate, offset);
        const derived = effectiveChequeStatus(chequeOf("pending", dueDate), asOf);
        const expected: ChequeStatus =
          offset >= 0 ? "due_today" : offset >= -COLLECTION_WINDOW_DAYS ? "under_collection" : "pending";
        expect(derived).toBe(expected);
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: the derived status is monotonic in time — a cheque never becomes less urgent", () => {
    const rank: Record<string, number> = { pending: 0, under_collection: 1, due_today: 2 };
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -40, max: 40 }), fc.integer({ min: 0, max: 40 }), (dueDate, start, step) => {
        const earlier = effectiveChequeStatus(chequeOf("pending", dueDate), addDays(dueDate, start));
        const later = effectiveChequeStatus(chequeOf("pending", dueDate), addDays(dueDate, start + step));
        expect(rank[later] as number).toBeGreaterThanOrEqual(rank[earlier] as number);
      }),
      { numRuns: 400 },
    );
  });

  it("every one of the seven statuses has an Arabic label and a distinct code", () => {
    const codes = CHEQUE_STATUS_DEFINITIONS.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toHaveLength(7);
    for (const def of CHEQUE_STATUS_DEFINITIONS) {
      expect(def.labelAr.trim().length).toBeGreaterThan(0);
      expect(def.labelEn.trim().length).toBeGreaterThan(0);
      expect(/[\u0600-\u06FF]/.test(def.labelAr)).toBe(true);
    }
  });
});

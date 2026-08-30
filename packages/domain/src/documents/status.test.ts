import { describe, it, expect } from "vitest";
import {
  DOCUMENT_STATUS_LABELS_AR,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  DOCUMENT_TRANSITIONS,
  canTransition,
  assertTransition,
  isActive,
  isTerminal,
  type DocumentStatus,
} from "./status.js";
import { InvalidDocumentTransitionError } from "./errors.js";

const ALL_STATUSES: readonly DocumentStatus[] = [
  "draft",
  "pending",
  "confirmed",
  "posted",
  "cancelled",
  "reversed",
];

describe("DOCUMENT_STATUS_LABELS_AR", () => {
  it("has an Arabic label for every status", () => {
    for (const status of ALL_STATUSES) {
      expect(DOCUMENT_STATUS_LABELS_AR[status]).toBeTruthy();
    }
  });
});

describe("every documented legal transition", () => {
  it.each([
    ["draft", "pending"],
    ["draft", "confirmed"],
    ["draft", "posted"],
    ["draft", "cancelled"],
    ["pending", "confirmed"],
    ["pending", "posted"],
    ["pending", "draft"],
    ["pending", "cancelled"],
    ["confirmed", "reversed"],
    ["posted", "reversed"],
  ] as const)("%s -> %s is legal", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition("SALES_INVOICE", "d1", from, to)).not.toThrow();
  });
});

describe("every documented illegal transition", () => {
  it.each([
    ["draft", "draft"],
    ["draft", "reversed"],
    ["pending", "pending"],
    ["pending", "reversed"],
    ["confirmed", "draft"],
    ["confirmed", "pending"],
    ["confirmed", "confirmed"],
    ["confirmed", "posted"],
    ["confirmed", "cancelled"],
    ["posted", "draft"],
    ["posted", "pending"],
    ["posted", "confirmed"],
    ["posted", "posted"],
    ["posted", "cancelled"],
    ["cancelled", "draft"],
    ["cancelled", "pending"],
    ["cancelled", "confirmed"],
    ["cancelled", "posted"],
    ["cancelled", "cancelled"],
    ["cancelled", "reversed"],
    ["reversed", "draft"],
    ["reversed", "pending"],
    ["reversed", "confirmed"],
    ["reversed", "posted"],
    ["reversed", "cancelled"],
    ["reversed", "reversed"],
  ] as const)("%s -> %s is refused with the module's own error", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition("SALES_INVOICE", "d1", from, to)).toThrow(
      InvalidDocumentTransitionError,
    );
  });
});

describe("exhaustive cross-check against DOCUMENT_TRANSITIONS", () => {
  it("canTransition agrees with the transition table for every (from, to) pair", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = DOCUMENT_TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });
});

describe("terminal states stay terminal under any sequence of actions", () => {
  it.each(["cancelled", "reversed"] as const)(
    "%s has no legal transition to ANY other status, including itself",
    (terminal) => {
      for (const to of ALL_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
      expect(DOCUMENT_TRANSITIONS[terminal]).toEqual([]);
    },
  );

  it("a cancelled document cannot be re-cancelled, confirmed, or reversed after further attempts", () => {
    let status: DocumentStatus = "cancelled";
    for (const attempted of ["draft", "pending", "confirmed", "posted", "cancelled", "reversed"] as const) {
      expect(() => assertTransition("SALES_INVOICE", "d1", status, attempted)).toThrow(
        InvalidDocumentTransitionError,
      );
      // status never actually moves — the guard always refuses first
      expect(status).toBe("cancelled");
    }
  });
});

describe("isActive", () => {
  it("is true only for confirmed and posted", () => {
    expect(ACTIVE_STATUSES.size).toBe(2);
    for (const status of ALL_STATUSES) {
      expect(isActive(status)).toBe(status === "confirmed" || status === "posted");
    }
  });
});

describe("isTerminal", () => {
  it("is true only for cancelled and reversed", () => {
    expect(TERMINAL_STATUSES.size).toBe(2);
    for (const status of ALL_STATUSES) {
      expect(isTerminal(status)).toBe(status === "cancelled" || status === "reversed");
    }
  });
});

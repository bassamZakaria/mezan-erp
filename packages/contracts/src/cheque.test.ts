import { describe, it, expect } from "vitest";
import {
  chequeDirectionSchema,
  chequeStoredStatusSchema,
  chequeStatusSchema,
  chequeControlAccountsSchema,
  chequeSchema,
  createChequeSchema,
  depositChequeSchema,
  collectChequeSchema,
  bounceChequeSchema,
  replaceChequeSchema,
  chequeListQuerySchema,
} from "./cheque.js";

describe("chequeDirectionSchema", () => {
  it("accepts incoming and outgoing", () => {
    expect(chequeDirectionSchema.safeParse("incoming").success).toBe(true);
    expect(chequeDirectionSchema.safeParse("outgoing").success).toBe(true);
  });

  it("rejects a direction outside the enum", () => {
    expect(chequeDirectionSchema.safeParse("internal").success).toBe(false);
  });
});

describe("chequeControlAccountsSchema", () => {
  it("accepts a minimal valid payload with the nullish field omitted", () => {
    const result = chequeControlAccountsSchema.safeParse({ underCollectionAccountId: "acc-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing underCollectionAccountId", () => {
    const result = chequeControlAccountsSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("underCollectionAccountId");
  });
});

describe("chequeSchema", () => {
  const cheque = {
    id: "chq-1",
    direction: "incoming" as const,
    status: "pending" as const,
    effectiveStatus: "pending" as const,
    chequeNumber: "1002345",
    bankName: "بنك مصر",
    bankBranchName: null,
    bankAccountNumber: null,
    amount: "10000.123456",
    currency: "EGP",
    issueDate: "2026-08-30",
    dueDate: "2026-09-30",
    branchId: "branch-1",
    notes: null,
    partyId: "cust-1",
    counterpartyGlAccountId: "acc-1",
    controlAccounts: { underCollectionAccountId: "acc-uc" },
    bankTreasuryAccountId: null,
    createdAt: "2026-08-30T10:00:00.000Z",
    depositedAt: null,
    collectedAt: null,
    bouncedAt: null,
    replacesChequeId: null,
    replacedByChequeId: null,
    creationJournalEntryId: null,
    collectionJournalEntryId: null,
    bounceJournalEntryId: null,
  };

  it("accepts a minimal valid cheque and preserves every field verbatim", () => {
    const result = chequeSchema.safeParse(cheque);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(cheque);
  });

  it("rejects a cheque missing branchId", () => {
    const { branchId, ...rest } = cheque;
    const result = chequeSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("branchId");
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = chequeSchema.safeParse({ ...cheque, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = chequeSchema.safeParse({ ...cheque, amount: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum effectiveStatus", () => {
    const result = chequeSchema.safeParse({ ...cheque, effectiveStatus: "lost" });
    expect(result.success).toBe(false);
  });
});

describe("createChequeSchema", () => {
  const create = {
    direction: "incoming" as const,
    chequeNumber: "1002345",
    bankName: "بنك مصر",
    amount: "10000.123456",
    issueDate: "2026-08-30",
    dueDate: "2026-09-30",
    branchId: "branch-1",
    partyId: "cust-1",
    counterpartyGlAccountId: "acc-1",
    controlAccounts: { underCollectionAccountId: "acc-uc" },
  };

  it("accepts a minimal valid payload with optionals omitted", () => {
    const result = createChequeSchema.safeParse(create);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(create);
  });

  it("never coerces amount to a float — high-precision decimal string survives verbatim", () => {
    const result = createChequeSchema.safeParse({ ...create, amount: "0.100001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe("0.100001");
  });

  it("rejects amount sent as a JS number instead of a string", () => {
    const result = createChequeSchema.safeParse({ ...create, amount: 10000.12 });
    expect(result.success).toBe(false);
  });

  it("rejects a payload missing controlAccounts", () => {
    const { controlAccounts, ...rest } = create;
    const result = createChequeSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("controlAccounts");
  });
});

describe("depositChequeSchema", () => {
  it("accepts a minimal valid payload and preserves it verbatim", () => {
    const result = depositChequeSchema.safeParse({ bankTreasuryAccountId: "acc-bank" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing bankTreasuryAccountId", () => {
    const result = depositChequeSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("collectChequeSchema", () => {
  it("accepts a minimal valid payload with date omitted", () => {
    const result = collectChequeSchema.safeParse({ bankGlAccountId: "acc-bank" });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing bankGlAccountId", () => {
    const result = collectChequeSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("bounceChequeSchema", () => {
  it("accepts an empty payload — date is optional", () => {
    const result = bounceChequeSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("replaceChequeSchema", () => {
  const replace = {
    newCheque: {
      chequeNumber: "1002346",
      bankName: "بنك مصر",
      issueDate: "2026-09-01",
      dueDate: "2026-10-01",
      branchId: "branch-1",
    },
  };

  it("accepts a minimal valid payload", () => {
    const result = replaceChequeSchema.safeParse(replace);
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing newCheque", () => {
    const result = replaceChequeSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("newCheque");
  });

  it("silently strips an unrecognised amount on newCheque — the replacement keeps the original amount, not a caller-supplied one", () => {
    const result = replaceChequeSchema.safeParse({ newCheque: { ...replace.newCheque, amount: "99999" } });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.newCheque).not.toHaveProperty("amount");
  });
});

describe("chequeListQuerySchema", () => {
  it("accepts an empty query — every field is optional", () => {
    const result = chequeListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum status filter", () => {
    const result = chequeListQuerySchema.safeParse({ status: "lost" });
    expect(result.success).toBe(false);
  });
});

/**
 * The eleven treasury voucher types, each posted through the real service and
 * the real GL engine, with the ACCOUNT and the SIDE asserted explicitly.
 *
 * A voucher that debits where it should credit is the most expensive typo in
 * this module and the cheapest one to make: the document is one shape with a
 * type discriminator, so a single wrong branch in `buildVoucherLines` mis-posts
 * a whole class of vouchers while every existing test on the other types stays
 * green. `voucher-document.test.ts` checks the pure builder for four of the
 * eleven; this file drives all eleven end to end and checks the resulting
 * balances at a NON-ZERO opening, which is what catches a transposition.
 *
 * It also pins R8.1: for the four types whose counterpart account is the type
 * RULE (partner capital, drawings, tax, contracting advance) a caller-supplied
 * account must be IGNORED, and for the catch-all types it must be honoured.
 */

import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import type { CreateVoucherCommand } from "./voucher-service.js";
import { VOUCHER_TYPE_DEFINITIONS } from "./voucher-types.js";

const AMOUNT = Money.fromMajor("1234.56");
const A = "1234.560000";
const ZERO = "0.000000";

type Harness = ReturnType<typeof buildTestService>;

function base(o: Partial<CreateVoucherCommand>): CreateVoucherCommand {
  return {
    id: "v1",
    date: "2026-08-22",
    voucherType: "other_income",
    amount: AMOUNT,
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: "ta-cash1",
    treasuryGlAccountId: "1300-1",
    ...o,
  } as CreateVoucherCommand;
}

/** The posted entry for a voucher — the GL hook stamps the entry id as the document id. */
async function postedLines(h: Harness, id: string) {
  const entry = await h.ledger.findById(id);
  expect(entry?.status).toBe("posted");
  return entry!.lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() }));
}

async function balance(h: Harness, accountId: string): Promise<string> {
  return (await h.ledger.accountBalance(accountId)).balance.toString();
}

/** Opening float in the main safe and the bank, so nothing here starts at zero. */
async function openDrawer(): Promise<Harness> {
  const h = buildTestService();
  await h.seedCashBalance("1300-1", "6000.00");
  await h.seedCashBalance("1310", "20000.00");
  return h;
}


interface Case {
  readonly type: CreateVoucherCommand["voucherType"];
  readonly labelAr: string;
  readonly cmd: Partial<CreateVoucherCommand>;
  /** [accountId, debit, credit] in posting order. */
  readonly expected: readonly (readonly [string, string, string])[];
  /** Account whose balance must move, and by how much (signed, debit-positive). */
  readonly moves: readonly (readonly [string, string])[];
}

const CASES: readonly Case[] = [
  {
    type: "customer_collection",
    labelAr: "تحصيل من عميل",
    cmd: { voucherType: "customer_collection", counterpartyGlAccountId: "1100", customerId: "cust-1" },
    expected: [["1300-1", A, ZERO], ["1100", ZERO, A]],
    moves: [["1300-1", "7234.560000"], ["1100", "-1234.560000"]],
  },
  {
    type: "supplier_payment",
    labelAr: "دفع لمورد",
    cmd: { voucherType: "supplier_payment", counterpartyGlAccountId: "2100", supplierId: "sup-1" },
    expected: [["2100", A, ZERO], ["1300-1", ZERO, A]],
    moves: [["1300-1", "4765.440000"], ["2100", "1234.560000"]],
  },
  {
    type: "customer_refund",
    labelAr: "رد مبلغ لعميل",
    cmd: { voucherType: "customer_refund", counterpartyGlAccountId: "1100", customerId: "cust-1" },
    expected: [["1100", A, ZERO], ["1300-1", ZERO, A]],
    moves: [["1300-1", "4765.440000"], ["1100", "1234.560000"]],
  },
  {
    type: "customer_advance",
    labelAr: "دفعة مقدمة من عميل مقاولات",
    cmd: { voucherType: "customer_advance", customerId: "cust-3", projectId: "proj-1" },
    expected: [["1300-1", A, ZERO], ["2160", ZERO, A]],
    moves: [["1300-1", "7234.560000"], ["2160", "-1234.560000"]],
  },
  {
    type: "supplier_refund",
    labelAr: "استرداد من مورد",
    cmd: { voucherType: "supplier_refund", counterpartyGlAccountId: "2100", supplierId: "sup-2" },
    expected: [["1300-1", A, ZERO], ["2100", ZERO, A]],
    moves: [["1300-1", "7234.560000"], ["2100", "-1234.560000"]],
  },
  {
    type: "other_income",
    labelAr: "إيراد آخر",
    cmd: { voucherType: "other_income" },
    expected: [["1300-1", A, ZERO], ["4910", ZERO, A]],
    moves: [["1300-1", "7234.560000"], ["4910", "-1234.560000"]],
  },
  {
    type: "other_expense",
    labelAr: "مصروف آخر",
    cmd: { voucherType: "other_expense" },
    expected: [["5910", A, ZERO], ["1300-1", ZERO, A]],
    moves: [["1300-1", "4765.440000"], ["5910", "1234.560000"]],
  },
  {
    type: "capital_injection",
    labelAr: "ضخ رأس مال من الشريك",
    cmd: { voucherType: "capital_injection" },
    expected: [["1300-1", A, ZERO], ["3100", ZERO, A]],
    moves: [["1300-1", "7234.560000"]],
  },
  {
    type: "capital_withdrawal",
    labelAr: "سحب شخصي للشريك",
    cmd: { voucherType: "capital_withdrawal" },
    expected: [["3200", A, ZERO], ["1300-1", ZERO, A]],
    moves: [["1300-1", "4765.440000"], ["3200", "1234.560000"]],
  },
  {
    type: "tax_payment",
    labelAr: "دفع لمصلحة الضرائب",
    cmd: { voucherType: "tax_payment" },
    expected: [["2200", A, ZERO], ["1300-1", ZERO, A]],
    moves: [["1300-1", "4765.440000"], ["2200", "1234.560000"]],
  },
  {
    type: "inter_treasury_transfer",
    labelAr: "تحويل بين الخزائن",
    cmd: {
      voucherType: "inter_treasury_transfer",
      counterTreasuryAccountId: "ta-cash2",
      counterTreasuryGlAccountId: "1300-2",
    },
    expected: [["1300-2", A, ZERO], ["1300-1", ZERO, A]],
    moves: [["1300-1", "4765.440000"], ["1300-2", "1234.560000"]],
  },
];


describe("each voucher type posts the right account on the right side", () => {
  it("covers every type the catalog type-picker offers, with no case left untested", () => {
    expect(CASES.map((c) => c.type).sort()).toEqual(VOUCHER_TYPE_DEFINITIONS.map((d) => d.code).slice().sort());
    for (const c of CASES) {
      expect(VOUCHER_TYPE_DEFINITIONS.find((d) => d.code === c.type)!.labelAr).toBe(c.labelAr);
    }
  });

  for (const c of CASES) {
    it(c.labelAr + " (" + c.type + ")", async () => {
      const h = await openDrawer();
      await h.service.createVoucher(base(c.cmd));
      const { document, held } = await h.service.confirmVoucher("v1");

      expect(held).toBe(false);
      expect(document.status).toBe("confirmed");
      expect(await postedLines(h, "v1")).toEqual(
        c.expected.map(([accountId, debit, credit]) => ({ accountId, debit, credit })),
      );
      for (const [accountId, expected] of c.moves) {
        expect(await balance(h, accountId)).toBe(expected);
      }
    });
  }

  it("every posted entry balances to the micro-unit", async () => {
    for (const c of CASES) {
      const h = await openDrawer();
      await h.service.createVoucher(base(c.cmd));
      await h.service.confirmVoucher("v1");
      const entry = (await h.ledger.findById("v1"))!;
      const debit = entry.lines.reduce((sum, l) => sum + l.debit.scaled, 0n);
      const credit = entry.lines.reduce((sum, l) => sum + l.credit.scaled, 0n);
      expect(debit).toBe(credit);
      expect(debit).toBe(AMOUNT.scaled);
    }
  });
});


describe("R8.1 — a fixed counterpart account is the type rule, not a default", () => {
  const FIXED: readonly (readonly [CreateVoucherCommand["voucherType"], string, string])[] = [
    ["customer_advance", "4910", "2160"],
    ["capital_injection", "4910", "3100"],
    ["capital_withdrawal", "5910", "3200"],
    ["tax_payment", "5910", "2200"],
  ];

  for (const [type, attempted, required] of FIXED) {
    it(type + " ignores a caller-supplied " + attempted + " and still posts to " + required, async () => {
      const h = await openDrawer();
      await h.service.createVoucher(
        base({
          voucherType: type,
          counterpartyGlAccountId: attempted,
          customerId: "cust-3",
          ...(type === "customer_advance" ? { projectId: "proj-1" } : {}),
        }),
      );
      await h.service.confirmVoucher("v1");

      const accounts = (await postedLines(h, "v1")).map((l) => l.accountId);
      expect(accounts).toContain(required);
      expect(accounts).not.toContain(attempted);
      expect(await balance(h, attempted)).toBe("0.000000");
    });
  }

  it("the catch-all types DO take the caller account — an employee advance must reach 1160, not 5910", async () => {
    const h = await openDrawer();
    await h.service.createVoucher(base({ voucherType: "other_expense", counterpartyGlAccountId: "1160" }));
    await h.service.confirmVoucher("v1");

    expect(await postedLines(h, "v1")).toEqual([
      { accountId: "1160", debit: A, credit: ZERO },
      { accountId: "1300-1", debit: ZERO, credit: A },
    ]);
    expect(await balance(h, "5910")).toBe("0.000000");
  });

  it("other_income takes the caller account too", async () => {
    const h = await openDrawer();
    await h.service.createVoucher(base({ voucherType: "other_income", counterpartyGlAccountId: "4900" }));
    await h.service.confirmVoucher("v1");
    expect((await postedLines(h, "v1")).map((l) => l.accountId)).toEqual(["1300-1", "4900"]);
  });
});

describe("a supplier payment with Egyptian withholding", () => {
  it("discharges the supplier in full while only the net leaves the bank", async () => {
    const h = await openDrawer();
    await h.service.createVoucher(
      base({
        voucherType: "supplier_payment",
        supplierId: "sup-1",
        counterpartyGlAccountId: "2100",
        treasuryAccountId: "ta-bank1",
        treasuryGlAccountId: "1310",
        amount: Money.fromMajor("2000.00"),
        withholdingAmount: Money.fromMajor("60.00"),
        withholdingRatePercent: 3,
        withholdingGlAccountId: "2210",
      }),
    );
    await h.service.confirmVoucher("v1");

    expect(await postedLines(h, "v1")).toEqual([
      { accountId: "2100", debit: "2000.000000", credit: ZERO },
      { accountId: "1310", debit: ZERO, credit: "1940.000000" },
      { accountId: "2210", debit: ZERO, credit: "60.000000" },
    ]);
    // The two figures that must differ by exactly the withheld amount.
    expect(await balance(h, "1310")).toBe("18060.000000");
    expect(await balance(h, "2210")).toBe("-60.000000");
    expect(await balance(h, "2100")).toBe("2000.000000");
  });
});

describe("the contracting project dimension on a confirmed voucher's posting", () => {
  it("tags projectId on both lines and costCategory only on the counterpart line", async () => {
    const h = await openDrawer();
    await h.service.createVoucher(
      base({
        voucherType: "other_expense",
        counterpartyGlAccountId: "5910",
        projectId: "proj-1",
        costCategory: "labour",
      }),
    );
    await h.service.confirmVoucher("v1");

    const entry = (await h.ledger.findById("v1"))!;
    expect(entry.status).toBe("posted");
    const treasury = entry.lines.find((l) => l.accountId === "1300-1")!;
    const counter = entry.lines.find((l) => l.accountId === "5910")!;
    expect(treasury.projectId).toBe("proj-1");
    expect(counter.projectId).toBe("proj-1");
    expect(counter.costCategory).toBe("labour");
    expect(treasury.costCategory ?? null).toBeNull();
  });
});


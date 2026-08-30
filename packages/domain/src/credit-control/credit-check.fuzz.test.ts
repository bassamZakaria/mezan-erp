import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money } from "../money/index.js";
import { checkCustomerCredit } from "./credit-check.js";

const moneyArb = fc.bigInt({ min: 0n, max: 10n ** 14n }).map((s) => Money.fromScaled(s));
const modeArb = fc.constantFrom("WARNING" as const, "BLOCK" as const);

describe("customer credit control — fuzz", () => {
  it("fuzz: the projected balance is always exactly balance plus this invoice", () => {
    fc.assert(
      fc.property(fc.boolean(), modeArb, moneyArb, moneyArb, moneyArb, (enabled, mode, creditLimit, currentBalance, newExposure) => {
        const result = checkCustomerCredit({ enabled, mode, creditLimit, currentBalance, newExposure });
        expect(result.projectedBalance.scaled).toBe(currentBalance.scaled + newExposure.scaled);
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: control switched off never refuses and never warns", () => {
    fc.assert(
      fc.property(modeArb, moneyArb, moneyArb, moneyArb, (mode, creditLimit, currentBalance, newExposure) => {
        const result = checkCustomerCredit({ enabled: false, mode, creditLimit, currentBalance, newExposure });
        expect(result.status).toBe("ok");
        expect(result.overBy.scaled).toBe(0n);
        expect(result.message).toBeNull();
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: a zero limit means unlimited, never 'block everything'", () => {
    fc.assert(
      fc.property(modeArb, moneyArb, moneyArb, (mode, currentBalance, newExposure) => {
        const result = checkCustomerCredit({
          enabled: true,
          mode,
          creditLimit: Money.zero(),
          currentBalance,
          newExposure,
        });
        expect(result.status).toBe("ok");
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: exactly at the limit is allowed; one micro-unit over is not", () => {
    fc.assert(
      fc.property(modeArb, fc.bigInt({ min: 1n, max: 10n ** 13n }), (mode, limitMicro) => {
        const atLimit = checkCustomerCredit({
          enabled: true,
          mode,
          creditLimit: Money.fromScaled(limitMicro),
          currentBalance: Money.fromScaled(limitMicro),
          newExposure: Money.zero(),
        });
        expect(atLimit.status).toBe("ok");

        const overByOne = checkCustomerCredit({
          enabled: true,
          mode,
          creditLimit: Money.fromScaled(limitMicro),
          currentBalance: Money.fromScaled(limitMicro),
          newExposure: Money.fromScaled(1n),
        });
        expect(overByOne.status).toBe(mode === "BLOCK" ? "blocked" : "warning");
        expect(overByOne.overBy.scaled).toBe(1n);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: WARNING never blocks and BLOCK always blocks, for the same numbers", () => {
    fc.assert(
      fc.property(moneyArb, moneyArb, moneyArb, (creditLimit, currentBalance, newExposure) => {
        const warn = checkCustomerCredit({ enabled: true, mode: "WARNING", creditLimit, currentBalance, newExposure });
        const block = checkCustomerCredit({ enabled: true, mode: "BLOCK", creditLimit, currentBalance, newExposure });

        expect(warn.status).not.toBe("blocked");
        expect(warn.projectedBalance.scaled).toBe(block.projectedBalance.scaled);
        expect(warn.overBy.scaled).toBe(block.overBy.scaled);
        if (warn.status === "warning") expect(block.status).toBe("blocked");
        if (warn.status === "ok") expect(block.status).toBe("ok");
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: the excess is exactly the shortfall, and zero whenever the sale is allowed", () => {
    fc.assert(
      fc.property(modeArb, moneyArb, moneyArb, moneyArb, (mode, creditLimit, currentBalance, newExposure) => {
        const result = checkCustomerCredit({ enabled: true, mode, creditLimit, currentBalance, newExposure });
        const projected = currentBalance.scaled + newExposure.scaled;
        if (creditLimit.scaled > 0n && projected > creditLimit.scaled) {
          expect(result.overBy.scaled).toBe(projected - creditLimit.scaled);
        } else {
          expect(result.overBy.scaled).toBe(0n);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("fuzz: the refusal always names the excess, the limit and the projected balance, in Arabic", () => {
    fc.assert(
      fc.property(
        modeArb,
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        (mode, limitMicro, overMicro) => {
          const creditLimit = Money.fromScaled(limitMicro);
          const currentBalance = Money.fromScaled(limitMicro + overMicro);
          const result = checkCustomerCredit({
            enabled: true,
            mode,
            creditLimit,
            currentBalance,
            newExposure: Money.zero(),
          });
          expect(result.message).not.toBeNull();
          const message = result.message as string;
          expect(message).toContain(Money.fromScaled(overMicro).toString());
          expect(message).toContain(creditLimit.toString());
          expect(message).toContain(currentBalance.toString());
          expect(/[؀-ۿ]/.test(message)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fuzz: a larger invoice is never treated more leniently than a smaller one", () => {
    fc.assert(
      fc.property(modeArb, moneyArb, moneyArb, moneyArb, moneyArb, (mode, creditLimit, currentBalance, a, b) => {
        const [small, large] = a.scaled <= b.scaled ? [a, b] : [b, a];
        const rank = { ok: 0, warning: 1, blocked: 2 } as const;
        const smaller = checkCustomerCredit({ enabled: true, mode, creditLimit, currentBalance, newExposure: small });
        const larger = checkCustomerCredit({ enabled: true, mode, creditLimit, currentBalance, newExposure: large });
        expect(rank[larger.status]).toBeGreaterThanOrEqual(rank[smaller.status]);
      }),
      { numRuns: 500 },
    );
  });
});

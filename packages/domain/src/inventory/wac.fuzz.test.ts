import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Money, Qty } from "../money/index.js";
import { extend, unitCostOf } from "./wac-math.js";
import type { StockMovement } from "./movement.js";
import { replay, runningBalance } from "./wac.js";

const ITEM = "ITEM-FUZZ";
const WAREHOUSE = "WH-FUZZ";

type Step =
  | { kind: "IN"; qtyMicro: bigint; unitCostMicro: bigint }
  | { kind: "OUT"; fraction: number }
  | { kind: "REVALUE"; valueMicro: bigint };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: fc.record({
    kind: fc.constant("IN" as const),
    qtyMicro: fc.bigInt({ min: 1_000n, max: 5_000_000_000n }),
    unitCostMicro: fc.bigInt({ min: 1_000n, max: 500_000_000n }),
  }) },
  { weight: 2, arbitrary: fc.record({
    kind: fc.constant("OUT" as const),
    fraction: fc.double({ min: 0.01, max: 1, noNaN: true, noDefaultInfinity: true }),
  }) },
  { weight: 1, arbitrary: fc.record({
    kind: fc.constant("REVALUE" as const),
    valueMicro: fc.bigInt({ min: 1n, max: 100_000_000n }),
  }) },
);

/**
 * Build a ledger that never issues more than is on hand — the sequence a real
 * tenant can actually produce. Each OUT takes a fraction of the current
 * balance, so the generated history stays legal however the fractions land.
 */
function buildLedger(steps: readonly Step[]): StockMovement[] {
  const movements: StockMovement[] = [];
  let onHand = 0n;
  let lastInDocId: string | null = null;
  let index = 0;

  for (const step of steps) {
    const occurredAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
    if (step.kind === "IN") {
      const docId = `DOC-IN-${index}`;
      movements.push({
        id: `MOV-${index}`,
        itemId: ITEM,
        warehouseId: WAREHOUSE,
        direction: "IN",
        qty: Qty.fromScaled(step.qtyMicro),
        unitCost: Money.fromScaled(step.unitCostMicro),
        sourceDocType: "PURCHASE_RECEIPT",
        sourceDocId: docId,
        sourceDocNumber: null,
        reason: null,
        occurredAt,
      });
      onHand += step.qtyMicro;
      lastInDocId = docId;
    } else if (step.kind === "OUT") {
      if (onHand <= 0n) continue;
      const take = BigInt(Math.max(1, Math.floor(Number(onHand) * step.fraction)));
      const qty = take > onHand ? onHand : take;
      movements.push({
        id: `MOV-${index}`,
        itemId: ITEM,
        warehouseId: WAREHOUSE,
        direction: "OUT",
        qty: Qty.fromScaled(qty),
        unitCost: Money.zero(),
        sourceDocType: "SALES_INVOICE",
        sourceDocId: `DOC-OUT-${index}`,
        sourceDocNumber: null,
        reason: null,
        occurredAt,
      });
      onHand -= qty;
    } else {
      if (!lastInDocId) continue;
      movements.push({
        id: `MOV-${index}`,
        itemId: ITEM,
        warehouseId: WAREHOUSE,
        direction: "IN",
        qty: Qty.zero(),
        unitCost: Money.zero(),
        sourceDocType: "LANDED_COST",
        sourceDocId: `DOC-LC-${index}`,
        sourceDocNumber: null,
        reason: null,
        occurredAt,
        valueDelta: Money.fromScaled(step.valueMicro),
        revaluesSourceDocId: lastInDocId,
      });
    }
    index++;
  }
  return movements;
}

const ledgerArb = fc.array(stepArb, { minLength: 1, maxLength: 30 }).map(buildLedger);

describe("weighted-average costing — fuzz", () => {
  it("fuzz: on-hand always equals the signed sum of the ledger, and is never negative", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const position = replay(ITEM, WAREHOUSE, movements);
        expect(position.onHand.scaled).toBe(runningBalance(movements).scaled);
        expect(position.onHand.isNegative()).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: replay is deterministic — the same ledger always yields the same position", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const first = replay(ITEM, WAREHOUSE, movements);
        const second = replay(ITEM, WAREHOUSE, movements);
        expect(second.onHand.scaled).toBe(first.onHand.scaled);
        expect(second.totalValue.scaled).toBe(first.totalValue.scaled);
        expect(second.averageCost.scaled).toBe(first.averageCost.scaled);
        expect(second.layers.map((l) => l.id)).toEqual(first.layers.map((l) => l.id));
      }),
      { numRuns: 200 },
    );
  });

  it("fuzz: the surviving layers always hold exactly the on-hand quantity", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const position = replay(ITEM, WAREHOUSE, movements);
        const inLayers = Qty.sum(position.layers.map((l) => l.remainingQty));
        expect(inLayers.scaled).toBe(position.onHand.scaled);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: the reported average is exactly value ÷ quantity, and zero for an empty position", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const position = replay(ITEM, WAREHOUSE, movements);
        expect(position.averageCost.scaled).toBe(unitCostOf(position.totalValue, position.onHand).scaled);
        if (position.onHand.isZero()) expect(position.averageCost.scaled).toBe(0n);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a drained position keeps no more than the rounding residue of its own drain", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const position = replay(ITEM, WAREHOUSE, movements);
        if (!position.onHand.isZero()) return;
        // The average is zero by definition once the quantity is, so it hides
        // this: only the VALUE says whether anything was orphaned onto an
        // empty position.
        //
        // A landed cost booked AFTER the stock is gone used to be excluded
        // here (D135): a whole freight invoice landed on nothing and the
        // exclusion hid it. Its unabsorbable share is now split off into
        // `unabsorbedRevaluation`, so a drained position holds nothing but
        // the rounding residue of its own drain, whatever the ledger held.
        const residue = position.totalValue.scaled < 0n ? -position.totalValue.scaled : position.totalValue.scaled;
        // THE BOUND SCALES WITH THE QUANTITY DRAINED, NOT THE MOVEMENT COUNT.
        //
        // `movements.length + 1` was the wrong shape and this suite proved it,
        // intermittently: an issue is valued at `qty × round(value ÷ qty)`, and
        // the unit cost is rounded to 1e-6, so a single issue can strand up to
        // half a micro-unit of currency PER UNIT OF QUANTITY. Draining 13.11
        // units in one movement therefore leaves up to ~6 micro-currency
        // against a bound of 4, and the property failed roughly one run in
        // eight — which is the worst kind of red, because it trains a reader to
        // re-run rather than to look.
        //
        // This is the honest arithmetic of a rounded average, not a weakened
        // assertion: the residue is still bounded, still tiny (six millionths
        // of one pound on a position that held 2,546), and still asserted. That
        // a fully drained position keeps ANY value at all is tracked as its own
        // defect — the standard fix is for a drain-to-zero to take the whole
        // remaining value — and is deliberately not changed here, because the
        // GL posts COGS from the same figure and moving one without the other
        // would break the reconciliation this suite also guards.
        const issued = movements
          .filter((m) => m.direction === "OUT")
          .reduce((sum, m) => sum + m.qty.scaled, 0n);
        const roundingRoom = issued / 2_000_000n + BigInt(movements.length + 1);
        expect(residue <= roundingRoom).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  describe("a landed cost that arrives after the stock has been sold (D135)", () => {
    /**
     * The freight invoice almost never arrives with the goods. By the time it
     * is booked, a fast-moving item may already be sold out. The cost then
     * belongs to the units that BORE it — which have left — so only the share
     * still represented by on-hand quantity may be capitalised; the rest is a
     * period cost the caller must post (see `WacPosition.unabsorbedRevaluation`).
     */
    const receipt = (id: string, docId: string, qty: string, unitCost: string, at: string): StockMovement => ({
      id,
      itemId: ITEM,
      warehouseId: WAREHOUSE,
      direction: "IN",
      qty: Qty.fromMajor(qty),
      unitCost: Money.fromMajor(unitCost),
      sourceDocType: "PURCHASE_RECEIPT",
      sourceDocId: docId,
      sourceDocNumber: null,
      reason: null,
      occurredAt: at,
    });

    const issue = (id: string, qty: string, at: string): StockMovement => ({
      id,
      itemId: ITEM,
      warehouseId: WAREHOUSE,
      direction: "OUT",
      qty: Qty.fromMajor(qty),
      unitCost: Money.zero(),
      sourceDocType: "SALES_INVOICE",
      sourceDocId: id,
      sourceDocNumber: null,
      reason: null,
      occurredAt: at,
    });

    const freight = (id: string, revalues: string, amount: string, at: string): StockMovement => ({
      id,
      itemId: ITEM,
      warehouseId: WAREHOUSE,
      direction: "IN",
      qty: Qty.zero(),
      unitCost: Money.zero(),
      sourceDocType: "LANDED_COST",
      sourceDocId: id,
      sourceDocNumber: null,
      reason: null,
      occurredAt: at,
      valueDelta: Money.fromMajor(amount),
      revaluesSourceDocId: revalues,
    });

    const DRAINED_THEN_REVALUED: StockMovement[] = [
      receipt("IN-1", "PR-1", "100", "10", "2026-01-01T00:00:00.000Z"),
      issue("OUT-1", "100", "2026-01-02T00:00:00.000Z"),
      freight("LC-1", "PR-1", "250", "2026-01-03T00:00:00.000Z"),
    ];

    const drainedThenRevalued = () => replay(ITEM, WAREHOUSE, DRAINED_THEN_REVALUED);

    it("GUARANTEE (D135): nothing is capitalised onto a position holding nothing", () => {
      const position = drainedThenRevalued();

      expect(position.onHand.toString()).toBe("0.000000");
      // Zero units can carry zero cost. The 250.00 of freight belongs to the
      // 100 units that already shipped.
      expect(position.totalValue.toString()).toBe("0.000000");
    });

    it("GUARANTEE (D135): the whole 250.00 is reported as unabsorbed, not swallowed", () => {
      // Dropping it from inventory without reporting it would just move the
      // silence. This is the figure the landed-cost posting must send to cost
      // of sales instead of inventory.
      const position = drainedThenRevalued();
      expect(position.unabsorbedRevaluation.toString()).toBe("250.000000");
    });

    it("GUARANTEE (D135): the next receipt costs at what it actually cost", () => {
      // Buying 10 more at 10.00 gives a position worth 100.00 at 10.00 each.
      // Before the fix the orphaned freight rode along and every one of those
      // 10 units carried 35.00 — a 250% overstatement of cost of sales on
      // goods that never bore the freight.
      const position = replay(ITEM, WAREHOUSE, [
        ...DRAINED_THEN_REVALUED,
        receipt("IN-2", "PR-2", "10", "10", "2026-01-04T00:00:00.000Z"),
      ]);

      expect(position.onHand.toString()).toBe("10.000000");
      expect(position.totalValue.toString()).toBe("100.000000");
      expect(position.averageCost.toString()).toBe("10.000000");
      expect(position.unabsorbedRevaluation.toString()).toBe("250.000000");
    });

    it("GUARANTEE (D135): a partly-sold receipt absorbs only the on-hand share", () => {
      // 100 received at 10.00, 60 sold, then 250.00 of freight on that receipt.
      // 40 units remain, so 40/100 of 250.00 = 100.00 stays in inventory and
      // 150.00 belongs to the 60 units already in cost of sales. The unit cost
      // of what remains is still 12.50 — the same landed cost per unit the
      // whole shipment bore.
      const position = replay(ITEM, WAREHOUSE, [
        receipt("IN-1", "PR-1", "100", "10", "2026-01-01T00:00:00.000Z"),
        issue("OUT-1", "60", "2026-01-02T00:00:00.000Z"),
        freight("LC-1", "PR-1", "250", "2026-01-03T00:00:00.000Z"),
      ]);

      expect(position.onHand.toString()).toBe("40.000000");
      expect(position.totalValue.toString()).toBe("500.000000");
      expect(position.averageCost.toString()).toBe("12.500000");
      expect(position.unabsorbedRevaluation.toString()).toBe("150.000000");
      // The layers must agree with the position, or the valuation report and
      // the cost-layer screen show two different inventories.
      expect(Money.sum(position.layers.map((l) => extend(l.remainingQty, l.unitCost))).toString()).toBe(
        "500.000000",
      );
    });

    it("GUARANTEE (D135): freight on a receipt already consumed never lands on a LATER one", () => {
      // PR-1 is sold out; PR-2 is untouched. The freight belongs to PR-1s
      // goods, so PR-2 units must still cost exactly 10.00 each.
      const position = replay(ITEM, WAREHOUSE, [
        receipt("IN-1", "PR-1", "100", "10", "2026-01-01T00:00:00.000Z"),
        issue("OUT-1", "100", "2026-01-02T00:00:00.000Z"),
        receipt("IN-2", "PR-2", "50", "10", "2026-01-03T00:00:00.000Z"),
        freight("LC-1", "PR-1", "250", "2026-01-04T00:00:00.000Z"),
      ]);

      expect(position.onHand.toString()).toBe("50.000000");
      expect(position.totalValue.toString()).toBe("500.000000");
      expect(position.averageCost.toString()).toBe("10.000000");
      expect(position.unabsorbedRevaluation.toString()).toBe("250.000000");
    });

    it("still applies the landed cost in full while the stock IS on hand (the negative control)", () => {
      // The mechanism is right; only the drained case was wrong. A guard that
      // refused every landed cost would break the feature instead of fixing it.
      const position = replay(ITEM, WAREHOUSE, [
        receipt("IN-1", "PR-1", "100", "10", "2026-01-01T00:00:00.000Z"),
        freight("LC-1", "PR-1", "250", "2026-01-02T00:00:00.000Z"),
      ]);

      expect(position.onHand.toString()).toBe("100.000000");
      expect(position.totalValue.toString()).toBe("1250.000000");
      expect(position.averageCost.toString()).toBe("12.500000");
      expect(position.unabsorbedRevaluation.toString()).toBe("0.000000");
    });

    it("GUARANTEE (D135): a landed cost naming a document the ledger never received under still capitalises onto stock on hand", () => {
      // The ordinary purchase flow names the purchase INVOICE while the layer
      // carries the goods RECEIPT, so no layer matches. There is then
      // nothing to apportion against and the position itself is the basis:
      // 100 units on hand carry the whole 500, exactly as before. Classing an
      // unmatched revaluation as unabsorbed instead left the stock sub-ledger
      // 500 short of GL 1200 on the COMMON path.
      const position = replay(ITEM, WAREHOUSE, [
        receipt("IN-1", "GRN-1", "100", "10", "2026-01-01T00:00:00.000Z"),
        freight("LC-1", "PI-1", "500", "2026-01-02T00:00:00.000Z"),
      ]);

      expect(position.onHand.toString()).toBe("100.000000");
      expect(position.totalValue.toString()).toBe("1500.000000");
      expect(position.averageCost.toString()).toBe("15.000000");
      expect(position.unabsorbedRevaluation.toString()).toBe("0.000000");
    });

    it("GUARANTEE (D135): the same unmatched landed cost is expensed when the position is empty", () => {
      // The negative control for the fallback above: with no layer to point at
      // AND nothing on hand, the only honest answer is that the cost belongs
      // to goods already sold. Capitalising it here is the original defect.
      const position = replay(ITEM, WAREHOUSE, [
        receipt("IN-1", "GRN-1", "100", "10", "2026-01-01T00:00:00.000Z"),
        issue("OUT-1", "100", "2026-01-02T00:00:00.000Z"),
        freight("LC-1", "PI-1", "500", "2026-01-03T00:00:00.000Z"),
      ]);

      expect(position.onHand.toString()).toBe("0.000000");
      expect(position.totalValue.toString()).toBe("0.000000");
      expect(position.unabsorbedRevaluation.toString()).toBe("500.000000");
    });
  });

  it("fuzz: the average always re-multiplies back to the position's value", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const position = replay(ITEM, WAREHOUSE, movements);
        if (position.onHand.isZero()) return;
        const implied = extend(position.onHand, position.averageCost);
        const drift = implied.scaled - position.totalValue.scaled;
        // The average is rounded to a micro-unit, so re-multiplying it by the
        // quantity can only return the value to half a micro-unit per unit held.
        const tolerance = position.onHand.scaled / 2_000_000n + 2n;
        expect(drift >= -tolerance && drift <= tolerance).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("fuzz: an issue barely moves the average of a position holding whole units", () => {
    fc.assert(
      fc.property(ledgerArb, fc.double({ min: 0.01, max: 0.99, noNaN: true, noDefaultInfinity: true }), (movements, fraction) => {
        const before = replay(ITEM, WAREHOUSE, movements);
        if (before.onHand.scaled < 2_000_000n) return;
        const take = BigInt(Math.max(1, Math.floor(Number(before.onHand.scaled) * fraction)));
        const qty = take >= before.onHand.scaled ? before.onHand.scaled - 1n : take;

        const after = replay(ITEM, WAREHOUSE, [
          ...movements,
          {
            id: "MOV-ISSUE",
            itemId: ITEM,
            warehouseId: WAREHOUSE,
            direction: "OUT",
            qty: Qty.fromScaled(qty),
            unitCost: Money.zero(),
            sourceDocType: "SALES_INVOICE",
            sourceDocId: "DOC-ISSUE",
            sourceDocNumber: null,
            reason: null,
            occurredAt: "2026-02-01T00:00:00.000Z",
          },
        ]);

        // An issue leaves the average alone in exact arithmetic; what survives
        // is the rounding the remaining quantity can carry — one micro-unit of
        // VALUE spread over what is left.
        const remaining = after.onHand.scaled;
        if (remaining < 1_000_000n) return;
        const drift = after.averageCost.scaled - before.averageCost.scaled;
        // The issue leaves at the rounded average, so the value it removes can
        // be off by half a micro-unit per unit issued; what remains carries
        // that error spread over the surviving quantity.
        const tolerance = before.onHand.scaled / remaining + 2n;
        expect(drift >= -tolerance && drift <= tolerance).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: a receipt moves the average toward the receipt price, never past it", () => {
    fc.assert(
      fc.property(
        ledgerArb,
        fc.bigInt({ min: 1n, max: 5_000_000_000n }),
        fc.bigInt({ min: 1n, max: 500_000_000n }),
        (movements, qtyMicro, unitCostMicro) => {
          const before = replay(ITEM, WAREHOUSE, movements);
          if (before.onHand.scaled <= 0n) return;

          const after = replay(ITEM, WAREHOUSE, [
            ...movements,
            {
              id: "MOV-RECEIPT",
              itemId: ITEM,
              warehouseId: WAREHOUSE,
              direction: "IN",
              qty: Qty.fromScaled(qtyMicro),
              unitCost: Money.fromScaled(unitCostMicro),
              sourceDocType: "PURCHASE_RECEIPT",
              sourceDocId: "DOC-RECEIPT",
              sourceDocNumber: null,
              reason: null,
              occurredAt: "2026-02-01T00:00:00.000Z",
            },
          ]);

          const lo = before.averageCost.scaled < unitCostMicro ? before.averageCost.scaled : unitCostMicro;
          const hi = before.averageCost.scaled < unitCostMicro ? unitCostMicro : before.averageCost.scaled;
          expect(after.averageCost.scaled >= lo - 1n && after.averageCost.scaled <= hi + 1n).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fuzz: a revaluation is conserved between inventory and the unabsorbed bucket", () => {
    fc.assert(
      fc.property(ledgerArb, fc.bigInt({ min: 1n, max: 100_000_000n }), (movements, valueMicro) => {
        const receipt = movements.find((m) => m.direction === "IN" && m.qty.scaled > 0n);
        if (!receipt) return;
        const before = replay(ITEM, WAREHOUSE, movements);

        const after = replay(ITEM, WAREHOUSE, [
          ...movements,
          {
            id: "MOV-LC",
            itemId: ITEM,
            warehouseId: WAREHOUSE,
            direction: "IN",
            qty: Qty.zero(),
            unitCost: Money.zero(),
            sourceDocType: "LANDED_COST",
            sourceDocId: "DOC-LC",
            sourceDocNumber: null,
            reason: null,
            occurredAt: "2026-02-01T00:00:00.000Z",
            valueDelta: Money.fromScaled(valueMicro),
            revaluesSourceDocId: receipt.sourceDocId,
          },
        ]);

        expect(after.onHand.scaled).toBe(before.onHand.scaled);
        // A landed cost is CONSERVED, not unconditionally capitalised: the
        // share the remaining goods can still carry raises inventory value,
        // and the share belonging to goods already issued is reported as
        // unabsorbed for the caller to expense (D135). Nothing is invented
        // and nothing is lost between the two.
        expect(after.totalValue.scaled + after.unabsorbedRevaluation.scaled).toBe(
          before.totalValue.scaled + before.unabsorbedRevaluation.scaled + valueMicro,
        );
        // It can never raise inventory by MORE than it was worth, nor lower it.
        expect(after.totalValue.scaled <= before.totalValue.scaled + valueMicro).toBe(true);
        expect(after.totalValue.scaled >= before.totalValue.scaled).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: emptying a position leaves a residual value no larger than the number of issues", () => {
    fc.assert(
      fc.property(ledgerArb, (movements) => {
        const position = replay(ITEM, WAREHOUSE, movements);
        if (position.onHand.scaled <= 0n) return;

        const drained = replay(ITEM, WAREHOUSE, [
          ...movements,
          {
            id: "MOV-DRAIN",
            itemId: ITEM,
            warehouseId: WAREHOUSE,
            direction: "OUT",
            qty: position.onHand,
            unitCost: Money.zero(),
            sourceDocType: "SALES_INVOICE",
            sourceDocId: "DOC-DRAIN",
            sourceDocNumber: null,
            reason: null,
            occurredAt: "2026-02-01T00:00:00.000Z",
          },
        ]);

        expect(drained.onHand.scaled).toBe(0n);
        expect(drained.layers).toHaveLength(0);
        // The last issue leaves at the rounded average, so what remains is the
        // rounding on that one multiplication: at most half a micro-unit per
        // whole unit drained.
        const residue = drained.totalValue.scaled < 0n ? -drained.totalValue.scaled : drained.totalValue.scaled;
        const wholeUnits = position.onHand.scaled / 1_000_000n;
        expect(residue <= wholeUnits + 1n).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("costing arithmetic — fuzz", () => {
  it("fuzz: extend is exact repeated addition for whole quantities", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.bigInt({ min: 0n, max: 10n ** 9n }), (units, unitCostMicro) => {
        const qty = Qty.fromScaled(BigInt(units) * 1_000_000n);
        const cost = Money.fromScaled(unitCostMicro);
        expect(extend(qty, cost).scaled).toBe(BigInt(units) * unitCostMicro);
      }),
      { numRuns: 300 },
    );
  });

  it("fuzz: extend and unitCostOf round-trip within the precision the quantity affords", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 10n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (qtyMicro, unitCostMicro) => {
          const qty = Qty.fromScaled(qtyMicro);
          const value = extend(qty, Money.fromScaled(unitCostMicro));
          const back = unitCostOf(value, qty);
          const drift = back.scaled - unitCostMicro;
          // Extension rounds the VALUE to a micro-unit, so dividing it back can
          // only recover the unit cost to one micro-unit per unit of quantity.
          const tolerance = 1_000_000n / qtyMicro + 1n;
          expect(drift >= -tolerance && drift <= tolerance).toBe(true);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("fuzz: a whole-unit quantity round-trips its unit cost exactly", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        (units, unitCostMicro) => {
          const qty = Qty.fromScaled(BigInt(units) * 1_000_000n);
          const value = extend(qty, Money.fromScaled(unitCostMicro));
          expect(unitCostOf(value, qty).scaled).toBe(unitCostMicro);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("fuzz: reversing a movement is the exact negative of it", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 10n), max: 10n ** 10n }),
        fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }),
        (qtyMicro, unitCostMicro) => {
          const forward = extend(Qty.fromScaled(qtyMicro), Money.fromScaled(unitCostMicro));
          const reverse = extend(Qty.fromScaled(-qtyMicro), Money.fromScaled(unitCostMicro));
          expect(reverse.scaled).toBe(-forward.scaled);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("fuzz: a zero quantity has no unit cost rather than a division error", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (valueMicro) => {
        expect(unitCostOf(Money.fromScaled(valueMicro), Qty.zero()).scaled).toBe(0n);
      }),
      { numRuns: 200 },
    );
  });
});

describe("a revaluation that names a receipt whose layers are gone (D84)", () => {
  const receipt: StockMovement = {
    id: "MOV-IN",
    itemId: ITEM,
    warehouseId: WAREHOUSE,
    direction: "IN",
    qty: Qty.fromMajor("10"),
    unitCost: Money.fromMajor("5"),
    sourceDocType: "PURCHASE_RECEIPT",
    sourceDocId: "DOC-PI-1",
    sourceDocNumber: "PI-000001",
    reason: null,
    occurredAt: "2026-01-01T00:00:00.000Z",
  };

  const drain: StockMovement = {
    id: "MOV-OUT",
    itemId: ITEM,
    warehouseId: WAREHOUSE,
    direction: "OUT",
    qty: Qty.fromMajor("10"),
    unitCost: Money.zero(),
    sourceDocType: "SALES_INVOICE",
    sourceDocId: "DOC-SI-1",
    sourceDocNumber: "INV-000001",
    reason: null,
    occurredAt: "2026-01-02T00:00:00.000Z",
  };

  const landedCost: StockMovement = {
    id: "MOV-LC",
    itemId: ITEM,
    warehouseId: WAREHOUSE,
    direction: "IN",
    qty: Qty.zero(),
    unitCost: Money.zero(),
    sourceDocType: "LANDED_COST",
    sourceDocId: "DOC-LC-1",
    sourceDocNumber: "LC-000001",
    reason: null,
    occurredAt: "2026-01-03T00:00:00.000Z",
    valueDelta: Money.fromMajor("100"),
    revaluesSourceDocId: "DOC-PI-1",
  };

  it("GUARANTEE (D84): the value does NOT land on a position with nothing in it", () => {
    const position = replay(ITEM, WAREHOUSE, [receipt, drain, landedCost]);

    // Everything was sold before the freight invoice arrived, so the layer the
    // landed cost names no longer exists.
    expect(position.onHand.scaled).toBe(0n);
    expect(position.layers).toHaveLength(0);

    // The cost belongs to the sold goods, so inventory carries none of it and
    // the whole 100.00 is reported for the caller to post to cost of sales.
    // Capitalising it left 100.00 of inventory value with no units behind it,
    // invisible because the average of zero units is zero.
    expect(position.totalValue.toString()).toBe("0.000000");
    expect(position.averageCost.scaled).toBe(0n);
    expect(position.unabsorbedRevaluation.toString()).toBe("100.000000");
  });

  it("bumps the layer correctly when the goods are still there, which is the path that works", () => {
    const position = replay(ITEM, WAREHOUSE, [receipt, landedCost]);

    expect(position.onHand.toString()).toBe("10.000000");
    expect(position.totalValue.toString()).toBe("150.000000");
    expect(position.averageCost.toString()).toBe("15.000000");
    expect(position.layers).toHaveLength(1);
    expect(position.layers[0]?.unitCost.toString()).toBe("15.000000");
  });

  it("GUARANTEE (D84): a partial drain splits the freight over sold and unsold units", () => {
    const halfDrain: StockMovement = { ...drain, id: "MOV-OUT-HALF", qty: Qty.fromMajor("6") };
    const position = replay(ITEM, WAREHOUSE, [receipt, halfDrain, landedCost]);

    // Four of the ten units remain, so they carry 4/10 of the 100.00 — their
    // unit cost rises from 5.00 to 15.00, the same landed cost per unit the
    // whole shipment bore. The 60.00 belonging to the six already sold is
    // reported for the caller to expense. Loading all 100.00 onto the four
    // survivors put their cost at 30.00, double what they actually cost.
    expect(position.onHand.toString()).toBe("4.000000");
    expect(position.layers[0]?.unitCost.toString()).toBe("15.000000");
    expect(position.totalValue.toString()).toBe("60.000000");
    expect(position.averageCost.toString()).toBe("15.000000");
    expect(position.unabsorbedRevaluation.toString()).toBe("60.000000");
  });
});

describe("an issue leaves at the cost the LEDGER recorded, not a freshly recomputed one", () => {
  /**
   * `wac.ts` says this in its own comment: recomputing instead made replay
   * disagree with the live engine for any document entered out of date order —
   * a backdated sale, or a landed cost dated after a sale that had already
   * consumed the revalued stock. Nothing tested it, so a change back to
   * recomputation went unnoticed until a mutation run found it.
   *
   * Every OUT below carries a NON-ZERO unitCost, which is what makes the two
   * behaviours distinguishable: a movement with a zero cost falls through to
   * the recompute path by design.
   */
  const receipt = (id: string, qty: string, unitCost: string, at: string): StockMovement => ({
    id,
    itemId: ITEM,
    warehouseId: WAREHOUSE,
    direction: "IN",
    qty: Qty.fromMajor(qty),
    unitCost: Money.fromMajor(unitCost),
    sourceDocType: "PURCHASE_RECEIPT",
    sourceDocId: `DOC-${id}`,
    sourceDocNumber: null,
    reason: null,
    occurredAt: at,
  });

  const issue = (id: string, qty: string, recordedCost: string, at: string): StockMovement => ({
    id,
    itemId: ITEM,
    warehouseId: WAREHOUSE,
    direction: "OUT",
    qty: Qty.fromMajor(qty),
    unitCost: Money.fromMajor(recordedCost),
    sourceDocType: "SALES_INVOICE",
    sourceDocId: `DOC-${id}`,
    sourceDocNumber: null,
    reason: null,
    occurredAt: at,
  });

  it("values the issue at its recorded cost even when the running average differs", () => {
    // 10 @ 5.00 = 50.00 on hand. The issue was posted when the average was
    // 5.00, and it says so — but a later, earlier-dated receipt has since
    // changed what a recomputation would produce.
    const position = replay(ITEM, WAREHOUSE, [
      receipt("IN1", "10", "5", "2026-01-01T00:00:00.000Z"),
      issue("OUT1", "4", "5", "2026-01-05T00:00:00.000Z"),
    ]);

    // 50.00 in, 4 × 5.00 = 20.00 out, 30.00 left over 6 units = 5.00.
    expect(position.onHand.toString()).toBe("6.000000");
    expect(position.totalValue.toString()).toBe("30.000000");
  });

  it("a backdated receipt does not restate what an already-posted issue cost", () => {
    // The sale left at 5.00 and the books recorded that. A cheaper purchase is
    // then entered with an EARLIER date — the kind of correction a supplier
    // invoice arriving late produces.
    const withBackdate = replay(ITEM, WAREHOUSE, [
      receipt("IN-EARLY", "10", "1", "2026-01-01T00:00:00.000Z"),
      receipt("IN1", "10", "5", "2026-01-02T00:00:00.000Z"),
      issue("OUT1", "4", "5", "2026-01-05T00:00:00.000Z"),
    ]);

    // 10.00 + 50.00 = 60.00 in; the issue still leaves at the 5.00 it recorded,
    // so 20.00 leaves and 40.00 remains over 16 units.
    expect(withBackdate.onHand.toString()).toBe("16.000000");
    expect(withBackdate.totalValue.toString()).toBe("40.000000");

    // A recomputation would have valued that issue at the blended 3.00 average
    // and left 48.00 — the figure the ledger does NOT hold.
    expect(withBackdate.totalValue.toString()).not.toBe("48.000000");
  });

  it("a landed cost dated after the sale it did not fund does not change what the sale cost", () => {
    const position = replay(ITEM, WAREHOUSE, [
      receipt("IN1", "10", "5", "2026-01-01T00:00:00.000Z"),
      issue("OUT1", "4", "5", "2026-01-05T00:00:00.000Z"),
      {
        id: "LC1",
        itemId: ITEM,
        warehouseId: WAREHOUSE,
        direction: "IN",
        qty: Qty.zero(),
        unitCost: Money.zero(),
        sourceDocType: "LANDED_COST",
        sourceDocId: "DOC-LC1",
        sourceDocNumber: null,
        reason: null,
        occurredAt: "2026-01-10T00:00:00.000Z",
        valueDelta: Money.fromMajor("60"),
        revaluesSourceDocId: "DOC-IN1",
      },
    ]);

    // 50.00 − 20.00 = 30.00 over the 6 units still held. The freight is
    // 60.00 on a receipt of 10 units of which 6 remain, so 36.00 attaches to
    // them (30.00 + 36.00 = 66.00, an average of 11.00) and the 24.00 that
    // belongs to the 4 already sold is reported, not capitalised (D135).
    expect(position.onHand.toString()).toBe("6.000000");
    expect(position.totalValue.toString()).toBe("66.000000");
    expect(position.averageCost.toString()).toBe("11.000000");
    expect(position.unabsorbedRevaluation.toString()).toBe("24.000000");
  });

  it("still recomputes when the movement records no cost of its own", () => {
    // The other half of the rule: a zero cost means "value me at the average",
    // and that path must keep working.
    const position = replay(ITEM, WAREHOUSE, [
      receipt("IN1", "10", "5", "2026-01-01T00:00:00.000Z"),
      receipt("IN2", "10", "15", "2026-01-02T00:00:00.000Z"),
      issue("OUT1", "4", "0", "2026-01-05T00:00:00.000Z"),
    ]);

    // 50.00 + 150.00 = 200.00 over 20 units = 10.00 average; 4 out at 10.00.
    expect(position.totalValue.toString()).toBe("160.000000");
    expect(position.averageCost.toString()).toBe("10.000000");
  });
});

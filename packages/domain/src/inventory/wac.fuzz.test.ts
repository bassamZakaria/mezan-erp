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
        // A landed cost booked AFTER the stock is gone is excluded here and
        // pinned separately below (D135) — it is not rounding, it is a whole
        // freight invoice landing on nothing, and folding it into this
        // tolerance would hide it behind a bigger number.
        const revaluedAfterDrain = movements.some((m) => m.sourceDocType === "LANDED_COST");
        if (revaluedAfterDrain) return;

        const residue = position.totalValue.scaled < 0n ? -position.totalValue.scaled : position.totalValue.scaled;
        expect(residue <= BigInt(movements.length + 1)).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  describe("a landed cost that arrives after the stock has all been sold (D135)", () => {
    /**
     * The freight invoice almost never arrives with the goods. By the time it
     * is booked, a fast-moving item may already be sold out — and this is what
     * happens then. Found by the fuzz property above, at 7 micro-units; stated
     * here at the scale a real shop would see it.
     */
    const DRAINED_THEN_REVALUED: StockMovement[] = [
        {
          id: "IN-1",
          itemId: ITEM,
          warehouseId: WAREHOUSE,
          direction: "IN",
          qty: Qty.fromMajor("100"),
          unitCost: Money.fromMajor("10"),
          sourceDocType: "PURCHASE_RECEIPT",
          sourceDocId: "PR-1",
          sourceDocNumber: null,
          reason: null,
          occurredAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "OUT-1",
          itemId: ITEM,
          warehouseId: WAREHOUSE,
          direction: "OUT",
          qty: Qty.fromMajor("100"),
          unitCost: Money.zero(),
          sourceDocType: "SALES_INVOICE",
          sourceDocId: "SI-1",
          sourceDocNumber: null,
          reason: null,
          occurredAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "LC-1",
          itemId: ITEM,
          warehouseId: WAREHOUSE,
          direction: "IN",
          qty: Qty.zero(),
          unitCost: Money.zero(),
          sourceDocType: "LANDED_COST",
          sourceDocId: "LC-1",
          sourceDocNumber: null,
          reason: null,
          occurredAt: "2026-01-03T00:00:00.000Z",
          valueDelta: Money.fromMajor("250"),
          revaluesSourceDocId: "PR-1",
        } as StockMovement,
    ];

    const drainedThenRevalued = () => replay(ITEM, WAREHOUSE, DRAINED_THEN_REVALUED);

    it("LIMITATION (D135): the whole freight invoice is left on a position holding nothing", () => {
      const position = drainedThenRevalued();

      expect(position.onHand.toString()).toBe("0.000000");
      // 250.00 of value, backed by zero units. It should have gone to COGS —
      // the goods it belongs to have already been sold.
      expect(position.totalValue.toString()).toBe("250.000000");
    });

    it("LIMITATION (D135): the average reads 0.000000, so no screen shows the orphaned value", () => {
      // This is why it survives: `unitCostOf(value, 0)` is 0, so the item card,
      // the stock list and the costing screen all look perfectly normal. Only
      // the valuation total is wrong, and only against the GL.
      const position = drainedThenRevalued();
      expect(position.averageCost.toString()).toBe("0.000000");
    });

    it("LIMITATION (D135): it never washes out — the next receipt inherits it as margin error", () => {
      // With nothing on hand to absorb it the 250 simply waits. Buying 10 more
      // at 10.00 should give a position worth 100.00 at 10.00 each; instead the
      // orphaned freight rides along, so every one of those 10 units carries
      // 35.00 of cost — and that overstatement goes straight to cost of sales
      // on goods that never bore the freight.
      const position = replay(ITEM, WAREHOUSE, [
        ...DRAINED_THEN_REVALUED,
        {
          id: "IN-2",
          itemId: ITEM,
          warehouseId: WAREHOUSE,
          direction: "IN",
          qty: Qty.fromMajor("10"),
          unitCost: Money.fromMajor("10"),
          sourceDocType: "PURCHASE_RECEIPT",
          sourceDocId: "PR-2",
          sourceDocNumber: null,
          reason: null,
          occurredAt: "2026-01-04T00:00:00.000Z",
        },
      ]);

      expect(position.onHand.toString()).toBe("10.000000");
      expect(position.totalValue.toString()).toBe("350.000000");
      expect(position.averageCost.toString()).toBe("35.000000");
    });

    it("still applies the landed cost correctly while the stock IS on hand (the negative control)", () => {
      // The mechanism is right; only the drained case is wrong. A guard that
      // refused every landed cost would break the feature instead of fixing it.
      const position = replay(ITEM, WAREHOUSE, [
        {
          id: "IN-1",
          itemId: ITEM,
          warehouseId: WAREHOUSE,
          direction: "IN",
          qty: Qty.fromMajor("100"),
          unitCost: Money.fromMajor("10"),
          sourceDocType: "PURCHASE_RECEIPT",
          sourceDocId: "PR-1",
          sourceDocNumber: null,
          reason: null,
          occurredAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "LC-1",
          itemId: ITEM,
          warehouseId: WAREHOUSE,
          direction: "IN",
          qty: Qty.zero(),
          unitCost: Money.zero(),
          sourceDocType: "LANDED_COST",
          sourceDocId: "LC-1",
          sourceDocNumber: null,
          reason: null,
          occurredAt: "2026-01-02T00:00:00.000Z",
          valueDelta: Money.fromMajor("250"),
          revaluesSourceDocId: "PR-1",
        } as StockMovement,
      ]);

      expect(position.onHand.toString()).toBe("100.000000");
      expect(position.totalValue.toString()).toBe("1250.000000");
      expect(position.averageCost.toString()).toBe("12.500000");
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

  it("fuzz: a revaluation adds its whole value and moves no quantity", () => {
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
        expect(after.totalValue.scaled).toBe(before.totalValue.scaled + valueMicro);
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

  it("KNOWN LIMITATION (D84): the value lands on a position with nothing in it, and no layer is bumped", () => {
    const position = replay(ITEM, WAREHOUSE, [receipt, drain, landedCost]);

    // Everything was sold before the freight invoice arrived, so the layer the
    // landed cost names no longer exists.
    expect(position.onHand.scaled).toBe(0n);
    expect(position.layers).toHaveLength(0);

    // The value is added anyway: 100.00 of inventory value with no units behind
    // it. Nothing refuses it and nothing reports it — the drift report reads
    // this as the documented layer-versus-WAC divergence rather than as the
    // orphan it is. When D84 is fixed, this expectation is the one to rewrite:
    // the cost belongs on the sold goods (COGS), not on an empty position.
    expect(position.totalValue.toString()).toBe("100.000000");
    expect(position.averageCost.scaled).toBe(0n);
  });

  it("bumps the layer correctly when the goods are still there, which is the path that works", () => {
    const position = replay(ITEM, WAREHOUSE, [receipt, landedCost]);

    expect(position.onHand.toString()).toBe("10.000000");
    expect(position.totalValue.toString()).toBe("150.000000");
    expect(position.averageCost.toString()).toBe("15.000000");
    expect(position.layers).toHaveLength(1);
    expect(position.layers[0]?.unitCost.toString()).toBe("15.000000");
  });

  it("KNOWN LIMITATION (D84): a partial drain leaves the whole freight on the units that remain", () => {
    const halfDrain: StockMovement = { ...drain, id: "MOV-OUT-HALF", qty: Qty.fromMajor("6") };
    const position = replay(ITEM, WAREHOUSE, [receipt, halfDrain, landedCost]);

    // Four units are left and they carry all 100.00 of freight, so their unit
    // cost jumps to 30.00 while the six already sold left at 5.00 — the cost of
    // the sold portion is understated by exactly the freight it should have
    // carried.
    expect(position.onHand.toString()).toBe("4.000000");
    expect(position.layers[0]?.unitCost.toString()).toBe("15.000000");
    expect(position.totalValue.toString()).toBe("120.000000");
    expect(position.averageCost.toString()).toBe("30.000000");
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

    // 50.00 − 20.00 + 60.00 = 90.00 over the 6 units still held.
    expect(position.onHand.toString()).toBe("6.000000");
    expect(position.totalValue.toString()).toBe("90.000000");
    expect(position.averageCost.toString()).toBe("15.000000");
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

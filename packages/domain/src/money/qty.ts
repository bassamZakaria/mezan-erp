/**
 * Qty value object.
 *
 * Same discipline as {@link Money}: a signed integer held as a bigint at a fixed
 * scale of 10^-6 (six decimal places), so quantity arithmetic is EXACT — never
 * IEEE-754. docs/plan.md §2.3 mandates scale-6 for "every monetary amount, unit
 * cost, quantity and FX rate": weighted-average costing and formula-priced
 * configurable products (`width*height*3.5`, docs/catalog/03) need sub-unit
 * precision, and stock is stored as INTEGER in SQLite / BIGINT in Postgres.
 *
 * Qty is intentionally a DISTINCT type from Money: the compiler must reject
 * `money.add(qty)`. Cross-type arithmetic (extension = qty × unitPrice) is a
 * named rounding boundary and lives in the rounding module, not here.
 */

export const QTY_SCALE_DECIMALS = 6;
const SCALE = 1_000_000n; // 10^6

export class Qty {
  private constructor(readonly scaled: bigint) {}

  static fromScaled(scaled: bigint | number): Qty {
    if (typeof scaled === "number") {
      if (!Number.isSafeInteger(scaled)) {
        throw new RangeError(
          `Qty.fromScaled requires a safe integer, got ${scaled}`,
        );
      }
      return new Qty(BigInt(scaled));
    }
    return new Qty(scaled);
  }

  /**
   * Parse an exact decimal string (e.g. "12.5", "-0.250000") without ever
   * touching a float — the boundary that keeps the "no floats, ever" invariant
   * true end to end.
   */
  static fromMajor(value: string): Qty {
    const trimmed = value.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) {
      throw new RangeError(`Invalid quantity literal: "${value}"`);
    }
    const sign = match[1] ?? "";
    const intPart = match[2] ?? "0";
    const fracPartRaw = match[3] ?? "";
    if (fracPartRaw.length > QTY_SCALE_DECIMALS) {
      throw new RangeError(
        `Qty supports at most ${QTY_SCALE_DECIMALS} decimal places: "${value}"`,
      );
    }
    const frac = (fracPartRaw + "000000").slice(0, QTY_SCALE_DECIMALS);
    const scaled = BigInt(intPart) * SCALE + BigInt(frac);
    return new Qty(sign === "-" ? -scaled : scaled);
  }

  static zero(): Qty {
    return new Qty(0n);
  }

  add(other: Qty): Qty {
    return new Qty(this.scaled + other.scaled);
  }

  subtract(other: Qty): Qty {
    return new Qty(this.scaled - other.scaled);
  }

  negate(): Qty {
    return new Qty(-this.scaled);
  }

  /** Scale by an exact whole multiple (e.g. pack size). No rounding involved. */
  timesInteger(factor: bigint | number): Qty {
    const f = typeof factor === "number" ? BigInt(factor) : factor;
    if (typeof factor === "number" && !Number.isSafeInteger(factor)) {
      throw new RangeError(`Qty.timesInteger requires a safe integer factor`);
    }
    return new Qty(this.scaled * f);
  }

  equals(other: Qty): boolean {
    return this.scaled === other.scaled;
  }

  /** -1, 0, or 1. */
  compare(other: Qty): -1 | 0 | 1 {
    if (this.scaled < other.scaled) return -1;
    if (this.scaled > other.scaled) return 1;
    return 0;
  }

  isZero(): boolean {
    return this.scaled === 0n;
  }

  isNegative(): boolean {
    return this.scaled < 0n;
  }

  static sum(items: readonly Qty[]): Qty {
    let acc = 0n;
    for (const item of items) acc += item.scaled;
    return new Qty(acc);
  }

  /** Scaled integer as a JS number, for the SQLite INTEGER column. */
  toScaledNumber(): number {
    if (
      this.scaled > BigInt(Number.MAX_SAFE_INTEGER) ||
      this.scaled < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new RangeError(
        `Qty value ${this.scaled} exceeds JS safe-integer range; ` +
          `use better-sqlite3 safeIntegers() before this is a real limit.`,
      );
    }
    return Number(this.scaled);
  }

  /** Exact decimal string, always with ${QTY_SCALE_DECIMALS} fraction digits. */
  toString(): string {
    const negative = this.scaled < 0n;
    const abs = negative ? -this.scaled : this.scaled;
    const intPart = abs / SCALE;
    const fracPart = abs % SCALE;
    return `${negative ? "-" : ""}${intPart}.${fracPart
      .toString()
      .padStart(QTY_SCALE_DECIMALS, "0")}`;
  }

  /** Serialize as the exact decimal string so JSON is byte-identical everywhere. */
  toJSON(): string {
    return this.toString();
  }
}

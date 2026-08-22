/**
 * Money value object.
 *
 * Canonical representation: a signed integer at a fixed scale of 10^-6 (six
 * decimal places), held as a bigint so arithmetic is EXACT — never IEEE-754.
 * This mirrors the storage contract in docs/plan.md §2.3: BIGINT in Postgres,
 * INTEGER in SQLite, no floats anywhere in the ledger path.
 */

export const MONEY_SCALE_DECIMALS = 6;
const SCALE = 1_000_000n; // 10^6

export class Money {
  private constructor(readonly scaled: bigint) {}

  static fromScaled(scaled: bigint | number): Money {
    if (typeof scaled === "number") {
      if (!Number.isSafeInteger(scaled)) {
        throw new RangeError(
          `Money.fromScaled requires a safe integer, got ${scaled}`,
        );
      }
      return new Money(BigInt(scaled));
    }
    return new Money(scaled);
  }

  /**
   * Parse an exact decimal string (e.g. "1250.50", "-3.000001") without ever
   * touching a float. Accepting a string at the boundary is what keeps the
   * "no floats, ever" invariant true end to end.
   */
  static fromMajor(value: string): Money {
    const trimmed = value.trim();
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
    if (!match) {
      throw new RangeError(`Invalid money literal: "${value}"`);
    }
    const sign = match[1] ?? "";
    const intPart = match[2] ?? "0";
    const fracPartRaw = match[3] ?? "";
    if (fracPartRaw.length > MONEY_SCALE_DECIMALS) {
      throw new RangeError(
        `Money supports at most ${MONEY_SCALE_DECIMALS} decimal places: "${value}"`,
      );
    }
    const frac = (fracPartRaw + "000000").slice(0, MONEY_SCALE_DECIMALS);
    const scaled = BigInt(intPart) * SCALE + BigInt(frac);
    return new Money(sign === "-" ? -scaled : scaled);
  }

  static zero(): Money {
    return new Money(0n);
  }

  add(other: Money): Money {
    return new Money(this.scaled + other.scaled);
  }

  negate(): Money {
    return new Money(-this.scaled);
  }

  equals(other: Money): boolean {
    return this.scaled === other.scaled;
  }

  static sum(items: readonly Money[]): Money {
    let acc = 0n;
    for (const item of items) acc += item.scaled;
    return new Money(acc);
  }

  /** Scaled integer as a JS number, for the SQLite INTEGER column. */
  toScaledNumber(): number {
    if (this.scaled > BigInt(Number.MAX_SAFE_INTEGER) || this.scaled < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(
        `Money value ${this.scaled} exceeds JS safe-integer range; ` +
          `use better-sqlite3 safeIntegers() before this is a real limit.`,
      );
    }
    return Number(this.scaled);
  }

  /** Exact decimal string, always with ${MONEY_SCALE_DECIMALS} fraction digits. */
  toString(): string {
    const negative = this.scaled < 0n;
    const abs = negative ? -this.scaled : this.scaled;
    const intPart = abs / SCALE;
    const fracPart = abs % SCALE;
    return `${negative ? "-" : ""}${intPart}.${fracPart
      .toString()
      .padStart(MONEY_SCALE_DECIMALS, "0")}`;
  }

  /** Serialize as the exact decimal string so JSON is byte-identical everywhere. */
  toJSON(): string {
    return this.toString();
  }
}

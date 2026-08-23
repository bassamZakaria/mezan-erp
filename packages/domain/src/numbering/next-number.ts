/**
 * NextNumber service.
 *
 * Allocates gap-free, sequential document numbers (docs/plan.md §2.3 rule 5):
 * "Sequential document numbers with no gaps under concurrency. Numbering is a
 * transactional counter row (SELECT ... FOR UPDATE on Postgres, BEGIN IMMEDIATE
 * on SQLite) inside the same transaction as the document insert."
 *
 * The domain owns only the PORT. Atomicity is the store's job: the SQLite
 * implementation in @mezan/persistence takes BEGIN IMMEDIATE (a write lock) and
 * bumps a single counter row, so two callers can never read the same value.
 * Callers that need the number and the document to be all-or-nothing pass the
 * same transaction handle into both.
 */

import {
  getSequenceDefinition,
  formatSequenceNumber,
  applySequenceOverride,
  type SequenceCode,
  type SequenceOverride,
} from "./sequences.js";

/**
 * Atomic counter port. `increment` must return a value that is never handed to
 * any other caller — the whole no-gaps/no-dupes guarantee rests here.
 *
 * `period` scopes the counter: `null` for a never-resetting sequence, or the
 * calendar year (e.g. `2026`) for an annual-reset sequence, so each year starts
 * again at 1.
 */
export interface SequenceStore {
  increment(code: string, period: number | null): Promise<number>;
}

export interface NextNumberResult {
  readonly code: string;
  readonly value: number;
  readonly formatted: string;
}

export interface NextNumberOptions {
  /** Override "now" for annual-reset period derivation (testing, backdating). */
  readonly year?: number;
}

/**
 * Optional admin-override lookup (`/settings/sequences`'s prefix/pad-length/
 * annual-reset edit surface). Purely additive: a `NextNumberService` built
 * without one behaves exactly as before, reading only the compiled-in
 * {@link SequenceDefinition}.
 */
export interface SequenceConfigStore {
  getOverride(code: string): Promise<SequenceOverride | null>;
}

export class NextNumberService {
  constructor(
    private readonly store: SequenceStore,
    private readonly configStore?: SequenceConfigStore,
  ) {}

  async next(
    code: SequenceCode,
    opts: NextNumberOptions = {},
  ): Promise<NextNumberResult> {
    const base = getSequenceDefinition(code);
    const override = this.configStore ? await this.configStore.getOverride(code) : null;
    const def = applySequenceOverride(base, override);
    const period = def.annualReset
      ? (opts.year ?? new Date().getUTCFullYear())
      : null;
    const value = await this.store.increment(code, period);
    return {
      code,
      value,
      formatted: formatSequenceNumber(def, value),
    };
  }
}

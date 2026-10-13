import { insertOnly } from "../../records/test-helpers/insert-only.js";
import type { FiscalPeriod, FiscalPeriodRepository } from "../fiscal-period.js";
import { calendarDay } from "../../dates.js";

/** A trivial in-memory {@link FiscalPeriodRepository} fake for domain-layer unit tests. */
export class InMemoryFiscalPeriodRepository implements FiscalPeriodRepository {
  private readonly rows = new Map<string, FiscalPeriod>();

  async findById(id: string): Promise<FiscalPeriod | null> {
    return this.rows.get(id) ?? null;
  }

  async findByDate(date: string): Promise<FiscalPeriod | null> {
    // A period boundary is a DAY and `date` may be an INSTANT; comparing them
    // as strings put every timestamp after the last day of its own period, so
    // nothing could post on the 31st. See `calendarDay`.
    const day = calendarDay(date);
    for (const period of this.rows.values()) {
      if (day >= period.startDate && day <= period.endDate) return period;
    }
    return null;
  }

  async findByYearAndNumber(year: number, periodNumber: number): Promise<FiscalPeriod | null> {
    for (const period of this.rows.values()) {
      if (period.year === year && period.periodNumber === periodNumber) return period;
    }
    return null;
  }

  async listByYear(year: number): Promise<FiscalPeriod[]> {
    return [...this.rows.values()].filter((p) => p.year === year);
  }

  async list(): Promise<FiscalPeriod[]> {
    return [...this.rows.values()];
  }

  async create(period: FiscalPeriod): Promise<void> {
    insertOnly(this.rows, period.id, period);
  }

  async update(period: FiscalPeriod): Promise<void> {
    this.rows.set(period.id, period);
  }
}

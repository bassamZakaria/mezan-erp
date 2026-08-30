/**
 * تسجيل الإقرارات الضريبية المقدَّمة — the record that a VAT period was filed.
 *
 * This file had no test at all. It is the only thing standing between a filed
 * الإقرار الضريبي and a backdated document that silently restates it.
 *
 * The repository double mirrors the SQLite store exactly
 * (packages/persistence/src/vat-filing-store.ts): save is an UPSERT keyed on
 * id, and findCovering(date) is period_from <= date AND period_to >= date.
 * A friendlier fake would hide the two defects proven at the bottom of the file.
 */

import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import {
  recordVatFiling,
  amendVatFiling,
  assertVatPeriodOpen,
  DuplicateVatFilingError,
  VatFilingNotFoundError,
  VatPeriodAlreadyFiledError,
  type VatFiling,
  type VatFilingRepository,
} from "./vat-filing.js";

interface FakeRepo extends VatFilingRepository {
  readonly rows: Map<string, VatFiling>;
  saves: number;
}

function repository(seed: readonly VatFiling[] = []): FakeRepo {
  const rows = new Map<string, VatFiling>(seed.map((f) => [f.id, f]));
  const store: FakeRepo = {
    rows,
    saves: 0,
    async findById(id: string) {
      return rows.get(id) ?? null;
    },
    async list() {
      return [...rows.values()];
    },
    async save(filing: VatFiling) {
      store.saves += 1;
      rows.set(filing.id, filing);
    },
    async findCovering(date: string) {
      return [...rows.values()].filter((f) => f.periodFrom <= date && f.periodTo >= date);
    },
  };
  return store;
}

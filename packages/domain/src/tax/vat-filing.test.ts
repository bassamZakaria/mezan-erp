/**
 * تسجيل الإقرارات الضريبية المقدَّمة — the record that a VAT period was filed.
 *
 * This file had no test of its own. It is the only thing standing between a
 * filed الإقرار الضريبي and a backdated document that silently restates it.
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
  DuplicateVatFilingError,
  VatFilingNotFoundError,
  VatPeriodAlreadyFiledError,
  type VatFiling,
  type VatFilingRepository,
} from "./vat-filing.js";
/**
 * The LIVE lock. It lives in `gl/post.ts`, next to the posting path that
 * calls it, and this file used to test a second copy that had no caller
 * (D104). Testing the live one is the difference between guarding the rule
 * and guarding a decoration.
 */
import { assertVatNotFiled } from "../gl/post.js";

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

function filedRow(overrides: Partial<VatFiling> = {}): VatFiling {
  return {
    id: "VF-2026-07",
    periodFrom: "2026-07-01",
    periodTo: "2026-07-31",
    netAmount: Money.fromMajor("48250.75"),
    referenceNo: "ETA-ACK-77120",
    status: "filed",
    filedAt: "2026-08-10T09:00:00.000Z",
    filedBy: "u-accountant",
    amendedAt: null,
    amendmentReason: null,
    ...overrides,
  };
}

describe("recordVatFiling — what we told the authority, kept verbatim", () => {
  it("stores the submitted net payable to the piastre, with the reference and the filer", async () => {
    const repo = repository();
    const filing = await recordVatFiling(
      {
        id: "VF-2026-08",
        periodFrom: "2026-08-01",
        periodTo: "2026-08-31",
        netAmount: Money.fromMajor("48250.75"),
        referenceNo: "ETA-ACK-77120",
        filedBy: "u-accountant",
        filedAt: "2026-09-10T09:00:00.000Z",
      },
      { filings: repo },
    );

    expect(filing.netAmount.toString()).toBe("48250.750000");
    expect(filing.status).toBe("filed");
    expect(filing.referenceNo).toBe("ETA-ACK-77120");
    expect(filing.filedBy).toBe("u-accountant");
    expect(filing.filedAt).toBe("2026-09-10T09:00:00.000Z");
    expect(filing.amendedAt).toBeNull();
    expect(filing.amendmentReason).toBeNull();

    const stored = await repo.findById("VF-2026-08");
    expect(stored!.netAmount.toString()).toBe("48250.750000");
    expect(stored!.periodFrom).toBe("2026-08-01");
    expect(stored!.periodTo).toBe("2026-08-31");
  });

  it("records a REFUNDABLE period as a negative net, not as its magnitude", async () => {
    const repo = repository();
    const filing = await recordVatFiling(
      {
        id: "VF-2026-09",
        periodFrom: "2026-09-01",
        periodTo: "2026-09-30",
        netAmount: Money.fromMajor("-3410.20"),
      },
      { filings: repo },
    );
    expect(filing.netAmount.toString()).toBe("-3410.200000");
    expect((await repo.findById("VF-2026-09"))!.netAmount.toString()).toBe("-3410.200000");
  });

  it("refuses a second filing for a period that already has a live one, and writes nothing", async () => {
    const repo = repository([filedRow()]);
    const before = repo.saves;

    await expect(
      recordVatFiling(
        {
          id: "VF-2026-07-DUP",
          periodFrom: "2026-07-01",
          periodTo: "2026-07-31",
          netAmount: Money.fromMajor("1.00"),
        },
        { filings: repo },
      ),
    ).rejects.toBeInstanceOf(DuplicateVatFilingError);

    expect(repo.saves).toBe(before);
    expect(repo.rows.size).toBe(1);
    expect((await repo.findById("VF-2026-07"))!.netAmount.toString()).toBe("48250.750000");
  });

  it("names the filing that blocks it, so the user knows which return to amend", async () => {
    const repo = repository([filedRow()]);
    const err = (await recordVatFiling(
      { id: "X", periodFrom: "2026-07-15", periodTo: "2026-08-14", netAmount: Money.zero() },
      { filings: repo },
    ).then(
      () => null,
      (e: unknown) => e as DuplicateVatFilingError,
    ))!;
    expect(err).toBeInstanceOf(DuplicateVatFilingError);
    expect(err.filingId).toBe("VF-2026-07");
    expect(err.code).toBe("VAT_PERIOD_ALREADY_HAS_FILING");
  });

  it("lets an AMENDED period be re-filed — the negative control for the duplicate guard", async () => {
    const repo = repository([
      filedRow({ status: "amended", amendedAt: "2026-08-20T00:00:00.000Z", amendmentReason: "خطأ في التبويب" }),
    ]);
    const refiled = await recordVatFiling(
      {
        id: "VF-2026-07-R2",
        periodFrom: "2026-07-01",
        periodTo: "2026-07-31",
        netAmount: Money.fromMajor("48390.75"),
      },
      { filings: repo },
    );
    expect(refiled.status).toBe("filed");
    expect(refiled.netAmount.toString()).toBe("48390.750000");
    expect(repo.rows.size).toBe(2);
    expect((await repo.findById("VF-2026-07"))!.netAmount.toString()).toBe("48250.750000");
  });
});

describe("amendVatFiling — reopening a filed period is a decision, with a reason", () => {
  it("keeps the id, the window and the ORIGINAL net so the restatement stays measurable", async () => {
    const repo = repository([filedRow()]);
    const amended = await amendVatFiling("VF-2026-07", "تعديل بعد المراجعة الضريبية", {
      filings: repo,
      now: () => "2026-08-25T12:00:00.000Z",
    });

    expect(amended.status).toBe("amended");
    expect(amended.amendedAt).toBe("2026-08-25T12:00:00.000Z");
    expect(amended.amendmentReason).toBe("تعديل بعد المراجعة الضريبية");
    expect(amended.netAmount.toString()).toBe("48250.750000");
    expect(amended.filedAt).toBe("2026-08-10T09:00:00.000Z");
    expect(amended.filedBy).toBe("u-accountant");
    expect(amended.referenceNo).toBe("ETA-ACK-77120");
  });

  it("refuses a blank reason and leaves the filing untouched — no silent reopen", async () => {
    const repo = repository([filedRow()]);
    const before = repo.saves;
    await expect(amendVatFiling("VF-2026-07", "   ", { filings: repo })).rejects.toThrow("سبب تعديل الإقرار مطلوب.");
    expect(repo.saves).toBe(before);
    expect((await repo.findById("VF-2026-07"))!.status).toBe("filed");
    expect((await repo.findById("VF-2026-07"))!.amendmentReason).toBeNull();
  });

  it("refuses an unknown filing and writes nothing", async () => {
    const repo = repository([filedRow()]);
    const before = repo.saves;
    await expect(amendVatFiling("VF-GHOST", "سبب", { filings: repo })).rejects.toBeInstanceOf(VatFilingNotFoundError);
    expect(repo.saves).toBe(before);
    expect(repo.rows.size).toBe(1);
  });
});

describe("assertVatNotFiled — the lock a backdated document must hit", () => {
  it("refuses a posting dated anywhere inside a FILED window, including both boundary days", async () => {
    const repo = repository([filedRow()]);
    for (const date of ["2026-07-01", "2026-07-16", "2026-07-31"]) {
      const err = await assertVatNotFiled(date, repo).then(
        () => null,
        (e: unknown) => e as VatPeriodAlreadyFiledError,
      );
      expect(err, `expected ${date} to be refused`).toBeInstanceOf(VatPeriodAlreadyFiledError);
      expect(err!.filingId).toBe("VF-2026-07");
      expect(err!.date).toBe(date);
      expect(err!.code).toBe("VAT_PERIOD_ALREADY_FILED");
    }
  });

  it("allows the day either side of the window — the guard must not refuse everything", async () => {
    const repo = repository([filedRow()]);
    await expect(assertVatNotFiled("2026-06-30", repo)).resolves.toBeUndefined();
    await expect(assertVatNotFiled("2026-08-01", repo)).resolves.toBeUndefined();
  });

  it("allows the period again once the filing has been amended", async () => {
    const repo = repository([filedRow()]);
    await expect(assertVatNotFiled("2026-07-16", repo)).rejects.toBeInstanceOf(
      VatPeriodAlreadyFiledError,
    );
    await amendVatFiling("VF-2026-07", "تعديل", { filings: repo });
    await expect(assertVatNotFiled("2026-07-16", repo)).resolves.toBeUndefined();
  });
});

/**
 * DEFECT — recordVatFiling never asks whether cmd.id is already taken, and
 * save is an UPSERT keyed on id (vat-filing-store.ts, ON CONFLICT(id) DO
 * UPDATE). POSTing /gl/vat-filings with an id already on file and a window that
 * does not overlap it therefore OVERWRITES the earlier filing: the acknowledged
 * figure, its ETA reference, its filer, its timestamp and any amendment reason
 * are gone, and the filed period is postable again.
 *
 * SalesInvoiceService.create refuses a duplicate id outright
 * (DuplicateSalesInvoiceError). The tax register is the one place that does not.
 */
describe("DEFECT: recording a filing under an existing id overwrites the acknowledged return", () => {
  it("erases the filed July record — figure, reference, filer and all — and unlocks the period", async () => {
    const repo = repository([filedRow()]);
    await expect(assertVatNotFiled("2026-07-16", repo)).rejects.toBeInstanceOf(
      VatPeriodAlreadyFiledError,
    );

    await recordVatFiling(
      {
        id: "VF-2026-07",
        periodFrom: "2026-10-01",
        periodTo: "2026-10-31",
        netAmount: Money.fromMajor("12.00"),
        filedBy: "u-junior",
      },
      { filings: repo },
    );

    const survivor = (await repo.findById("VF-2026-07"))!;
    expect(repo.rows.size).toBe(1);
    expect(survivor.periodFrom).toBe("2026-10-01");
    expect(survivor.netAmount.toString()).toBe("12.000000");
    expect(survivor.referenceNo).toBeNull();
    expect(survivor.filedBy).toBe("u-junior");
    await expect(assertVatNotFiled("2026-07-16", repo)).resolves.toBeUndefined();
  });

  it("un-amends an amended filing, discarding the reason the amendment was required to carry", async () => {
    const repo = repository([filedRow()]);
    await amendVatFiling("VF-2026-07", "تسوية بعد الفحص", { filings: repo });
    expect((await repo.findById("VF-2026-07"))!.amendmentReason).toBe("تسوية بعد الفحص");

    await recordVatFiling(
      { id: "VF-2026-07", periodFrom: "2026-11-01", periodTo: "2026-11-30", netAmount: Money.fromMajor("5.00") },
      { filings: repo },
    );

    const survivor = (await repo.findById("VF-2026-07"))!;
    expect(survivor.status).toBe("filed");
    expect(survivor.amendedAt).toBeNull();
    expect(survivor.amendmentReason).toBeNull();
  });
});

/**
 * DEFECT — the duplicate guard calls findCovering(cmd.periodFrom) and nothing
 * else. A window that OVERLAPS an existing filing but starts before it is
 * accepted, leaving two live filings claiming the same days: the register then
 * says the authority was told two different net figures for the same dates.
 */
describe("DEFECT: the duplicate guard checks only the first day of the new window", () => {
  it("accepts a filing that overlaps an existing one from the left", async () => {
    const repo = repository([filedRow()]);
    const overlapping = await recordVatFiling(
      {
        id: "VF-MID",
        periodFrom: "2026-06-15",
        periodTo: "2026-07-15",
        netAmount: Money.fromMajor("9000.00"),
      },
      { filings: repo },
    );
    expect(overlapping.status).toBe("filed");

    const covering = await repo.findCovering("2026-07-10");
    expect(covering.map((f) => f.id).sort()).toEqual(["VF-2026-07", "VF-MID"]);
    expect(covering.filter((f) => f.status === "filed")).toHaveLength(2);
  });

  it("and amending only ONE of the two leaves the day locked with no visible reason", async () => {
    const repo = repository([filedRow()]);
    await recordVatFiling(
      { id: "VF-MID", periodFrom: "2026-06-15", periodTo: "2026-07-15", netAmount: Money.fromMajor("9000.00") },
      { filings: repo },
    );
    await amendVatFiling("VF-MID", "تعديل الإقرار المتداخل", { filings: repo });
    await expect(assertVatNotFiled("2026-07-10", repo)).rejects.toBeInstanceOf(
      VatPeriodAlreadyFiledError,
    );
  });

  it("does catch the overlap when the new window STARTS inside the old one — one-sided, not absent", async () => {
    const repo = repository([filedRow()]);
    await expect(
      recordVatFiling(
        { id: "VF-LATE", periodFrom: "2026-07-15", periodTo: "2026-08-14", netAmount: Money.fromMajor("1.00") },
        { filings: repo },
      ),
    ).rejects.toBeInstanceOf(DuplicateVatFilingError);
  });
});

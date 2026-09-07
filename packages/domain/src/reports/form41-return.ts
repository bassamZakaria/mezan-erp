/**
 * نموذج 41 — the quarterly return itself, assembled from the payments that
 * withheld.
 *
 * The figures come from the vouchers rather than from GL 2210, deliberately,
 * so the two can be compared: a return that disagrees with the control
 * account means a hand-written entry touched it. That is the same reasoning
 * the `tax.withholding` report is built on, and this reuses its row shape.
 *
 * One payee, one line — the authority's form is a list of the people tax was
 * withheld from, not a list of payments — so several vouchers to the same
 * supplier collapse into one row and the voucher count is kept beside it.
 */

import { Money } from "../money/index.js";
import { withholdingQuarter, type Form41Quarter, type WithholdingQuarter } from "./form41-filing.js";
import type { WithholdingTaxContext } from "./withholding-tax.js";

export interface Form41ReturnRow {
  readonly partyId: string | null;
  readonly partyNameAr: string;
  readonly grossAmount: Money;
  readonly withheldAmount: Money;
  readonly netPaidAmount: Money;
  /** How many payment vouchers this payee's line sums up. */
  readonly voucherCount: number;
  /**
   * The rate, when every voucher for this payee used the same one. Null when
   * they differ — the form asks for a rate per line, and averaging two
   * statutory rates into a number that is neither is worse than saying so.
   */
  readonly ratePercent: number | null;
}

export interface Form41Return {
  readonly period: Form41Quarter;
  readonly rows: readonly Form41ReturnRow[];
  readonly totalGross: Money;
  /** المبلغ الواجب توريده — the figure the filing is recorded with. */
  readonly totalWithheld: Money;
  readonly voucherCount: number;
}

export function buildForm41Return(
  ctx: WithholdingTaxContext,
  year: number,
  quarter: WithholdingQuarter,
): Form41Return {
  const period = withholdingQuarter(year, quarter);
  const inPeriod = ctx.rows.filter(
    (r) => r.date >= period.periodFrom && r.date <= period.periodTo && r.withheldAmount.scaled > 0n,
  );

  const byPayee = new Map<string, typeof inPeriod>();
  for (const row of inPeriod) {
    const key = row.partyId ?? `name:${row.partyNameAr}`;
    const bucket = byPayee.get(key);
    if (bucket) bucket.push(row);
    else byPayee.set(key, [row]);
  }

  const rows: Form41ReturnRow[] = [...byPayee.values()].map((payments) => {
    const gross = Money.sum(payments.map((p) => p.grossAmount));
    const withheld = Money.sum(payments.map((p) => p.withheldAmount));
    const rates = new Set(payments.map((p) => p.ratePercent));
    const first = payments[0] as (typeof payments)[number];
    return {
      partyId: first.partyId,
      partyNameAr: first.partyNameAr,
      grossAmount: gross,
      withheldAmount: withheld,
      netPaidAmount: Money.fromScaled(gross.scaled - withheld.scaled),
      voucherCount: payments.length,
      ratePercent: rates.size === 1 ? (first.ratePercent ?? null) : null,
    };
  });

  rows.sort((a, b) => {
    if (a.withheldAmount.scaled !== b.withheldAmount.scaled) {
      return a.withheldAmount.scaled > b.withheldAmount.scaled ? -1 : 1;
    }
    return a.partyNameAr.localeCompare(b.partyNameAr, "ar");
  });

  return {
    period,
    rows,
    totalGross: Money.sum(rows.map((r) => r.grossAmount)),
    totalWithheld: Money.sum(rows.map((r) => r.withheldAmount)),
    voucherCount: inPeriod.length,
  };
}

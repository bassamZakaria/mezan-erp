import type { ReactNode } from "react";
import { Button, Card, Money as MoneyValue, StatusPill } from "@mezan/ui";
import type { PartyStatementEntryKindDTO, PartyStatementLineDTO } from "@mezan/contracts";
import { moneyToNumber, parseMoney, usePartyStatement } from "../data/partner-detail-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

type PartyKind = "customer" | "supplier";

const MOVEMENT_LABEL: Record<PartyKind, Record<PartyStatementEntryKindDTO, AppTranslationKey>> = {
  customer: {
    opening: "customers.statement.opening",
    invoice: "customers.statement.salesInvoice",
    return: "customers.statement.salesReturn",
    receipt: "customers.statement.receipt",
    payment: "customers.statement.disbursement",
    refund: "customers.statement.disbursement",
    cheque: "customers.statement.chequeReceived",
    cheque_returned: "customers.statement.chequeBounced",
    deduction: "customers.statement.deduction",
    journal: "customers.statement.journal",
    imported: "customers.statement.imported",
    fx_difference: "customers.statement.fxDifference",
  },
  supplier: {
    opening: "suppliers.statement.opening",
    invoice: "suppliers.statement.purchaseInvoice",
    return: "suppliers.statement.purchaseReturn",
    receipt: "suppliers.statement.paymentIn",
    payment: "suppliers.statement.paymentOut",
    refund: "suppliers.statement.paymentIn",
    cheque: "suppliers.statement.chequeIssued",
    cheque_returned: "suppliers.statement.chequeBounced",
    deduction: "suppliers.statement.deduction",
    journal: "suppliers.statement.journal",
    imported: "suppliers.statement.imported",
    fx_difference: "suppliers.statement.fxDifference",
  },
};

function isoToDisplay(date: string): string {
  return date.split("-").reverse().join("/");
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[13px_15px]">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[5px] text-[14.5px] font-bold text-ink">{value}</div>
    </div>
  );
}

/**
 * The party's side of the ledger in its natural columns: what a customer owes
 * is a debit, what a supplier is owed is a credit.
 */
function sides(kind: PartyKind, line: Pick<PartyStatementLineDTO, "increase" | "decrease">): { debit: bigint; credit: bigint } {
  const increase = parseMoney(line.increase);
  const decrease = parseMoney(line.decrease);
  return kind === "customer" ? { debit: increase, credit: decrease } : { debit: decrease, credit: increase };
}

/**
 * كشف حساب العميل / المورد — every movement the aging ladder is built from, in
 * base currency, read from the server so it cannot disagree with the ladder
 * or with what the list screen says the party owes.
 */
export function PartyStatementTab({ kind, partyId }: { kind: PartyKind; partyId: string }) {
  const { t } = useAppTranslation();
  const query = usePartyStatement(kind, partyId);
  const ns = kind === "customer" ? "customers" : "suppliers";
  const key = (suffix: string) => `${ns}.statement.${suffix}` as AppTranslationKey;

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t(key("loadFailed"))}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }
  if (query.isLoading || !query.data) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t(key("loading"))}</p>;

  const statement = query.data;
  const opening = statement.lines
    .filter((line) => line.kind === "opening")
    .reduce<bigint>((total, line) => total + parseMoney(line.increase) - parseMoney(line.decrease), 0n);
  const totals = sides(kind, { increase: statement.totalIncrease, decrease: statement.totalDecrease });
  const closing = parseMoney(statement.closing);
  const agingTotal = parseMoney(statement.agingTotal);
  const matchesAging = closing === agingTotal;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label={t(key("opening"))} value={<MoneyValue value={moneyToNumber(opening)} showUnit={false} />} />
        <MiniStat label={t(key("totalDebit"))} value={<MoneyValue value={moneyToNumber(totals.debit)} showUnit={false} />} />
        <MiniStat label={t(key("totalCredit"))} value={<MoneyValue value={moneyToNumber(totals.credit)} showUnit={false} />} />
        <MiniStat label={t(key("closing"))} value={<MoneyValue value={moneyToNumber(closing)} showUnit={false} />} />
      </div>

      <div className="flex flex-wrap items-center gap-[10px] rounded-lg border border-border bg-surface p-[12px_15px]">
        <StatusPill label={matchesAging ? t(key("matchesAging")) : t(key("differsFromAging"))} tone={matchesAging ? "success" : "warning"} />
        <span className="text-[12px] text-ink-muted">
          {t(key("reportBalance"))} <MoneyValue value={moneyToNumber(agingTotal)} showUnit={false} className="text-ink" />
          {matchesAging ? t(key("agingMatchNote")) : t(key("agingDiffNote"))}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("common.date")}</th>
              <th className="p-[10px] text-start font-semibold">{t(key("col.movement"))}</th>
              <th className="p-[10px] text-start font-semibold">{t(key("col.reference"))}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.debit")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.credit")}</th>
              <th className="p-[10px] text-end font-semibold">{t(key("col.balance"))}</th>
            </tr>
          </thead>
          <tbody>
            {statement.lines.map((line) => {
              const { debit, credit } = sides(kind, line);
              const moved = parseMoney(line.increase) + parseMoney(line.decrease);
              const allocated = line.allocations.reduce<bigint>((total, a) => total + parseMoney(a.amount), 0n);
              const notes = [
                ...line.allocations.map((a) => t(key("allocatedTo"), { invoice: a.invoiceRef })),
                ...((line.kind === "receipt" || line.kind === "payment") && moved > allocated ? [t(key("unallocated"))] : []),
              ];
              return (
                <tr key={line.key} className="border-b border-border last:border-b-0">
                  <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(line.date)}</td>
                  <td className="p-[10px] text-ink">
                    {t(MOVEMENT_LABEL[kind][line.kind])}
                    {notes.map((note) => (
                      <div key={note} className="mt-[3px] text-[11px] text-ink-faint">{note}</div>
                    ))}
                  </td>
                  <td className="mz-num p-[10px] text-ink-muted">{line.reference || "—"}</td>
                  <td className="p-[10px] text-end text-ink">
                    {debit === 0n ? "—" : <MoneyValue value={moneyToNumber(debit)} showUnit={false} />}
                  </td>
                  <td className="p-[10px] text-end text-ink">
                    {credit === 0n ? "—" : <MoneyValue value={moneyToNumber(credit)} showUnit={false} />}
                  </td>
                  <td className="p-[10px] text-end font-semibold text-ink">
                    <MoneyValue value={moneyToNumber(parseMoney(line.balance))} showUnit={false} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="max-w-[80ch] text-[11.5px] leading-[1.9] text-ink-faint">{t(key("footnote"))}</p>
    </div>
  );
}

import { Card, Money as MoneyValue } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { ReturnFamily, useAccounts, useJournalEntry, useTaxRates } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { EMPTY } from "../lib/empty";
import { NameJournalLineTaxAction } from "./NameJournalLineTaxAction";

export interface ReturnWithJournal {
  readonly id: string;
  readonly docNo: string | null;
  readonly status: string;
  readonly journalEntryId: string | null;
  readonly reversesDocId: string | null;
  readonly lines: readonly { readonly itemId: string; readonly taxRatePercent?: number | null; readonly taxRateId?: string | null }[];
}

const CELL = "px-[15px] py-[11px]";
const HEAD = "border-b border-border bg-surface-2 px-[15px] py-[10px] text-[11px] font-bold uppercase text-ink-muted";
const POSTED_STATUS = "confirmed";

export function ReturnJournalCard({ family, document, lineLabel }: { family: ReturnFamily; document: ReturnWithJournal; lineLabel: (itemId: string) => string }) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const mayReadJournal = sessionMayRead(session, DocumentReadPermission.JournalEntries);
  const entryQuery = useJournalEntry(mayReadJournal ? document.journalEntryId : null);
  const accounts = useAccounts().data ?? EMPTY;
  const taxRates = useTaxRates().data ?? EMPTY;
  if (!mayReadJournal || !document.journalEntryId || !entryQuery.data) return null;

  const accountLabel = (id: string) => {
    const account = accounts.find((candidate) => candidate.id === id);
    return account ? `${account.code} — ${account.nameAr}` : id;
  };

  return (
    <Card className="p-[16px_18px]">
      <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">{t("returnJournal.heading")}</h3>
      <NameJournalLineTaxAction
        document={family}
        documentId={document.id}
        journalEntryId={document.journalEntryId}
        posted={document.status === POSTED_STATUS && document.reversesDocId === null}
        lines={document.lines.flatMap((line, index) =>
          line.taxRatePercent === null || line.taxRatePercent === undefined
            ? []
            : [{ lineId: String(index), label: lineLabel(line.itemId), taxRatePercent: line.taxRatePercent, taxRateId: line.taxRateId ?? null }],
        )}
        taxRates={taxRates}
        accountLabel={accountLabel}
      />
      <div className="mb-[12px] text-[13px] text-ink-muted">
        {t("salesInvoices.journal.entryNo")} <span className="mz-num font-semibold text-ink">{entryQuery.data.entryNo ?? document.docNo}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} text-start`}>{t("salesInvoices.journal.account")}</th>
              <th scope="col" className={`${HEAD} text-end`}>{t("common.debit")}</th>
              <th scope="col" className={`${HEAD} text-end`}>{t("common.credit")}</th>
            </tr>
          </thead>
          <tbody>
            {entryQuery.data.lines.map((line, index) => (
              <tr key={index} className="border-b border-border last:border-b-0">
                <td className={`${CELL} text-ink`}>{accountLabel(line.accountId)}</td>
                <td className={`${CELL} text-end`}><MoneyValue value={line.debit} showUnit={false} /></td>
                <td className={`${CELL} text-end`}><MoneyValue value={line.credit} showUnit={false} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

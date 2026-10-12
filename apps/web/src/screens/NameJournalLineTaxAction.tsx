import { useMemo, useState } from "react";
import { Button, Checkbox, SidePanel } from "@mezan/ui";
import { TaxRateStatusCode } from "@mezan/domain";
import type { TaxRateDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { ClassifiableDocument, useJournalEntry, useNameJournalLineTax, useVatEnabled } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { SelectField } from "../settings/form-controls";
import { CLASSIFY_PERMISSION, type ClassifiableLine } from "./ClassifyLineTaxAction";

export interface NameJournalLineTaxActionProps {
  readonly document: ClassifiableDocument;
  readonly documentId: string;
  readonly journalEntryId: string | null;
  readonly posted: boolean;
  readonly lines: readonly ClassifiableLine[];
  readonly taxRates: readonly TaxRateDTO[];
  readonly accountLabel: (accountId: string) => string;
}

export function NameJournalLineTaxAction({ document, documentId, journalEntryId, posted, lines, taxRates, accountLabel }: NameJournalLineTaxActionProps) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const permitted =
    posted && sessionMayRead(session, CLASSIFY_PERMISSION[document]) && sessionMayRead(session, DocumentReadPermission.JournalEntries);
  const entryQuery = useJournalEntry(permitted ? journalEntryId : null);
  const nameTax = useNameJournalLineTax(document);
  const vatEnabled = useVatEnabled();
  const [open, setOpen] = useState(false);
  const [lineId, setLineId] = useState("");
  const [taxRateId, setTaxRateId] = useState("");
  const [chosen, setChosen] = useState<readonly number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const untagged = useMemo(
    () => (entryQuery.data?.lines ?? []).map((line, index) => ({ line, index })).filter(({ line }) => (line.taxRateId ?? null) === null),
    [entryQuery.data],
  );
  const namedRateIds = useMemo(() => new Set((entryQuery.data?.lines ?? []).map((line) => line.taxRateId ?? null)), [entryQuery.data]);
  const pending = useMemo(
    () => lines.filter((line) => line.taxRateId === null || !namedRateIds.has(line.taxRateId)),
    [lines, namedRateIds],
  );
  const target = pending.find((line) => line.lineId === lineId) ?? null;
  const systemRateApplies = document === ClassifiableDocument.SalesInvoice && vatEnabled === false;
  const candidates = taxRates.filter(
    (rate) => target !== null && rate.status === TaxRateStatusCode.Active && rate.rate === target.taxRatePercent && (rate.isSystem !== true || systemRateApplies),
  );

  if (!permitted || !entryQuery.data || pending.length === 0 || untagged.length === 0) return null;

  function openPanel() {
    setError(null);
    setLineId(pending[0]?.lineId ?? "");
    setTaxRateId("");
    setChosen([]);
    setOpen(true);
  }

  function toggle(index: number) {
    setChosen((current) => (current.includes(index) ? current.filter((other) => other !== index) : [...current, index]));
  }

  async function submit() {
    if (nameTax.isPending || !target) return;
    if (target.taxRateId === null && taxRateId === "") {
      setError(t("classifyTax.error.pickRate"));
      return;
    }
    if (chosen.length === 0) {
      setError(t("journalTax.error.pickLines"));
      return;
    }
    setError(null);
    try {
      await nameTax.mutateAsync({
        documentId,
        lineId: target.lineId,
        journalLineIndexes: chosen,
        ...(target.taxRateId === null ? { taxRateId } : {}),
        withLineIds: target.taxRateId === null
          ? lines.filter((other) => other.lineId !== target.lineId && other.taxRateId === null && other.taxRatePercent === target.taxRatePercent).map((other) => other.lineId)
          : [],
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("classifyTax.error.failed"));
    }
  }

  return (
    <>
      <div role="status" className="mb-[12px] flex flex-wrap items-center gap-[10px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
        <span>{t("journalTax.notice")}</span>
        <Button type="button" size="sm" onClick={openPanel}>
          {t("journalTax.action")}
        </Button>
      </div>
      <SidePanel open={open} onClose={() => setOpen(false)} title={t("journalTax.title")}>
        <form
          className="flex flex-col gap-[14px]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}
          <p className="text-[12px] text-ink-muted">{t("journalTax.explain")}</p>
          <SelectField
            label={t("journalTax.documentLine")}
            value={lineId}
            onChange={(next) => {
              setLineId(next);
              setTaxRateId("");
            }}
            options={pending.map((line) => ({ value: line.lineId, label: t("journalTax.lineOption", { line: line.label, percent: line.taxRatePercent }) }))}
          />
          {target && target.taxRateId === null ? (
            <SelectField
              label={t("classifyTax.rate")}
              value={taxRateId}
              onChange={setTaxRateId}
              options={[
                { value: "", label: t("classifyTax.pickRate") },
                ...candidates.map((rate) => ({ value: rate.id, label: t("taxRateField.option", { name: rate.name, rate: rate.rate }) })),
              ]}
            />
          ) : null}
          <fieldset className="flex flex-col gap-[8px]">
            <legend className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("journalTax.entryLines")}</legend>
            {untagged.map(({ line, index }) => (
              <Checkbox
                key={index}
                checked={chosen.includes(index)}
                onChange={() => toggle(index)}
                label={t("journalTax.entryLine", {
                  no: index + 1,
                  account: accountLabel(line.accountId),
                  debit: line.debit,
                  credit: line.credit,
                })}
              />
            ))}
          </fieldset>
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={nameTax.isPending}>
              {t("journalTax.confirm")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </>
  );
}

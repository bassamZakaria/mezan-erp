import { useMemo, useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import { TaxRateStatusCode } from "@mezan/domain";
import { InvoiceDocumentKind, TaxClassificationFilingOutcomeCode, type TaxRateDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { ClassifiableDocument, useClassifyLineTax, useRetryEtaReceipt, useVatEnabled } from "../data/hooks";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { useNavigation } from "../navigation";
import { pickLocalized } from "../data/server-message";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { SelectField } from "../settings/form-controls";

export interface ClassifiableLine {
  readonly lineId: string;
  readonly label: string;
  readonly taxRatePercent: number;
  readonly taxRateId: string | null;
}

export const CLASSIFY_PERMISSION: Record<ClassifiableDocument, DocumentReadPermission> = {
  [ClassifiableDocument.SalesInvoice]: DocumentReadPermission.SalesInvoiceClassifyTax,
  [ClassifiableDocument.PurchaseInvoice]: DocumentReadPermission.PurchaseInvoiceClassifyTax,
};

const RECEIPT_OUTCOME_MESSAGE: Partial<Record<TaxClassificationFilingOutcomeCode, AppTranslationKey>> = {
  [TaxClassificationFilingOutcomeCode.Issued]: "classifyTax.outcome.issued",
  [TaxClassificationFilingOutcomeCode.Reissued]: "classifyTax.outcome.reissued",
  [TaxClassificationFilingOutcomeCode.ReissuePending]: "classifyTax.outcome.reissuePending",
  [TaxClassificationFilingOutcomeCode.ReissueRefused]: "classifyTax.outcome.reissueRefused",
  [TaxClassificationFilingOutcomeCode.ReissueFailed]: "classifyTax.outcome.reissueFailed",
};

interface ReceiptOutcome {
  readonly text: string;
  readonly failed: boolean;
}

export interface ClassifyLineTaxActionProps {
  readonly document: ClassifiableDocument;
  readonly documentId: string;
  readonly posted: boolean;
  readonly documentKind?: InvoiceDocumentKind;
  readonly line: ClassifiableLine;
  readonly lines: readonly ClassifiableLine[];
  readonly taxRates: readonly TaxRateDTO[];
  readonly openedExternally?: boolean;
  readonly onClosed?: () => void;
}

export function ClassifyLineTaxAction({ document, documentId, posted, documentKind, line, lines, taxRates, openedExternally = false, onClosed }: ClassifyLineTaxActionProps) {
  const { t, locale } = useAppTranslation();
  const { session } = useApi();
  const { navigate } = useNavigation();
  const classify = useClassifyLineTax(document);
  const vatEnabled = useVatEnabled();
  const [open, setOpen] = useState(openedExternally);
  const [taxRateId, setTaxRateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const retryReceipt = useRetryEtaReceipt();
  const [receiptOutcome, setReceiptOutcome] = useState<ReceiptOutcome | null>(null);

  const systemRateApplies = document === ClassifiableDocument.SalesInvoice && vatEnabled === false;
  const candidates = useMemo(
    () => taxRates.filter((rate) => rate.status === TaxRateStatusCode.Active && rate.rate === line.taxRatePercent && (rate.isSystem !== true || systemRateApplies)),
    [taxRates, line.taxRatePercent, systemRateApplies],
  );
  const companions = useMemo(
    () => lines.filter((other) => other.lineId !== line.lineId && other.taxRateId === null && other.taxRatePercent === line.taxRatePercent),
    [lines, line.lineId, line.taxRatePercent],
  );

  const permitted = sessionMayRead(session, CLASSIFY_PERMISSION[document]);
  const mayManageRates = sessionMayRead(session, DocumentReadPermission.TaxRatesManage);
  const classified = line.taxRateId !== null;
  if (!posted || documentKind === InvoiceDocumentKind.RetentionRelease || !permitted) return null;
  // INVARIANT: the document reloads with the line classified the moment the
  // classification lands. What became of its e-receipt — and the retry — is
  // still on screen then, and must outlive that reload.
  if (classified && receiptOutcome === null) return null;

  function openPanel() {
    setError(null);
    setReceiptOutcome(null);
    setTaxRateId("");
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
    setReceiptOutcome(null);
    onClosed?.();
  }

  async function submit() {
    if (classify.isPending) return;
    if (taxRateId === "") {
      setError(t("classifyTax.error.pickRate"));
      return;
    }
    setError(null);
    try {
      const result = await classify.mutateAsync({ documentId, lineId: line.lineId, taxRateId, withLineIds: companions.map((other) => other.lineId) });
      const outcome = outcomeOf(result.filing, pickLocalized(result.filingMessage, result.filingMessageEn, locale));
      if (!outcome) {
        closePanel();
        return;
      }
      setReceiptOutcome(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("classifyTax.error.failed"));
    }
  }

  function outcomeOf(filing: TaxClassificationFilingOutcomeCode | null, message?: string): ReceiptOutcome | null {
    const outcomeKey = filing ? RECEIPT_OUTCOME_MESSAGE[filing] : undefined;
    if (!outcomeKey) return null;
    return { text: message ? `${t(outcomeKey)} ${message}` : t(outcomeKey), failed: filing === TaxClassificationFilingOutcomeCode.ReissueFailed };
  }

  async function retry() {
    if (retryReceipt.isPending) return;
    try {
      const result = await retryReceipt.mutateAsync({ documentId });
      setReceiptOutcome(outcomeOf(result.filing, pickLocalized(result.filingMessage, result.filingMessageEn, locale)) ?? { text: t("classifyTax.outcome.nothingLeft"), failed: false });
    } catch (err) {
      setReceiptOutcome({ text: err instanceof Error ? err.message : t("classifyTax.outcome.reissueFailed"), failed: true });
    }
  }

  return (
    <>
      {openedExternally || classified ? null : (
        <Button type="button" size="sm" onClick={openPanel} aria-label={t("classifyTax.actionFor", { line: line.label })}>
          {t("classifyTax.action")}
        </Button>
      )}
      <SidePanel open={open} onClose={closePanel} title={t("classifyTax.title")}>
        {receiptOutcome ? (
          <div className="flex flex-col gap-[14px]">
            <div role="status" className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
              <p className="font-semibold">{t("classifyTax.outcome.classified", { line: line.label })}</p>
              {receiptOutcome.failed ? null : <p className="mt-[6px]">{receiptOutcome.text}</p>}
            </div>
            {receiptOutcome.failed ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {receiptOutcome.text}
              </div>
            ) : null}
            <div className="flex justify-end gap-[9px]">
              {receiptOutcome.failed ? (
                <Button type="button" onClick={() => void retry()} disabled={retryReceipt.isPending}>
                  {t("classifyTax.outcome.retry")}
                </Button>
              ) : null}
              <Button type="button" variant="primary" onClick={closePanel}>
                {t("classifyTax.done")}
              </Button>
            </div>
          </div>
        ) : (
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
          <p className="text-[13px] text-ink">{t("classifyTax.lineSummary", { line: line.label, percent: line.taxRatePercent })}</p>
          <p className="text-[12px] text-ink-muted">{t("classifyTax.explain")}</p>
          {candidates.length === 0 ? (
            <div role="status" className="flex flex-col items-start gap-[8px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink-muted">
              <span>{t(line.taxRatePercent === 0 ? "classifyTax.noZeroRates" : "classifyTax.noRates", { percent: line.taxRatePercent })}</span>
              {mayManageRates ? (
                <Button type="button" size="sm" onClick={() => navigate("taxes")}>
                  {t("classifyTax.openTaxRates")}
                </Button>
              ) : (
                <span>{t("classifyTax.askForRate")}</span>
              )}
            </div>
          ) : (
            <SelectField
              label={t("classifyTax.rate")}
              value={taxRateId}
              onChange={setTaxRateId}
              options={[
                { value: "", label: t("classifyTax.pickRate") },
                ...candidates.map((rate) => ({ value: rate.id, label: t("taxRateField.option", { name: rate.name, rate: rate.rate }) })),
              ]}
            />
          )}
          {companions.length > 0 ? (
            <div className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
              <p className="font-semibold">{t("classifyTax.companions", { percent: line.taxRatePercent })}</p>
              <ul className="mt-[6px] list-disc ps-[18px]">
                {companions.map((other) => (
                  <li key={other.lineId}>{other.label}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={closePanel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={classify.isPending || candidates.length === 0}>
              {t("classifyTax.confirm")}
            </Button>
          </div>
        </form>
        )}
      </SidePanel>
    </>
  );
}

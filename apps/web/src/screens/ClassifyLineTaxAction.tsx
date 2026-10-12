import { useMemo, useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import { TaxRateStatusCode } from "@mezan/domain";
import { InvoiceDocumentKind, TaxClassificationFilingOutcomeCode, type TaxRateDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { ClassifiableDocument, useClassifyLineTax, useVatEnabled } from "../data/hooks";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { useNavigation } from "../navigation";
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
  [TaxClassificationFilingOutcomeCode.Reissued]: "classifyTax.outcome.reissued",
  [TaxClassificationFilingOutcomeCode.ReissuePending]: "classifyTax.outcome.reissuePending",
  [TaxClassificationFilingOutcomeCode.ReissueRefused]: "classifyTax.outcome.reissueRefused",
};

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
  const { t } = useAppTranslation();
  const { session } = useApi();
  const { navigate } = useNavigation();
  const classify = useClassifyLineTax(document);
  const vatEnabled = useVatEnabled();
  const [open, setOpen] = useState(openedExternally);
  const [taxRateId, setTaxRateId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [receiptOutcome, setReceiptOutcome] = useState<string | null>(null);

  // The system's rate classifies a sale only for a tenant outside VAT; the
  // server refuses it everywhere else, so it is offered nowhere else.
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
  if (!posted || documentKind === InvoiceDocumentKind.RetentionRelease || line.taxRateId !== null || !permitted) return null;

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
      const outcomeKey = RECEIPT_OUTCOME_MESSAGE[result.filing];
      if (!outcomeKey) {
        closePanel();
        return;
      }
      setReceiptOutcome(result.filingMessage ? `${t(outcomeKey)} ${result.filingMessage}` : t(outcomeKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("classifyTax.error.failed"));
    }
  }

  return (
    <>
      {openedExternally ? null : (
        <Button type="button" size="sm" onClick={openPanel} aria-label={t("classifyTax.actionFor", { line: line.label })}>
          {t("classifyTax.action")}
        </Button>
      )}
      <SidePanel open={open} onClose={closePanel} title={t("classifyTax.title")}>
        {receiptOutcome ? (
          <div className="flex flex-col gap-[14px]">
            <div role="status" className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
              <p className="font-semibold">{t("classifyTax.outcome.classified", { line: line.label })}</p>
              <p className="mt-[6px]">{receiptOutcome}</p>
            </div>
            <div className="flex justify-end">
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

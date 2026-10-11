import { useMemo, useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import { TaxRateStatusCode } from "@mezan/domain";
import { InvoiceDocumentKind, type TaxRateDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { ClassifiableDocument, useClassifyLineTax } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { SelectField } from "../settings/form-controls";

export interface ClassifiableLine {
  readonly lineId: string;
  readonly label: string;
  readonly taxRatePercent: number;
  readonly taxRateId: string | null;
}

const PERMISSION: Record<ClassifiableDocument, string> = {
  [ClassifiableDocument.SalesInvoice]: "sales.invoice.classify_tax",
  [ClassifiableDocument.PurchaseInvoice]: "purchases.invoice.classify_tax",
};

export interface ClassifyLineTaxActionProps {
  readonly document: ClassifiableDocument;
  readonly documentId: string;
  readonly posted: boolean;
  readonly documentKind?: InvoiceDocumentKind;
  readonly line: ClassifiableLine;
  readonly lines: readonly ClassifiableLine[];
  readonly taxRates: readonly TaxRateDTO[];
  /** Opened by another control that carries the label itself: the dialog renders alone, already open. */
  readonly openedExternally?: boolean;
  readonly onClosed?: () => void;
}

export function ClassifyLineTaxAction({ document, documentId, posted, documentKind, line, lines, taxRates, openedExternally = false, onClosed }: ClassifyLineTaxActionProps) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const classify = useClassifyLineTax(document);
  const [open, setOpen] = useState(openedExternally);
  const [taxRateId, setTaxRateId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      taxRates.filter(
        (rate) =>
          rate.status === TaxRateStatusCode.Active &&
          rate.rate === line.taxRatePercent &&
          !(document === ClassifiableDocument.SalesInvoice && rate.isSystem === true),
      ),
    [taxRates, line.taxRatePercent, document],
  );
  const companions = useMemo(
    () => lines.filter((other) => other.lineId !== line.lineId && other.taxRateId === null && other.taxRatePercent === line.taxRatePercent),
    [lines, line.lineId, line.taxRatePercent],
  );

  const permissions = session?.permissions ?? [];
  const permitted = permissions.includes("*") || permissions.includes(PERMISSION[document]);
  if (!posted || documentKind === InvoiceDocumentKind.RetentionRelease || line.taxRateId !== null || !permitted) return null;

  function openPanel() {
    setError(null);
    setTaxRateId("");
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
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
      await classify.mutateAsync({ documentId, lineId: line.lineId, taxRateId, withLineIds: companions.map((other) => other.lineId) });
      closePanel();
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
            <div role="status" className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink-muted">
              {t("classifyTax.noRates", { percent: line.taxRatePercent })}
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
      </SidePanel>
    </>
  );
}

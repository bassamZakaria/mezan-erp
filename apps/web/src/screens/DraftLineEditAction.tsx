import { useState } from "react";
import { Button, SidePanel } from "@mezan/ui";
import type { TaxRateDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { DocumentReadPermission, sessionMayRead } from "../data/document-read-permissions";
import { useEditSalesInvoiceDraftLine, type SalesInvoiceDTO } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { SelectField, TextField } from "../settings/form-controls";
import { selectableTaxRates } from "./tax-rate-field";

const DRAFT_STATUS: SalesInvoiceDTO["status"] = "draft";
const EXACT_DECIMAL = /^\d+(\.\d{1,6})?$/;
const KEEP_RATE = "";

export interface DraftLineEditActionProps {
  readonly invoice: SalesInvoiceDTO;
  readonly line: SalesInvoiceDTO["lines"][number];
  readonly taxRates: readonly TaxRateDTO[];
}

export function DraftLineEditAction({ invoice, line, taxRates }: DraftLineEditActionProps) {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const edit = useEditSalesInvoiceDraftLine();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [taxRateId, setTaxRateId] = useState(KEEP_RATE);
  const [error, setError] = useState<string | null>(null);

  if (invoice.status !== DRAFT_STATUS || !sessionMayRead(session, DocumentReadPermission.SalesInvoiceEdit)) return null;

  function openPanel() {
    setError(null);
    setQty(trimZeros(line.qty));
    setUnitPrice(trimZeros(line.unitPrice));
    setTaxRateId(KEEP_RATE);
    setOpen(true);
  }

  async function submit() {
    if (edit.isPending) return;
    if (!EXACT_DECIMAL.test(qty.trim()) || !EXACT_DECIMAL.test(unitPrice.trim())) {
      setError(t("draftLine.error.figures"));
      return;
    }
    const change = {
      ...(qty.trim() !== trimZeros(line.qty) ? { qty: qty.trim() } : {}),
      ...(unitPrice.trim() !== trimZeros(line.unitPrice) ? { unitPrice: unitPrice.trim() } : {}),
      ...(taxRateId !== KEEP_RATE && taxRateId !== (line.taxRateId ?? KEEP_RATE) ? { taxRateId } : {}),
    };
    if (Object.keys(change).length === 0) {
      setOpen(false);
      return;
    }
    setError(null);
    try {
      await edit.mutateAsync({ invoiceId: invoice.id, lineId: line.lineId, ...change });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("draftLine.error.failed"));
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={openPanel} aria-label={t("draftLine.actionFor", { line: line.itemNameAr })}>
        {t("draftLine.action")}
      </Button>
      <SidePanel open={open} onClose={() => setOpen(false)} title={t("draftLine.title")}>
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
          <p className="text-[13px] text-ink">{t("draftLine.summary", { line: line.itemNameAr })}</p>
          <TextField label={t("salesInvoices.field.qty")} value={qty} onChange={setQty} />
          <TextField label={t("salesInvoices.field.price")} value={unitPrice} onChange={setUnitPrice} />
          <SelectField
            label={t("taxRateField.label")}
            value={taxRateId}
            onChange={setTaxRateId}
            options={[
              { value: KEEP_RATE, label: t("draftLine.keepRate") },
              ...selectableTaxRates(taxRates, null).map((rate) => ({ value: rate.id, label: t("taxRateField.option", { name: rate.name, rate: rate.rate }) })),
            ]}
          />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={edit.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </>
  );
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

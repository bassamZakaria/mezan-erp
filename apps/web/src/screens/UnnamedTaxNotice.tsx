import { InvoiceDocumentKind } from "@mezan/contracts";
import { ClassifiableDocument } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import type { ClassifiableLine } from "./ClassifyLineTaxAction";

const MESSAGE: Record<ClassifiableDocument, AppTranslationKey> = {
  [ClassifiableDocument.SalesInvoice]: "classifyTax.unnamedZeroSales",
  [ClassifiableDocument.PurchaseInvoice]: "classifyTax.unnamedZeroPurchase",
};

export interface UnnamedTaxNoticeProps {
  readonly document: ClassifiableDocument;
  readonly posted: boolean;
  readonly documentKind?: InvoiceDocumentKind;
  readonly lines: readonly ClassifiableLine[];
}

export function UnnamedTaxNotice({ document, posted, documentKind, lines }: UnnamedTaxNoticeProps) {
  const { t } = useAppTranslation();
  if (!posted || documentKind === InvoiceDocumentKind.RetentionRelease) return null;
  const unnamed = lines.filter((line) => line.taxRateId === null && line.taxRatePercent === 0);
  if (unnamed.length === 0) return null;
  return (
    <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
      {t(MESSAGE[document], { lines: unnamed.map((line) => `«${line.label}»`).join(t("dataMigration.reasonSeparator")), action: t("classifyTax.action") })}
    </div>
  );
}

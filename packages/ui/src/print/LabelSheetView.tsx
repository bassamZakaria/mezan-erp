import { useMemo } from "react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/cn";
import { Barcode128 } from "./Barcode128";
import { PrintToolbar } from "./PrintToolbar";

/**
 * ورقة ملصقات (label sheet) — the second printable view in the print
 * subsystem, alongside `PrintView`. It shares that pipeline rather than
 * inventing a parallel one: the same `PrintToolbar` (window.print / Electron
 * printToPDF), the same `@page` + `print:` stylesheet approach, the same
 * RTL page DOM. What differs is the model: a document renders ONE flowing
 * page of lines, a label sheet renders a fixed grid of small labels whose
 * geometry comes from the tenant's `LabelLayout`.
 *
 * Prices arrive as exact decimal STRINGS (the Money wire format) and are
 * trimmed for display by string surgery — no label ever converts money to a
 * float, not even to render it.
 */

export interface LabelSheetLayout {
  pageSize: "A4" | "A5";
  columns: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  columnGapMm: number;
  rowGapMm: number;
  marginBlockMm: number;
  marginInlineMm: number;
  showItemName: boolean;
  showItemCode: boolean;
  showPrice: boolean;
  showUnit: boolean;
  showBarcode: boolean;
  showBarcodeText: boolean;
  barcodeHeightMm: number;
}

export interface LabelSheetEntry {
  key: string;
  name: string;
  code?: string;
  unit?: string;
  /** Exact decimal string (Money wire format), or null when the item has no price. */
  price?: string | null;
  barcode?: string | null;
  /** How many copies of this label to print. */
  copies: number;
}

export interface LabelSheetViewProps {
  layout: LabelSheetLayout;
  entries: readonly LabelSheetEntry[];
  /** Printed under the price, e.g. "ج.م". */
  currencyLabel?: string;
  showToolbar?: boolean;
  className?: string;
}

const PAGE_MM: Record<"A4" | "A5", { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
};

/** Trims an exact decimal string to two fraction digits without ever parsing it as a number. */
export function trimMoneyString(value: string, fractionDigits = 2): string {
  const [intPart = "0", fracPart = ""] = value.split(".");
  if (fractionDigits === 0) return intPart;
  return `${intPart}.${(fracPart + "000000").slice(0, fractionDigits)}`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export function LabelSheetView({
  layout,
  entries,
  currencyLabel,
  showToolbar = true,
  className,
}: LabelSheetViewProps) {
  const { t } = useTranslation();
  const currency = currencyLabel ?? t("ui.currency");
  const perPage = Math.max(1, layout.columns * layout.rows);
  const page = PAGE_MM[layout.pageSize];

  const pages = useMemo(() => {
    const flat: { key: string; entry: LabelSheetEntry }[] = [];
    for (const entry of entries) {
      const copies = Math.max(0, Math.floor(entry.copies));
      for (let i = 0; i < copies; i += 1) flat.push({ key: `${entry.key}-${i}`, entry });
    }
    return chunk(flat, perPage);
  }, [entries, perPage]);

  const nameSizePt = Math.min(11, Math.max(6, layout.labelHeightMm * 0.2));
  const metaSizePt = Math.min(9, Math.max(5, layout.labelHeightMm * 0.14));
  const priceSizePt = Math.min(13, Math.max(7, layout.labelHeightMm * 0.24));

  return (
    <div className={cn("mz-print-root", className)}>
      <style>{`@page { size: ${layout.pageSize}; margin: 0; }`}</style>

      {showToolbar ? <PrintToolbar pageSize={layout.pageSize} /> : null}

      {pages.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-2 p-[14px] text-[12.5px] text-ink-muted print:hidden">
          {t("print.labels.empty")}
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-[14px] print:gap-0">
        {pages.map((labels, pageIndex) => (
          <div
            key={pageIndex}
            dir="rtl"
            className="bg-surface shadow-sm print:shadow-none"
            style={{
              width: `${page.width}mm`,
              height: `${page.height}mm`,
              paddingBlock: `${layout.marginBlockMm}mm`,
              paddingInline: `${layout.marginInlineMm}mm`,
              display: "grid",
              gridTemplateColumns: `repeat(${layout.columns}, ${layout.labelWidthMm}mm)`,
              gridAutoRows: `${layout.labelHeightMm}mm`,
              columnGap: `${layout.columnGapMm}mm`,
              rowGap: `${layout.rowGapMm}mm`,
              justifyContent: "center",
              alignContent: "start",
              breakAfter: pageIndex === pages.length - 1 ? "auto" : "page",
            }}
          >
            {labels.map(({ key, entry }) => (
              <div
                key={key}
                className="flex flex-col items-center justify-center overflow-hidden border border-dashed border-border text-center text-ink print:border-transparent"
                style={{ padding: "1mm", gap: "0.6mm" }}
              >
                {layout.showItemName ? (
                  <div
                    className="w-full overflow-hidden font-semibold leading-tight"
                    style={{ fontSize: `${nameSizePt}pt` }}
                  >
                    {entry.name}
                  </div>
                ) : null}

                {layout.showItemCode || layout.showUnit ? (
                  <div
                    className="flex w-full items-center justify-center leading-tight text-ink-muted"
                    style={{ fontSize: `${metaSizePt}pt`, gap: "2mm" }}
                  >
                    {layout.showItemCode && entry.code ? <span className="mz-num">{entry.code}</span> : null}
                    {layout.showUnit && entry.unit ? <span>{entry.unit}</span> : null}
                  </div>
                ) : null}

                {layout.showBarcode && entry.barcode ? (
                  <div className="w-full" style={{ height: `${layout.barcodeHeightMm}mm` }}>
                    <Barcode128 value={entry.barcode} />
                  </div>
                ) : null}

                {layout.showBarcode && layout.showBarcodeText && entry.barcode ? (
                  <div dir="ltr" className="mz-num leading-none tracking-[0.5px]" style={{ fontSize: `${metaSizePt}pt` }}>
                    {entry.barcode}
                  </div>
                ) : null}

                {layout.showPrice && entry.price ? (
                  <div className="font-bold leading-none" style={{ fontSize: `${priceSizePt}pt` }}>
                    <span className="mz-num">{trimMoneyString(entry.price)}</span> {currency}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

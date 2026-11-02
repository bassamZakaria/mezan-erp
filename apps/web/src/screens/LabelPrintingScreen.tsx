import { useMemo, useState } from "react";
import bwipjs from "bwip-js/browser";
import {
  Button,
  Card,
  QtyInput,
  Select,
} from "@mezan/ui";
import type { ItemDTO } from "@mezan/contracts";
import { buildLabelBatch, LABEL_TEMPLATES, Money, type LabelBatchLineInput, type LabelTemplateCode } from "@mezan/domain";
import { pickLocalized } from "../data/server-message";
import { ItemPicker } from "./ItemPicker";
import { useAppTranslation } from "../i18n";
import { codedLabel } from "../domain-labels";

/**
 * طباعة الملصقات (Label Printing) — docs/archive/catalog/03-inventory.md §"طباعة
 * الملصقات". A stateless print builder (nothing persisted until printed,
 * exactly like the reference screen): pick items + a label template, get a
 * live barcode-fit check per item (`checkBarcodeFit`/`buildLabelBatch` in
 * `@mezan/domain`), preview, and print through the same
 * window.print()/`@page` pipeline every other printable document in this app
 * uses (see `packages/ui/src/print/PrintView.tsx`).
 */

interface SelectedLine {
  itemId: string;
  nameAr: string;
  code: string;
  barcode: string;
  priceMajor: string;
  copies: number;
}

function renderBarcodeSvg(barcode: string): string | null {
  const trimmed = barcode.trim();
  if (trimmed === "") return null;
  try {
    return bwipjs.toSVG({ bcid: "code128", text: trimmed, scale: 2, height: 10, includetext: false });
  } catch {
    return null;
  }
}

function LabelTile({ line, template }: { line: SelectedLine; template: (typeof LABEL_TEMPLATES)[number] }) {
  const { t } = useAppTranslation();
  const svg = useMemo(() => renderBarcodeSvg(line.barcode), [line.barcode]);
  return (
    <div
      className="mz-label-tile flex flex-col items-center justify-between gap-[3px] overflow-hidden border border-dashed border-border bg-surface p-[2mm] text-center"
      style={{ width: `${template.widthMm}mm`, height: `${template.heightMm}mm` }}
    >
      <div className="w-full truncate text-[9px] font-bold text-ink" dir="rtl">
        {line.nameAr}
      </div>
      {svg ? (
        <div className="mz-label-barcode w-full flex-1" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="flex-1 text-[8px] text-ink-faint">{t("labelPrinting.noBarcode")}</div>
      )}
      <div className="flex w-full items-center justify-between text-[8px] text-ink-muted">
        <span className="mz-num">{line.code}</span>
        <span className="mz-num font-bold text-ink">{line.priceMajor} {t("ui.currency")}</span>
      </div>
    </div>
  );
}

export function LabelPrintingScreen() {
  const { t, locale } = useAppTranslation();
  const [lines, setLines] = useState<SelectedLine[]>([]);
  const [templateCode, setTemplateCode] = useState<LabelTemplateCode>("THERMAL_40x30");

  const chosenIds = useMemo(() => new Set(lines.map((l) => l.itemId)), [lines]);

  function addItem(item: ItemDTO | null) {
    if (!item || chosenIds.has(item.id)) return;
    setLines((prev) => [
      ...prev,
      {
        itemId: item.id,
        nameAr: item.nameAr,
        code: item.code,
        barcode: item.barcodes[0] ?? item.code,
        priceMajor: item.salePrice ?? "0.00",
        copies: 1,
      },
    ]);
  }

  function removeLine(itemId: string) {
    setLines((prev) => prev.filter((l) => l.itemId !== itemId));
  }

  function setCopies(itemId: string, copies: number) {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, copies } : l)));
  }

  const batchInputs: LabelBatchLineInput[] = useMemo(
    () =>
      lines.map((l) => ({
        itemId: l.itemId,
        nameAr: l.nameAr,
        code: l.code,
        barcode: l.barcode,
        price: Money.fromMajor(l.priceMajor === "" ? "0" : l.priceMajor),
        copies: l.copies,
      })),
    [lines],
  );
  const batch = useMemo(() => buildLabelBatch(templateCode, batchInputs), [templateCode, batchInputs]);
  const template = batch.template;

  const printableTiles = useMemo(
    () => lines.flatMap((l) => Array.from({ length: Math.max(0, Math.trunc(l.copies)) }, (_, i) => ({ ...l, key: `${l.itemId}-${i}` }))),
    [lines],
  );

  return (
    <div className="w-full">
      <style>{`@media print {
        body * { visibility: hidden; }
        .mz-print-sheet, .mz-print-sheet * { visibility: visible; }
        .mz-print-sheet { position: absolute; inset: 0; }
      }
      @page { size: ${template.widthMm}mm ${template.heightMm}mm; margin: 0; }`}</style>

      <div className="print:hidden">
        <div className="mb-[16px]">
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("labelPrinting.labelPrinting")}</h1>
          <p className="mt-[6px] text-[13px] text-ink-muted">
            {t("labelPrinting.pickTheItemsAndHow")}
          </p>
        </div>

        <Card className="mb-[16px] p-[14px_18px]">
          <p className="text-[12.5px] text-ink-muted">
            {t("labelPrinting.thePrintedPriceIsThe")}
          </p>
        </Card>

        <Card className="mb-[16px] p-[16px_18px]">
          <h2 className="mb-[10px] font-display text-[15px] font-bold text-ink">{t("labelPrinting.itemsChosen")}</h2>

          <div className="mb-[14px] flex flex-wrap items-end gap-[12px]">
            <div className="min-w-[260px] flex-1">
              <ItemPicker
                label={t("labelPrinting.addAnItem")}
                value={null}
                onChange={addItem}
                accept={(item) => !chosenIds.has(item.id)}
                placeholder={t("labelPrinting.searchForAnItemBy")}
                emptyMessage={t("labelPrinting.noResults")}
              />
            </div>

            <div>
              <label htmlFor="label-template" className="mb-[4px] block text-[11.5px] font-semibold text-ink-faint">
                {t("labelPrinting.labelTemplate")}
              </label>
              <Select
                id="label-template"
                size="sm"
                value={templateCode}
                onChange={(value) => setTemplateCode(value as LabelTemplateCode)}
                options={LABEL_TEMPLATES.map((template) => ({ value: template.code, label: codedLabel("labelTemplate", template.code, template.labelAr, t) }))}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-2 text-ink-faint">
                <tr>
                  <th className="p-[8px_10px] text-start font-semibold">{t("common.item")}</th>
                  <th className="p-[8px_10px] text-start font-semibold">{t("labelPrinting.barcode")}</th>
                  <th className="p-[8px_10px] text-end font-semibold">{t("labelPrinting.printedPrice")}</th>
                  <th className="p-[8px_10px] text-end font-semibold">{t("labelPrinting.copies")}</th>
                  <th className="p-[8px_10px]" />
                </tr>
              </thead>
              <tbody>
                {batch.lines.map((line) => (
                  <tr key={line.itemId} className="border-t border-border align-top">
                    <td className="p-[8px_10px]">
                      <div className="font-semibold text-ink">{line.nameAr}</div>
                      <div className="mz-num text-[11px] text-ink-faint">{line.code}</div>
                    </td>
                    <td className="p-[8px_10px]">
                      <div className="mz-num text-ink">{line.barcode || "—"}</div>
                      {line.messageAr ? <div className="mt-[3px] text-[11px] font-semibold text-danger-ink">{pickLocalized(line.messageAr, line.messageEn, locale)}</div> : null}
                    </td>
                    <td className="p-[8px_10px] text-end">
                      <span className="mz-num">{line.price.toString()}</span>
                    </td>
                    <td className="p-[8px_10px] text-end">
                      <QtyInput value={line.copies} onChange={(v) => setCopies(line.itemId, v)} min={1} max={999} step={1} aria-label={t("labelPrinting.copiesLabel", { name: line.nameAr })} />
                    </td>
                    <td className="p-[8px_10px] text-end">
                      <Button size="sm" onClick={() => removeLine(line.itemId)}>
                        {t("labelPrinting.remove")}
                      </Button>
                    </td>
                  </tr>
                ))}
                {batch.lines.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-[16px] text-center text-[12.5px] text-ink-muted">
                      {t("labelPrinting.noItemsHaveBeenAdded")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-[12px] flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink">
              {t("labelPrinting.total")} <span className="mz-num">{batch.totalLabelCount}</span> {t("labelPrinting.label")}
            </span>
            <Button variant="primary" disabled={batch.lines.length === 0 || batch.hasBlockingIssues} onClick={() => window.print()}>
              {t("labelPrinting.previewAndPrint")}
            </Button>
          </div>
        </Card>

        {lines.length > 0 ? (
          <Card className="p-[16px_18px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("labelPrinting.labelPreview")}</h3>
            <div className="flex flex-wrap gap-[10px]">
              {lines.slice(0, 6).map((l) => (
                <LabelTile key={l.itemId} line={l} template={template} />
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <div className="mz-print-sheet hidden flex-wrap gap-[2mm] print:flex">
        {printableTiles.map((tile) => (
          <LabelTile key={tile.key} line={tile} template={template} />
        ))}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Card, EmptyState, EntityPicker, Money as MoneyValue, type EntityPickerOption } from "@mezan/ui";
import { useWorksContracts } from "../../../data/contracting-contracts-hooks";
import { useInternalCertificate } from "../../../data/contracting-certificates-hooks";
import { useAppTranslation } from "../../../i18n";
import { majorOf } from "../../../lib/money";
import { EMPTY } from "../../../lib/empty";
import { trimScale } from "./certificate-common";
import { errorMessage } from "../../../lib/error-message";

/**
 * مستخلص تنفيذي — the one document in the Egyptian set that never leaves the
 * company: estimated cost against selling value, per BOQ line, at the latest
 * certificate's cumulative quantities.
 *
 * The ACTUAL cost sits beside the table, not inside it. Cost carries a project
 * dimension and no BOQ-line one, so a per-line actual would be an allocation
 * dressed up as a measurement — and the margin column is the only number this
 * document exists for.
 */

const CATEGORY_KEY: Record<string, string> = {
  materials: "costCategory.materials",
  labour: "costCategory.labour",
  equipment: "costCategory.equipment",
  subcontract: "costCategory.subcontract",
  indirect: "costCategory.indirect",
  uncategorised: "internalCertificate.uncategorised",
};

export function InternalCertificateScreen() {
  const { t } = useAppTranslation();
  const contracts = useWorksContracts().data ?? EMPTY;
  const [contract, setContract] = useState<EntityPickerOption | null>(null);
  const report = useInternalCertificate(contract?.id ?? null);

  return (
    <div className="w-full">
      <div className="mb-[14px]">
        <h1 className="font-display text-xl font-bold text-ink">{t("internalCertificate.title")}</h1>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("internalCertificate.description")}</p>
      </div>

      <Card className="mb-[16px] p-[16px_18px]">
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
          <EntityPicker
            label={t("certificates.field.contract")}
            value={contract}
            onChange={setContract}
            options={contracts.map((c) => ({ id: c.id, label: c.titleAr, sublabel: c.docNo }))}
            placeholder={t("certificates.pickContract")}
            emptyMessage={t("certificates.noActiveContracts")}
          />
        </div>
        <p className="mt-[10px] text-[11.5px] font-semibold text-warning-ink">{t("internalCertificate.notForClient")}</p>
      </Card>

      {!contract ? (
        <EmptyState title={t("internalCertificate.pickPrompt")} description={t("internalCertificate.pickHint")} />
      ) : report.isLoading ? null : !report.data ? (
        <EmptyState title={t("internalCertificate.loadFailed")} description={errorMessage(report.error, t("internalCertificate.pickHint"))} />
      ) : (
        <>
          <Card className="mb-[16px] p-[16px_18px]">
            <h2 className="mb-[4px] text-[13px] font-bold text-ink">
              {report.data.asOfDocNo
                ? t("internalCertificate.asOf", {
                    docNo: report.data.asOfDocNo,
                    serial: String(report.data.asOfSerial ?? 0),
                  })
                : t("internalCertificate.noCertificates")}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border text-ink-muted">
                    <th className="p-[7px_8px] text-start">{t("certificates.col.item")}</th>
                    <th className="p-[7px_8px] text-end">{t("certificates.col.cumulative")}</th>
                    <th className="p-[7px_8px] text-end">{t("internalCertificate.col.estimatedCost")}</th>
                    <th className="p-[7px_8px] text-end">{t("internalCertificate.col.sellingValue")}</th>
                    <th className="p-[7px_8px] text-end">{t("internalCertificate.col.lineMargin")}</th>
                    <th className="p-[7px_8px] text-end">{t("internalCertificate.col.marginPercent")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.rows.map((row) => (
                    <tr key={row.boqLineId} className="border-b border-border">
                      <td className="p-[7px_8px]">
                        <span className="mz-num text-ink-muted">{row.code}</span> {row.descriptionAr}
                      </td>
                      <td className="mz-num p-[7px_8px] text-end">{trimScale(row.cumulativeQty)}</td>
                      <td className="mz-num p-[7px_8px] text-end">
                        <MoneyValue value={majorOf(row.estimatedCost)} showUnit={false} />
                      </td>
                      <td className="mz-num p-[7px_8px] text-end">
                        <MoneyValue value={majorOf(row.sellingValue)} showUnit={false} />
                      </td>
                      <td className="mz-num p-[7px_8px] text-end">
                        <MoneyValue value={majorOf(row.lineMargin)} showUnit={false} />
                      </td>
                      <td className="mz-num p-[7px_8px] text-end">{row.lineMarginPercent}%</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-bold">
                    <td className="p-[7px_8px]">{t("common.total")}</td>
                    <td className="p-[7px_8px]" />
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(report.data.totals.estimatedCost)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(report.data.totals.sellingValue)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">
                      <MoneyValue value={majorOf(report.data.totals.margin)} showUnit={false} />
                    </td>
                    <td className="mz-num p-[7px_8px] text-end">{report.data.totals.marginPercent}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card className="p-[16px_18px]">
            <h2 className="mb-[4px] text-[13px] font-bold text-ink">{t("internalCertificate.actualTitle")}</h2>
            <p className="mb-[12px] text-[11.5px] text-ink-muted">{report.data.actualCostNoteAr}</p>
            {!report.data.projectActual ? (
              <p className="text-[12px] text-ink-faint">{t("internalCertificate.noActual")}</p>
            ) : (
              <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
                <Figure
                  label={t("internalCertificate.actualCost")}
                  value={majorOf(report.data.projectActual.cost)}
                />
                <Figure
                  label={t("internalCertificate.actualRevenue")}
                  value={majorOf(report.data.projectActual.revenue)}
                />
                {Object.entries(report.data.projectActual.byCategory).map(([category, amount]) => (
                  <Figure
                    key={category}
                    label={t((CATEGORY_KEY[category] ?? "internalCertificate.uncategorised") as never)}
                    value={majorOf(amount)}
                  />
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border p-[10px_12px]">
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className="mt-[3px] text-[14px] font-bold text-ink">
        <MoneyValue value={value} showUnit={false} />
      </div>
    </div>
  );
}

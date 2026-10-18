import { useMemo, useState } from "react";
import {
  Card,
  Chip,
  ReportRunner,
  type ReportRunnerColumn,
  type ReportRunnerParamField,
  type ReportRunnerResult,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { EmptyState } from "@mezan/ui";
import type { ContractingExceptionKeyDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useProjects } from "../../../data/hooks";
import {
  useBoqOverrunReport,
  useConsumptionVarianceReport,
  useContractingExceptionSummary,
  useCostOverrunReport,
  useEarlyRetentionReleaseReport,
  useEquipmentExceptionReport,
  useLateVariationReport,
  useUnreceivedIssuesReport,
  type ExceptionReportParams,
} from "../../../data/contracting-controls-hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { majorOf } from "../../../lib/money";

/**
 * تقارير المقاولات — the seven exception reports (design §06).
 *
 * The product ships 33 reports and not one of them is an exception report. For
 * a contracting customer that is the missing half of the control environment,
 * so each tab prints its RULE whether or not it fired: an empty table here is
 * an answer («لا توجد استثناءات»), not a missing feature.
 */

const VIEW_PERMISSION = "contracting.certificate.view";

const TAB_KEYS: readonly ContractingExceptionKeyDTO[] = [
  "boq-overrun",
  "unreceived-issues",
  "consumption-variance",
  "equipment-without-certificate",
  "late-variation-approvals",
  "early-retention-release",
  "cost-overrun-vs-estimate",
];

const TAB_LABEL_KEYS: Record<ContractingExceptionKeyDTO, AppTranslationKey> = {
  "boq-overrun": "contractingReports.tab.boqOverrun",
  "unreceived-issues": "contractingReports.tab.unreceived",
  "consumption-variance": "contractingReports.tab.consumption",
  "equipment-without-certificate": "contractingReports.tab.equipment",
  "late-variation-approvals": "contractingReports.tab.lateVariation",
  "early-retention-release": "contractingReports.tab.earlyRelease",
  "cost-overrun-vs-estimate": "contractingReports.tab.costOverrun",
};

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function num(value: string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export function ContractingReportsScreen() {
  const { t } = useAppTranslation();
  const { session } = useApi();
  const [tab, setTab] = useState<ContractingExceptionKeyDTO>("boq-overrun");
  const [params, setParams] = useState<Record<string, string>>(() => ({
    asOfDate: todayIso(),
    projectId: "",
    olderThanDays: "",
    thresholdPercent: "",
    stalenessMonths: "",
  }));

  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(authContext, VIEW_PERMISSION);

  const projectsQuery = useProjects();
  const summaryQuery = useContractingExceptionSummary(mayView);

  const query: ExceptionReportParams = {
    asOfDate: params.asOfDate || null,
    projectId: params.projectId || null,
    olderThanDays: params.olderThanDays || null,
    thresholdPercent: params.thresholdPercent || null,
    stalenessMonths: params.stalenessMonths || null,
  };

  const boqOverrun = useBoqOverrunReport(query, mayView && tab === "boq-overrun");
  const unreceived = useUnreceivedIssuesReport(query, mayView && tab === "unreceived-issues");
  const consumption = useConsumptionVarianceReport(query, mayView && tab === "consumption-variance");
  const equipment = useEquipmentExceptionReport(query, mayView && tab === "equipment-without-certificate");
  const lateVariation = useLateVariationReport(query, mayView && tab === "late-variation-approvals");
  const earlyRelease = useEarlyRetentionReleaseReport(query, mayView && tab === "early-retention-release");
  const costOverrun = useCostOverrunReport(query, mayView && tab === "cost-overrun-vs-estimate");

  const projectOptions = useMemo(
    () => [
      { value: "", label: t("contractingReports.allProjects") },
      ...(projectsQuery.data ?? []).map((p) => ({ value: p.id, label: p.nameAr })),
    ],
    [projectsQuery.data, t],
  );

  const countOf = (key: ContractingExceptionKeyDTO): number =>
    summaryQuery.data?.reports.find((r) => r.key === key)?.count ?? 0;

  if (!mayView) {
    return (
      <EmptyState
        title={t("contractingReports.noAccessTitle")}
        description={t("contractingReports.noAccessBody")}
      />
    );
  }

  const baseFields: ReportRunnerParamField[] = [
    { kind: "date", key: "asOfDate", label: t("contractingReports.asOfDate") },
    { kind: "select", key: "projectId", label: t("contractingReports.project"), options: projectOptions },
  ];
  const daysField: ReportRunnerParamField = {
    kind: "text",
    key: "olderThanDays",
    label: t("contractingReports.olderThanDays"),
    placeholder: tab === "unreceived-issues" ? "7" : "30",
  };
  const thresholdField: ReportRunnerParamField = {
    kind: "text",
    key: "thresholdPercent",
    label: t("contractingReports.thresholdPercent"),
    placeholder: "10",
  };
  const stalenessField: ReportRunnerParamField = {
    kind: "text",
    key: "stalenessMonths",
    label: t("contractingReports.stalenessMonths"),
    placeholder: "6",
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("contractingReports.title")}</h1>
        <p className="mt-[4px] max-w-[72ch] text-sm text-ink-muted">{t("contractingReports.description")}</p>
      </div>

      <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={t("contractingReports.tabsLegend")}>
        {TAB_KEYS.map((key) => (
          <Chip key={key} type="button" active={tab === key} onClick={() => setTab(key)}>
            {t(TAB_LABEL_KEYS[key])} <span className="mz-num">({countOf(key)})</span>
          </Chip>
        ))}
      </div>

      {tab === "boq-overrun" ? (
        <ReportTab
          exportName="contracting-boq-overrun"
          loading={boqOverrun.isFetching}
          ruleAr={boqOverrun.data?.ruleAr ?? ""}
          rows={boqOverrun.data?.rows ?? []}
          hasResult={boqOverrun.data !== undefined}
          paramFields={baseFields}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.boqOverrun")}
          columns={
            [
              { key: "contractDocNo", header: t("contractingReports.col.contract"), value: (r) => r.contractDocNo },
              { key: "code", header: t("contractingReports.col.boqCode"), value: (r) => r.code },
              { key: "descriptionAr", header: t("contractingReports.col.item"), value: (r) => r.descriptionAr },
              { key: "certificateDocNo", header: t("contractingReports.col.certificate"), value: (r) => r.certificateDocNo },
              { key: "executionDate", header: t("contractingReports.col.executionDate"), format: "date", value: (r) => r.executionDate },
              { key: "contractedQty", header: t("contractingReports.col.contractedQty"), format: "qty", align: "end", value: (r) => num(r.contractedQty) },
              { key: "cumulativeQty", header: t("contractingReports.col.cumulativeQty"), format: "qty", align: "end", value: (r) => num(r.cumulativeQty) },
              { key: "excessQty", header: t("contractingReports.col.excessQty"), format: "qty", align: "end", total: true, value: (r) => num(r.excessQty) },
            ] as ReportRunnerColumn<NonNullable<typeof boqOverrun.data>["rows"][number]>[]
          }
          rowKey={(r) => `${r.certificateId}-${r.boqLineId}`}
        />
      ) : null}

      {tab === "unreceived-issues" ? (
        <ReportTab
          exportName="contracting-unreceived-issues"
          loading={unreceived.isFetching}
          ruleAr={unreceived.data?.ruleAr ?? ""}
          rows={unreceived.data?.rows ?? []}
          hasResult={unreceived.data !== undefined}
          paramFields={[...baseFields, daysField]}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.unreceived")}
          columns={
            [
              { key: "docNo", header: t("contractingReports.col.issue"), value: (r) => r.docNo ?? r.issueId },
              { key: "date", header: t("contractingReports.col.date"), format: "date", value: (r) => r.date },
              { key: "itemId", header: t("contractingReports.col.item"), value: (r) => r.itemId },
              { key: "qtyIssued", header: t("contractingReports.col.qtyIssued"), format: "qty", align: "end", value: (r) => num(r.qtyIssued) },
              { key: "qtyReceived", header: t("contractingReports.col.qtyReceived"), format: "qty", align: "end", value: (r) => num(r.qtyReceived) },
              { key: "qtyOutstanding", header: t("contractingReports.col.qtyOutstanding"), format: "qty", align: "end", total: true, value: (r) => num(r.qtyOutstanding) },
              { key: "ageDays", header: t("contractingReports.col.ageDays"), align: "end", value: (r) => r.ageDays },
            ] as ReportRunnerColumn<NonNullable<typeof unreceived.data>["rows"][number]>[]
          }
          rowKey={(r) => `${r.issueId}-${r.itemId}`}
        />
      ) : null}

      {tab === "consumption-variance" ? (
        <ReportTab
          exportName="contracting-consumption-variance"
          loading={consumption.isFetching}
          ruleAr={consumption.data?.ruleAr ?? ""}
          rows={consumption.data?.rows ?? []}
          hasResult={consumption.data !== undefined}
          paramFields={[...baseFields, thresholdField]}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.consumption")}
          columns={
            [
              { key: "contractDocNo", header: t("contractingReports.col.contract"), value: (r) => r.contractDocNo },
              { key: "code", header: t("contractingReports.col.boqCode"), value: (r) => r.code },
              { key: "descriptionAr", header: t("contractingReports.col.item"), value: (r) => r.descriptionAr },
              { key: "itemId", header: t("contractingReports.col.material"), value: (r) => r.itemId },
              { key: "certifiedCumulativeQty", header: t("contractingReports.col.certifiedQty"), format: "qty", align: "end", value: (r) => num(r.certifiedCumulativeQty) },
              { key: "theoreticalQty", header: t("contractingReports.col.theoreticalQty"), format: "qty", align: "end", total: true, value: (r) => num(r.theoreticalQty) },
              { key: "consumedQty", header: t("contractingReports.col.consumedQty"), format: "qty", align: "end", total: true, value: (r) => num(r.consumedQty) },
              { key: "varianceQty", header: t("contractingReports.col.varianceQty"), format: "qty", align: "end", total: true, value: (r) => num(r.varianceQty) },
              { key: "variancePercent", header: t("contractingReports.col.variancePercent"), align: "end", value: (r) => (r.variancePercent === null ? t("contractingReports.noBasis") : `${r.variancePercent}%`) },
              { key: "consumedCost", header: t("contractingReports.col.consumedCost"), format: "money", align: "end", total: true, value: (r) => majorOf(r.consumedCost) },
            ] as ReportRunnerColumn<NonNullable<typeof consumption.data>["rows"][number]>[]
          }
          rowKey={(r) => `${r.boqLineId}-${r.itemId}`}
        />
      ) : null}

      {tab === "equipment-without-certificate" ? (
        <ReportTab
          exportName="contracting-equipment-without-certificate"
          loading={equipment.isFetching}
          ruleAr={equipment.data?.ruleAr ?? ""}
          rows={equipment.data?.rows ?? []}
          hasResult={equipment.data !== undefined}
          paramFields={[...baseFields, daysField]}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.equipment")}
          columns={
            [
              { key: "docNo", header: t("contractingReports.col.equipmentLog"), value: (r) => r.docNo ?? r.equipmentLogId },
              { key: "date", header: t("contractingReports.col.date"), format: "date", value: (r) => r.date },
              { key: "assetId", header: t("contractingReports.col.asset"), value: (r) => r.assetId },
              { key: "boqLine", header: t("contractingReports.col.boqLine"), value: (r) => (r.code === null ? t("contractingReports.noBoqLine") : `${r.code} — ${r.descriptionAr ?? ""}`) },
              { key: "hours", header: t("contractingReports.col.hours"), format: "qty", align: "end", total: true, value: (r) => num(r.hours) },
              { key: "amount", header: t("contractingReports.col.amount"), format: "money", align: "end", total: true, value: (r) => majorOf(r.amount) },
              { key: "certifiedCumulativeAtLog", header: t("contractingReports.col.certifiedAtLog"), format: "qty", align: "end", value: (r) => num(r.certifiedCumulativeAtLog) },
              { key: "certifiedCumulativeNow", header: t("contractingReports.col.certifiedNow"), format: "qty", align: "end", value: (r) => num(r.certifiedCumulativeNow) },
              { key: "reason", header: t("contractingReports.col.reason"), value: (r) => (r.reason === "no_boq_line" ? t("contractingReports.reason.noBoqLine") : t("contractingReports.reason.notCertifiedSince")) },
            ] as ReportRunnerColumn<NonNullable<typeof equipment.data>["rows"][number]>[]
          }
          rowKey={(r) => r.equipmentLogId}
        />
      ) : null}

      {tab === "late-variation-approvals" ? (
        <ReportTab
          exportName="contracting-late-variation-approvals"
          loading={lateVariation.isFetching}
          ruleAr={lateVariation.data?.ruleAr ?? ""}
          rows={lateVariation.data?.rows ?? []}
          hasResult={lateVariation.data !== undefined}
          paramFields={baseFields}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.lateVariation")}
          columns={
            [
              { key: "variationDocNo", header: t("contractingReports.col.variation"), value: (r) => r.variationDocNo },
              { key: "variationTitleAr", header: t("contractingReports.col.variationTitle"), value: (r) => r.variationTitleAr },
              { key: "approvedAt", header: t("contractingReports.col.approvedAt"), format: "date", value: (r) => r.approvedAt },
              { key: "certificateDocNo", header: t("contractingReports.col.certificate"), value: (r) => r.certificateDocNo },
              { key: "executionDate", header: t("contractingReports.col.executionDate"), format: "date", value: (r) => r.executionDate },
              { key: "code", header: t("contractingReports.col.boqCode"), value: (r) => r.code },
              { key: "contractedQtyAtExecution", header: t("contractingReports.col.contractedAtExecution"), format: "qty", align: "end", value: (r) => num(r.contractedQtyAtExecution) },
              { key: "cumulativeQty", header: t("contractingReports.col.cumulativeQty"), format: "qty", align: "end", value: (r) => num(r.cumulativeQty) },
              { key: "reliedOnQty", header: t("contractingReports.col.reliedOnQty"), format: "qty", align: "end", total: true, value: (r) => num(r.reliedOnQty) },
            ] as ReportRunnerColumn<NonNullable<typeof lateVariation.data>["rows"][number]>[]
          }
          rowKey={(r) => `${r.variationOrderId}-${r.certificateId}-${r.boqLineId}`}
        />
      ) : null}

      {tab === "early-retention-release" ? (
        <ReportTab
          exportName="contracting-early-retention-release"
          loading={earlyRelease.isFetching}
          ruleAr={earlyRelease.data?.ruleAr ?? ""}
          rows={earlyRelease.data?.rows ?? []}
          hasResult={earlyRelease.data !== undefined}
          paramFields={baseFields}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.earlyRelease")}
          columns={
            [
              { key: "docNo", header: t("contractingReports.col.release"), value: (r) => r.docNo },
              { key: "contractDocNo", header: t("contractingReports.col.contract"), value: (r) => r.contractDocNo },
              { key: "date", header: t("contractingReports.col.releaseDate"), format: "date", value: (r) => r.date },
              { key: "releaseEventDate", header: t("contractingReports.col.eventDate"), format: "date", value: (r) => r.releaseEventDate },
              { key: "daysEarly", header: t("contractingReports.col.daysEarly"), align: "end", value: (r) => r.daysEarly },
              { key: "amount", header: t("contractingReports.col.amount"), format: "money", align: "end", total: true, value: (r) => majorOf(r.amount) },
            ] as ReportRunnerColumn<NonNullable<typeof earlyRelease.data>["rows"][number]>[]
          }
          rowKey={(r) => r.releaseId}
        />
      ) : null}

      {tab === "cost-overrun-vs-estimate" ? (
        <ReportTab
          exportName="contracting-cost-overrun-vs-estimate"
          loading={costOverrun.isFetching}
          ruleAr={costOverrun.data?.ruleAr ?? ""}
          rows={costOverrun.data?.rows ?? []}
          hasResult={costOverrun.data !== undefined}
          paramFields={[...baseFields, thresholdField, stalenessField]}
          params={params}
          onParamsChange={setParams}
          title={t("contractingReports.tab.costOverrun")}
          columns={
            [
              { key: "contractDocNo", header: t("contractingReports.col.contract"), value: (r) => r.contractDocNo },
              { key: "contractTitleAr", header: t("contractingReports.col.contractTitle"), value: (r) => r.contractTitleAr },
              { key: "certifiedGrossWorks", header: t("contractingReports.col.certifiedGrossWorks"), format: "money", align: "end", total: true, value: (r) => majorOf(r.certifiedGrossWorks) },
              { key: "estimatedTotalCost", header: t("contractingReports.col.estimatedTotalCost"), format: "money", align: "end", total: true, value: (r) => majorOf(r.estimatedTotalCost) },
              { key: "expectedCostToDate", header: t("contractingReports.col.expectedCostToDate"), format: "money", align: "end", total: true, value: (r) => majorOf(r.expectedCostToDate) },
              { key: "costToDate", header: t("contractingReports.col.costToDate"), format: "money", align: "end", total: true, value: (r) => majorOf(r.costToDate) },
              { key: "excessCost", header: t("contractingReports.col.excessCost"), format: "money", align: "end", total: true, value: (r) => majorOf(r.excessCost) },
              { key: "lastEstimateRevisionDate", header: t("contractingReports.col.lastEstimateRevision"), format: "date", value: (r) => r.lastEstimateRevisionDate },
              { key: "monthsSinceEstimateRevision", header: t("contractingReports.col.monthsSinceRevision"), align: "end", value: (r) => r.monthsSinceEstimateRevision },
              {
                key: "reason",
                header: t("contractingReports.col.reason"),
                value: (r) =>
                  r.costOverrun && r.estimateStale
                    ? t("contractingReports.reason.costAndStale")
                    : r.costOverrun
                      ? t("contractingReports.reason.costAboveEarned")
                      : t("contractingReports.reason.estimateStale"),
              },
            ] as ReportRunnerColumn<NonNullable<typeof costOverrun.data>["rows"][number]>[]
          }
          rowKey={(r) => r.contractId}
        />
      ) : null}
    </div>
  );
}

interface ReportTabProps<Row> {
  readonly title: string;
  readonly ruleAr: string;
  readonly rows: readonly Row[];
  readonly hasResult: boolean;
  readonly loading: boolean;
  readonly columns: readonly ReportRunnerColumn<Row>[];
  readonly rowKey: (row: Row) => string;
  readonly paramFields: readonly ReportRunnerParamField[];
  readonly params: Record<string, string>;
  readonly onParamsChange: (params: Record<string, string>) => void;
  readonly exportName: string;
}

/**
 * One report. The rule sentence is printed under the table whether or not the
 * rule fired, and an empty result says «لا توجد استثناءات» — the reader has to
 * be able to tell a clean control from a report that never ran.
 */
function ReportTab<Row>({
  title,
  ruleAr,
  rows,
  hasResult,
  loading,
  columns,
  rowKey,
  paramFields,
  params,
  onParamsChange,
  exportName,
}: ReportTabProps<Row>) {
  const { t } = useAppTranslation();
  const grandTotals = Object.fromEntries(
    columns.filter((c) => c.total).map((c) => [c.key, rows.reduce((sum, row) => sum + Number(c.value(row) ?? 0), 0)]),
  );
  // The runner renders its body from `groups`, not from `rows`: one unlabelled
  // group is what puts the rows on screen without a section header.
  const result: ReportRunnerResult<Row> | null = hasResult
    ? {
        rows,
        groups: [{ key: "all", label: "", rows, totals: grandTotals }],
        grandTotals,
        reconciliation: null,
      }
    : null;

  return (
    <div className="flex flex-col gap-[14px]">
      <ReportRunner<Row>
        nested
        title={title}
        paramFields={paramFields}
        params={params}
        onParamsChange={onParamsChange}
        loading={loading}
        result={result}
        columns={columns}
        rowKey={rowKey}
        methodology={ruleAr}
        exportBaseFilename={exportName}
      />
      {hasResult && rows.length === 0 && !loading ? (
        <Card className="p-[18px_20px]">
          <p className="text-[13px] font-semibold text-success-ink">{t("contractingReports.emptyTitle")}</p>
          <p className="mt-[6px] max-w-[78ch] text-[12.5px] text-ink-muted">{ruleAr}</p>
        </Card>
      ) : null}
    </div>
  );
}

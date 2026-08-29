import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../lib/error-message";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  RowMenu,
  SidePanel,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { Money, generateInstallmentSchedule } from "@mezan/domain";
import type { DocumentStatusDTO, InstallmentFrequencyDTO, InstallmentPlanDocumentDTO } from "@mezan/contracts";
import { SelectField, NumberField } from "../settings/form-controls";
import {
  useCancelInstallmentPlan,
  useConfirmInstallmentPlan,
  useCreateInstallmentPlan,
  useInstallmentPlans,
  useInstallmentPlanCounts,
  useInstallmentPlanStats,
  useProcessOverdueInstallments,
  useSalesInvoices,
  type InstallmentPlanListFilter,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useNavigation, useScreenIntent } from "../navigation";
import { sumMajor } from "../lib/money";
import { todayIso } from "../lib/dates";

/** خطط الأقساط (Installment Plans) — docs/archive/catalog/05. Splits an invoice's balance into a scheduled series of payments; posts no GL, moves no stock. */

const FREQUENCY_KEY: Record<InstallmentFrequencyDTO, AppTranslationKey> = {
  WEEKLY: "instalments.frequencyWeekly",
  BIWEEKLY: "instalments.frequencyBiweekly",
  MONTHLY: "instalments.frequencyMonthly",
  QUARTERLY: "instalments.frequencyQuarterly",
};

const STATUS_KEY: Record<DocumentStatusDTO, AppTranslationKey> = {
  draft: "instalments.statusDraft",
  pending: "instalments.statusPending",
  confirmed: "instalments.statusActive",
  posted: "instalments.statusActive",
  cancelled: "instalments.statusCancelled",
  reversed: "instalments.statusReversed",
};
const STATUS_TONE: Record<DocumentStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  posted: "success",
  cancelled: "neutral",
  reversed: "danger",
};

function today(): string {
  return todayIso();
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function InstallmentPlansScreen() {
  const { t } = useAppTranslation();
  const invoicesQuery = useSalesInvoices();
  const createPlan = useCreateInstallmentPlan();
  const confirmPlan = useConfirmInstallmentPlan();
  const cancelPlan = useCancelInstallmentPlan();
  const processOverdue = useProcessOverdueInstallments();

  const invoices = useMemo(
    () => (invoicesQuery.data ?? []).filter((i) => i.status !== "draft" && i.status !== "cancelled" && Number(i.remainingBalance) > 0),
    [invoicesQuery.data],
  );

  const [panel, setPanel] = useState<"none" | "create" | "overdue" | { id: string }>("none");
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const { openScreenAt } = useNavigation();
  // Arriving from «إنشاء خطة أقساط» on an invoice row, that invoice is the plan's
  // subject — open the form already pointed at it.
  useScreenIntent((intent) => {
    const prefilled = intent.prefill?.invoiceId;
    if (prefilled) setInvoiceId(prefilled);
    setPanel("create");
  });
  const [statusFilter, setStatusFilter] = useState<"all" | DocumentStatusDTO>("all");
  // One filter for the rows, the status chips and the KPI strip (R1.1): the
  // screen used to derive all three from one client-side fetch, so the header
  // numbers stayed at the grand total no matter which status tab was active.
  const filter = useMemo<InstallmentPlanListFilter>(() => ({ status: statusFilter }), [statusFilter]);
  const query = useInstallmentPlans(filter);
  const documents = query.data ?? [];
  const counts = useInstallmentPlanCounts(filter).data ?? {};
  const stats = useInstallmentPlanStats(filter).data ?? {};
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [invoiceId, setInvoiceId] = useState("");
  const [installmentCount, setInstallmentCount] = useState(6);
  const [frequency, setFrequency] = useState<InstallmentFrequencyDTO>("MONTHLY");
  const [startDate, setStartDate] = useState(today());
  const [downPayment, setDownPayment] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [overdueResult, setOverdueResult] = useState<{ newlyOverdueCount: number; totalLateFeesApplied: string } | null>(null);

  // No default invoice: this used to pick `invoices[0]`, so opening «خطة جديدة»
  // silently pointed the plan at whichever invoice sorted first. A plan
  // schedules a specific invoice's balance — the choice has to be deliberate.

  const selectedInvoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const preview = useMemo(() => {
    if (!selectedInvoice) return null;
    try {
      return generateInstallmentSchedule({
        invoiceTotal: Money.fromMajor(selectedInvoice.remainingBalance),
        downPayment: Money.fromMajor(String(downPayment)),
        installmentCount,
        frequency,
        startDate,
      });
    } catch {
      return null;
    }
  }, [selectedInvoice, downPayment, installmentCount, frequency, startDate]);

  const pageCount = Math.max(1, Math.ceil(documents.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = documents.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = typeof panel === "object" ? (documents.find((d) => d.id === panel.id) ?? null) : null;

  function openCreate() {
    setError(null);
    setInvoiceId(invoices[0]?.id ?? "");
    setInstallmentCount(6);
    setFrequency("MONTHLY");
    setStartDate(today());
    setDownPayment(0);
    setPanel("create");
  }

  async function submit() {
    setError(null);
    if (!preview || !selectedInvoice) return;
    try {
      const created = await createPlan.mutateAsync({
        id: crypto.randomUUID(),
        date: startDate,
        memo: "",
        customerId: selectedInvoice.customerId,
        sourceInvoiceId: selectedInvoice.id,
        sourceInvoiceNumber: selectedInvoice.docNo,
        invoiceTotal: selectedInvoice.remainingBalance,
        downPayment: String(downPayment),
        installmentCount,
        frequency,
        startDate,
      });
      await confirmPlan.mutateAsync(created.id);
      setPanel("none");
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  async function cancelExisting(id: string) {
    if (rowPendingId) return;
    setError(null);
    setRowPendingId(id);
    try {
      await cancelPlan.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    } finally {
      setRowPendingId(null);
    }
  }

  async function confirmExisting(id: string) {
    if (rowPendingId) return;
    setError(null);
    setRowPendingId(id);
    try {
      await confirmPlan.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    } finally {
      setRowPendingId(null);
    }
  }

  async function runOverdueBatch() {
    setError(null);
    try {
      const result = await processOverdue.mutateAsync({ asOfDate: today() });
      setOverdueResult(result);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "confirmed", label: t("common.active"), count: counts.confirmed ?? 0 },
  ];

  const columns: DocumentListColumn<InstallmentPlanDocumentDTO>[] = [
    { key: "docNo", header: t("instalments.planNumber"), render: (d) => <span className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</span> },
    { key: "customer", header: t("common.customer"), render: (d) => d.lines[0]?.customerId ?? "—" },
    { key: "invoice", header: t("instalments.invoice"), render: (d) => d.lines[0]?.sourceInvoiceNumber ?? "—" },
    { key: "frequency", header: t("instalments.frequency"), render: (d) => t(FREQUENCY_KEY[d.lines[0]?.frequency ?? "MONTHLY"]) },
    {
      key: "remaining",
      header: t("instalments.remaining"),
      align: "end",
      render: (d) => (
        <MoneyDisplay value={sumMajor(d.lines.filter((l) => l.status !== "paid").map((l) => l.amount))} />
      ),
    },
    {
      key: "status",
      header: t("common.status"),
      render: (d) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={t(STATUS_KEY[d.status])} tone={STATUS_TONE[d.status]} />
          {d.lines.some((l) => l.status === "overdue") ? <StatusPill label={t("instalments.overdue")} tone="danger" /> : null}
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("instalments.instalmentPlansCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {error ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <DocumentList<InstallmentPlanDocumentDTO>
        title={t("instalments.instalmentPlans")}
        description={t("instalments.splittingASalesInvoiceInto")}
        actions={
          <div className="flex gap-2">
            <Button
              variant="default"
              onClick={() => {
                setOverdueResult(null);
                setError(null);
                setPanel("overdue");
              }}
            >
              {t("instalments.processOverdue")}
            </Button>
            <Button variant="primary" onClick={openCreate}>
              {t("instalments.newPlan")}
            </Button>
          </div>
        }
        listKey="installment-plans"
        statsCollapsible
        stats={[
          { label: t("instalments.totalPlans"), value: <span className="mz-num">{Number(stats.count ?? 0)}</span> },
          { label: t("instalments.activePlans"), value: <span className="mz-num">{Number(stats.active ?? 0)}</span> },
          { label: t("instalments.overdue2"), value: <span className="mz-num">{Number(stats.overdue ?? 0)}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | DocumentStatusDTO);
          setPage(1);
        }}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        rowAction={(d) => {
          // A cancelled or fully settled plan is terminal; only a live one offers the source invoice's collection route.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => setPanel({ id: d.id }) },
            ...(d.status === "draft"
              ? [{ key: "confirm", label: t("instalments.confirmPlan"), disabled: rowPendingId === d.id, onSelect: () => void confirmExisting(d.id) }]
              : []),
            ...(d.lines[0]
              ? [
                  {
                    key: "invoice",
                    label: t("salesReturns.row.viewSourceInvoice"),
                    onSelect: () => openScreenAt("sales-invoices", [d.lines[0]?.sourceInvoiceId ?? ""]),
                  },
                ]
              : []),
            ...(d.status === "draft" || d.status === "confirmed"
              ? [
                  {
                    key: "cancel",
                    label: t("instalments.cancelPlan"),
                    tone: "danger" as const,
                    disabled: rowPendingId === d.id,
                    onSelect: () => void cancelExisting(d.id),
                  },
                ]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: d.docNo ?? d.id })} />;
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{documents.length}</span> {t("instalments.plans")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("instalments.createAnInstalmentPlanTo")}
            description={t("instalments.emptyBody")}
            action={{ label: t("instalments.newPlan"), onClick: openCreate }}
          />
        }
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title={t("instalments.newInstalmentPlan")}>
        <div className="flex flex-col gap-4 p-5">
          <SelectField
            label={t("instalments.invoice2")}
            value={invoiceId}
            onChange={setInvoiceId}
            options={invoices.map((i) => ({ value: i.id, label: `${i.docNo ?? i.id} — ${i.customerNameAr} / ${i.remainingBalance}` }))}
          />
          <NumberField label={t("instalments.numberOfInstalments")} value={installmentCount} onChange={setInstallmentCount} min={1} />
          <SelectField
            label={t("instalments.frequency2")}
            value={frequency}
            onChange={(v) => setFrequency(v as InstallmentFrequencyDTO)}
            options={Object.entries(FREQUENCY_KEY).map(([value, key]) => ({ value, label: t(key) }))}
          />
          <TextFieldDate label={t("instalments.startDate")} value={startDate} onChange={setStartDate} />
          <NumberField label={t("instalments.downPayment")} value={downPayment} onChange={setDownPayment} min={0} />

          {preview ? (
            <div className="flex flex-col gap-1.5 rounded-[10px] border border-border p-3">
              <div className="text-[12px] font-bold text-ink-muted">{t("instalments.previewSchedule")}</div>
              {preview.installments.map((i) => (
                <div key={i.no} className="flex items-center justify-between text-[12.5px]">
                  <span className="mz-num text-ink-muted">
                    #{i.no} — {i.dueDate}
                  </span>
                  <MoneyDisplay value={Number(i.amount.toString())} />
                </div>
              ))}
            </div>
          ) : null}

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <Button variant="primary" onClick={submit} disabled={!preview}>
            {t("common.save")}
          </Button>
        </div>
      </SidePanel>

      <SidePanel
        open={panel === "overdue"}
        onClose={() => setPanel("none")}
        title={t("instalments.processOverdue")}
        description={t("instalments.overdueInstalmentsWillBeRestatused")}
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="rounded-[10px] border border-border p-3 text-[12.5px] text-ink-muted">
            {t("instalments.dueInstalmentsAreMovedTo")}
          </div>
          {overdueResult ? (
            <div className="rounded-[8px] bg-surface-2 px-3 py-2 text-[12.5px] text-ink">
              {t("instalments.updated")} <span className="mz-num">{overdueResult.newlyOverdueCount}</span> {t("instalments.instalmentsToOverduePenaltiesApplied")}{" "}
              <MoneyDisplay value={Number(overdueResult.totalLateFeesApplied)} />
            </div>
          ) : null}
          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
          <Button variant="primary" onClick={runOverdueBatch}>
            {t("instalments.processOverdue")}
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? t("instalments.instalmentPlan")}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l) => (
                <div key={l.no} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span className="mz-num text-ink-muted">
                    #{l.no} — {l.dueDate}
                  </span>
                  <MoneyDisplay value={Number(l.amount)} />
                  <StatusPill
                    label={l.status === "pending" ? t("instalments.due") : l.status === "paid" ? t("instalments.paid") : l.status === "overdue" ? t("instalments.overdue") : t("docStatus.cancelled")}
                    tone={l.status === "paid" ? "success" : l.status === "overdue" ? "danger" : "neutral"}
                  />
                </div>
              ))}
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {selected.status === "confirmed" ? (
              <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                {t("instalments.cancelPlan")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

/** Minimal date input — `settings/form-controls.tsx`'s `TextField` doesn't expose `type="date"`. */
function TextFieldDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-bold text-ink-muted">{label}</span>
      <TextInput type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  FulcrumRule,
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  EmptyState,
  Money as MoneyDisplay,
  StatusPill,
  Chip,
  Card,
  Button,
  MoneyInput,
  EntityPicker,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
  type EntityPickerOption,
  RowMenu,
} from "@mezan/ui";
import {
  Money,
  voucherDocumentType,
  getVoucherTypeDefinition,
  getVoucherPaymentMethodLabel,
  VOUCHER_TYPE_DEFINITIONS,
  VOUCHER_PAYMENT_METHODS,
  type VoucherDocument,
  type VoucherLine,
  type VoucherPaymentMethod,
  type VoucherType,
} from "@mezan/domain";
import type {
  AccountDTO,
  CustomerDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  VoucherListQueryDTO,
  VoucherStatusDTO,
} from "@mezan/contracts";
import {
  useAccounts,
  useBranches,
  useCostCenters,
  useConfirmVoucher,
  useCreateAllocation,
  useCreateVoucher,
  useCustomers,
  useOpenInvoices,
  useReverseAllocation,
  useReverseVoucher,
  useSuppliers,
  useTreasuryAccounts,
  useVoucherDetail,
  useVouchers,
  useVoucherCounts,
  useVoucherStats,
  useCancelVoucher,
  type VoucherDetailDTO,
  type VoucherRowDTO,
} from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { useScreenIntent } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useDomainLabels } from "../lib/domain-labels";
import { useDebounced } from "../lib/use-debounced";
import { todayIso } from "../lib/dates";
import { AttachmentsTab } from "../attachments/AttachmentsTab";

/** السندات النقدية (Treasury Vouchers) — docs/catalog/04, on the real `/vouchers` API. */

const STATUS_KEY: Record<VoucherStatusDTO, AppTranslationKey> = {
  draft: "vouchers.status.draft",
  pending: "vouchers.status.pending",
  posted: "vouchers.status.posted",
  confirmed: "vouchers.status.confirmed",
  reversed: "vouchers.status.reversed",
  cancelled: "vouchers.status.cancelled",
};
const STATUS_TONE: Record<VoucherStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  posted: "success",
  confirmed: "success",
  reversed: "danger",
  cancelled: "neutral",
};

/** Keys, not copy — labels are built with the translator at render. */
const STEPPER_KEYS = [
  { key: "draft", labelKey: "vouchers.status.draft" },
  { key: "pending", labelKey: "vouchers.status.pending" },
  { key: "confirmed", labelKey: "vouchers.status.confirmed" },
  { key: "reversed", labelKey: "vouchers.status.reversed" },
] as const;

/**
 * Fixed counterparty GL account per voucher type — leaves of the standard COA
 * (packages/domain/src/accounts/coa-template.ts): trade receivables (1105),
 * trade payables (2100), customer advances (2160), output VAT (2200), capital
 * (3100). null = the user picks it (income/expense) or n/a (transfer).
 */
const FIXED_COUNTERPARTY: Record<VoucherType, string | null> = {
  customer_collection: "1105",
  supplier_payment: "2100",
  customer_refund: "1105",
  customer_advance: "2160",
  supplier_refund: "2100",
  other_income: null,
  other_expense: null,
  capital_injection: "3100",
  capital_withdrawal: "3100",
  tax_payment: "2200",
  inter_treasury_transfer: null,
};

function toMajor(value: string): number {
  return Number(value);
}

/** Rebuilds the domain's pure `VoucherLine`/`VoucherDocument` shape from the wire DTO so `voucherDocumentType.describeEffects` (no I/O) can drive the effects panel — same helper the create-flow preview below uses. */
function toVoucherLine(d: {
  voucherType: VoucherType;
  direction: VoucherLine["direction"];
  amount: string;
  currency: string;
  branchId: string;
  paymentMethod: VoucherPaymentMethod;
  treasuryAccountId: string;
  treasuryGlAccountId: string;
  counterpartyGlAccountId: string | null;
  counterTreasuryAccountId: string | null;
  counterTreasuryGlAccountId: string | null;
  customerId: string | null;
  supplierId: string | null;
  referenceNo: string | null;
  costCenterId: string | null;
}): VoucherLine {
  return { ...d, amount: Money.fromMajor(d.amount) };
}

function toPreviewDoc(line: VoucherLine, extra: { id: string; date: string; memo: string; status: VoucherDocument["status"] }): VoucherDocument {
  return {
    id: extra.id,
    docType: "TREASURY_VOUCHER",
    docNo: null,
    date: extra.date,
    memo: extra.memo,
    status: extra.status,
    lines: [line],
    createdAt: "",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function TreasuryVouchersScreen() {
  const { t } = useAppTranslation();
  const { label: voucherLabel, subtitle: voucherSubtitle } = useDomainLabels();
  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const treasuryQuery = useTreasuryAccounts();
  const accountsQuery = useAccounts();

  const [mode, setMode] = useState<"list" | "create" | "detail">("list");
  // Arriving from «تحصيل» on an invoice row: the customer is known, so the
  // create form opens as a collection already pointed at them (R3.5).
  const [prefillParty, setPrefillParty] = useState<{ customerId?: string; supplierId?: string } | null>(null);
  useScreenIntent((intent) => {
    setPrefillParty(
      intent.prefill?.customerId
        ? { customerId: intent.prefill.customerId }
        : intent.prefill?.supplierId
          ? { supplierId: intent.prefill.supplierId }
          : null,
    );
    setMode("create");
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "needs_allocation" | "needs_allocation_receipt" | "needs_allocation_payment" | VoucherStatusDTO
  >("all");
  const [typeFilter, setTypeFilter] = useState<"all" | VoucherType>("all");
  const [branchFilter, setBranchFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const debouncedSearch = useDebounced(search);
  /**
   * One filter object for the rows and the chip counts, including the
   * needs-allocation queues — which are a server concern (R8.3): a work queue
   * has to be right over every voucher, not over the page the client holds.
   */
  const listFilter: VoucherListQueryDTO = useMemo(
    () => ({
      ...(typeFilter === "all" ? {} : { type: typeFilter }),
      ...(statusFilter === "needs_allocation"
        ? { needsAllocation: "any" as const }
        : statusFilter === "needs_allocation_receipt"
          ? { needsAllocation: "receipt" as const }
          : statusFilter === "needs_allocation_payment"
            ? { needsAllocation: "payment" as const }
            : statusFilter === "all"
              ? {}
              : { status: statusFilter }),
      ...(branchFilter ? { branchId: branchFilter } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    }),
    [typeFilter, statusFilter, branchFilter, fromDate, toDate, debouncedSearch],
  );
  const query = useVouchers(listFilter);
  const voucherCounts = useVoucherCounts(listFilter).data ?? {};
  // The KPI strip has to honour the active chip (R1.1) — /stats, unlike
  // /counts, keeps the status filter, so switching to "مسودة" moves the
  // header numbers instead of leaving them at the grand total.
  const voucherStats = useVoucherStats(listFilter).data ?? {};
  const branches = useBranches().data ?? [];
  const cancelVoucher = useCancelVoucher();

  const documents = query.data ?? [];
  const customers = customersQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];

  const partyName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.nameAr);
    for (const s of suppliers) map.set(s.id, s.nameAr);
    return (id: string | null) => (id ? (map.get(id) ?? id) : t("vouchers.noParty"));
  }, [customers, suppliers]);

  const treasuryName = useMemo(() => {
    const map = new Map(treasuryAccounts.map((account) => [account.id, account.name]));
    return (id: string) => map.get(id) ?? id;
  }, [treasuryAccounts]);

  const counts = {
    all: voucherCounts.all ?? 0,
    confirmed: voucherCounts.confirmed ?? 0,
    draft: voucherCounts.draft ?? 0,
    needsAllocation: voucherCounts.needs_allocation ?? 0,
    needsAllocationReceipt: voucherCounts.needs_allocation_receipt ?? 0,
    needsAllocationPayment: voucherCounts.needs_allocation_payment ?? 0,
    cancelled: voucherCounts.cancelled ?? 0,
  };

  /**
   * EVERY type, not just the ones already used. A type filter that lists only
   * types with vouchers cannot be used to discover that a type has none, which
   * is the question a treasurer actually asks (R8.2).
   */
  const typeBreakdown = VOUCHER_TYPE_DEFINITIONS.map(
    (def) => [def.code, voucherCounts[`type:${def.code}`] ?? 0] as const,
  );

  const filtered = documents;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) + (typeFilter === "all" ? 0 : 1) + (branchFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0);

  const columns: DocumentListColumn<VoucherRowDTO>[] = [
    {
      key: "docNo",
      header: t("vouchers.voucherNumber"),
      sortable: true,
      render: (d) => (
        <div>
          <div className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{d.date}</div>
        </div>
      ),
    },
    { key: "type", header: t("vouchers.voucherType"), render: (d) => voucherLabel(getVoucherTypeDefinition(d.voucherType)) },
    {
      key: "party",
      header: t("vouchers.party"),
      render: (d) => <span className="text-ink">{partyName(d.customerId ?? d.supplierId)}</span>,
    },
    {
      key: "treasury",
      header: t("vouchers.treasuryAccount"),
      render: (d) => {
        if (d.direction === "transfer" && d.counterTreasuryAccountId) {
          return (
            <span className="text-[12px] text-ink-muted">
              {treasuryName(d.treasuryAccountId)} ← {treasuryName(d.counterTreasuryAccountId)}
            </span>
          );
        }
        return <span className="text-[12px] text-ink-muted">{treasuryName(d.treasuryAccountId)}</span>;
      },
    },
    {
      key: "amount",
      header: t("common.amount"),
      align: "end",
      render: (d) => {
        const tone = d.direction === "receipt" ? "text-success-ink" : d.direction === "payment" ? "text-danger-ink" : "text-ink";
        const sign = d.direction === "receipt" ? "+" : d.direction === "payment" ? "−" : "";
        return (
          <span className={tone}>
            {sign}
            <MoneyDisplay value={toMajor(d.amount)} />
          </span>
        );
      },
    },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={t(STATUS_KEY[d.status])} tone={STATUS_TONE[d.status]} /> },
  ];

  function openDetail(id: string) {
    setSelectedId(id);
    setMode("detail");
  }

  if (mode === "create") {
    return (
      <CreateVoucherView
        customers={customers}
        suppliers={suppliers}
        treasuryAccounts={treasuryAccounts}
        accounts={accounts}
        initialCustomerId={prefillParty?.customerId ?? null}
        initialSupplierId={prefillParty?.supplierId ?? null}
        onDone={() => setMode("list")}
      />
    );
  }

  if (mode === "detail" && selectedId) {
    return <VoucherDetailView id={selectedId} partyName={partyName} treasuryName={treasuryName} onBack={() => setMode("list")} />;
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("vouchers.vouchersCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<VoucherRowDTO>
        title={t("vouchers.cashVouchers")}
        description={t("vouchers.receiptsDisbursementsAndTransfersOne")}
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            {t("vouchers.newVoucher")}
          </Button>
        }
        listKey="treasury-vouchers"
        statsCollapsible
        stats={[
          { label: t("common.total"), value: <span className="mz-num">{Number(voucherStats.count ?? 0)}</span> },
          { label: t("docStatus.confirmed"), value: <span className="mz-num">{Number(voucherStats.confirmed ?? 0)}</span> },
          { label: t("vouchers.needsAllocation"), value: <span className="mz-num">{Number(voucherStats.needsAllocation ?? 0)}</span> },
          { label: t("docStatus.draft"), value: <span className="mz-num">{Number(voucherStats.draft ?? 0)}</span> },
        ]}
        attentionBanners={[
          {
            key: "needs_allocation",
            label: t("vouchers.banner.needsAllocation", { count: counts.needsAllocation }),
            count: counts.needsAllocation,
            tone: "warning",
            onApply: () => {
              setStatusFilter("needs_allocation");
              setPage(1);
            },
          },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: counts.all },
          { key: "needs_allocation", label: t("vouchers.needsAllocation"), count: counts.needsAllocation },
          { key: "needs_allocation_receipt", label: t("vouchers.needsAllocationReceipts"), count: counts.needsAllocationReceipt },
          { key: "needs_allocation_payment", label: t("vouchers.needsAllocationPayments"), count: counts.needsAllocationPayment },
          { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed },
          { key: "draft", label: t("docStatus.draft"), count: counts.draft },
          { key: "cancelled", label: t("docStatus.cancelled"), count: counts.cancelled },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as typeof statusFilter);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("vouchers.searchByVoucherNumberReference")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex w-full flex-col gap-[10px]">
            <div className="grid w-full gap-2 sm:grid-cols-3">
              <SelectField
                label={t("vouchers.filter.branch")}
                value={branchFilter}
                onChange={(value) => {
                  setBranchFilter(value);
                  setPage(1);
                }}
                options={[
                  { value: "", label: t("vouchers.filter.allBranches") },
                  ...branches.map((b) => ({ value: b.id, label: b.name })),
                ]}
              />
              <TextField
                label={t("vouchers.filter.fromDate")}
                value={fromDate}
                onChange={(value) => {
                  setFromDate(value);
                  setPage(1);
                }}
                type="date"
              />
              <TextField
                label={t("vouchers.filter.toDate")}
                value={toDate}
                onChange={(value) => {
                  setToDate(value);
                  setPage(1);
                }}
                type="date"
              />
            </div>
          <div className="flex flex-wrap gap-[8px]">
            <Chip
              active={typeFilter === "all"}
              onClick={() => {
                setTypeFilter("all");
                setPage(1);
              }}
            >
              {t("vouchers.allTypes")}
            </Chip>
            {typeBreakdown.map(([type, n]) => (
              <Chip
                key={type}
                active={typeFilter === type}
                onClick={() => {
                  setTypeFilter(type);
                  setPage(1);
                }}
              >
                {voucherLabel(getVoucherTypeDefinition(type))} ({n})
              </Chip>
            ))}
          </div>
          </div>
        }
        columns={columns}
        rows={pageRows}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        rowAction={(d) => (
          <RowMenu
            label={t("vouchers.action.view") + " " + (d.docNo ?? d.id)}
            items={[
              { key: "view", label: t("vouchers.action.view"), onSelect: () => openDetail(d.id) },
              { key: "print", label: t("vouchers.action.print"), onSelect: () => window.print() },
              // A confirmed voucher is REVERSED, never cancelled — the entry
              // it posted is immutable. Only a draft can be voided outright.
              ...(d.status === "draft"
                ? [
                    {
                      key: "cancel",
                      label: t("vouchers.action.cancel"),
                      tone: "danger" as const,
                      disabled: cancelVoucher.isPending,
                      onSelect: () => {
                        if (cancelVoucher.isPending) return;
                        cancelVoucher.mutate(d.id);
                      },
                    },
                  ]
                : []),
            ]}
          />
        )}
        page={page}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("vouchers.vouchers")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("vouchers.noMatchingVouchers")}
            description={t("vouchers.emptyBody")}
            action={{ label: t("vouchers.newVoucher"), onClick: () => setMode("create") }}
          />
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Detail view                                                          */
/* -------------------------------------------------------------------- */

function VoucherDetailView({
  id,
  partyName,
  treasuryName,
  onBack,
}: {
  id: string;
  partyName: (id: string | null) => string;
  treasuryName: (id: string) => string;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const { label: voucherLabel, subtitle: voucherSubtitle } = useDomainLabels();
  const query = useVoucherDetail(id);
  const reverseVoucher = useReverseVoucher();
  const createAllocation = useCreateAllocation();
  const reverseAllocation = useReverseAllocation();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reversingAllocId, setReversingAllocId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [allocAmount, setAllocAmount] = useState<number | null>(null);

  const doc = query.data;
  const def = doc ? getVoucherTypeDefinition(doc.voucherType) : null;
  const partyId = doc ? (doc.customerId ?? doc.supplierId) : null;
  const openInvoicesQuery = useOpenInvoices(def?.allocationKind ?? undefined, partyId);
  const openInvoices = openInvoicesQuery.data ?? [];
  const invoiceById = useMemo(() => new Map(openInvoices.map((i) => [i.id, i])), [openInvoices]);

  const effects = useMemo(() => {
    if (!doc) return null;
    const line = toVoucherLine(doc);
    const preview = toPreviewDoc(line, { id: doc.id, date: doc.date, memo: doc.memo, status: doc.status });
    return voucherDocumentType.describeEffects(preview);
  }, [doc]);

  async function handleReverseVoucher() {
    if (busy || !doc) return;
    setBusy(true);
    setError(null);
    try {
      await reverseVoucher.mutateAsync({ id: doc.id });
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vouchers.theVoucherCouldNotBe"));
    } finally {
      setBusy(false);
    }
  }

  async function handleAllocate() {
    if (busy || !doc || invoiceId === "" || !allocAmount || allocAmount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await createAllocation.mutateAsync({ voucherId: doc.id, body: { invoiceId, amount: String(allocAmount) } });
      setInvoiceId("");
      setAllocAmount(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vouchers.theAmountCouldNotBe"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReverseAllocation(allocId: string) {
    if (reversingAllocId) return;
    setReversingAllocId(allocId);
    setError(null);
    try {
      await reverseAllocation.mutateAsync(allocId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vouchers.theAllocationCouldNotBe"));
    } finally {
      setReversingAllocId(null);
    }
  }

  if (!doc || !def) {
    return (
      <div className="w-full">
        <Button onClick={onBack}>{t("common.back")}</Button>
        {query.isError ? (
          <Card className="mt-[16px] p-[18px_20px]">
            <p className="text-[13px] font-semibold text-danger-ink">{t("vouchers.theVoucherCouldNotBe2")}</p>
          </Card>
        ) : null}
      </div>
    );
  }

  const summary = doc.allocationSummary;
  const activeAllocations = doc.allocations.filter((a) => a.status === "active");

  const summaryItems = [
    { label: t("common.type"), value: voucherLabel(def) },
    { label: t("common.date"), value: <span className="mz-num">{doc.date}</span> },
    { label: t("vouchers.paymentMethod"), value: getVoucherPaymentMethodLabel(doc.paymentMethod) },
    { label: t("vouchers.party"), value: partyName(partyId) },
    { label: t("common.amount"), value: <MoneyDisplay value={toMajor(doc.amount)} /> },
    ...(def.allocatable
      ? [
          {
            label: t("vouchers.allocation"),
            value: summary.fullyAllocated ? t("vouchers.fullyAllocated") : t("vouchers.allocatedAmount", { amount: summary.allocated }),
            valueTone: summary.needsAllocation ? ("danger" as const) : ("success" as const),
          },
        ]
      : []),
  ];

  const allocationTab = {
    key: "allocation",
    label: t("vouchers.tab.allocations", { count: activeAllocations.length }),
    content: (
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <StatusPill
            label={summary.needsAllocation ? t("vouchers.needsAllocation") : t("vouchers.fullyAllocated")}
            tone={summary.needsAllocation ? "warning" : "success"}
          />
          <span className="text-[12.5px] text-ink-muted">
            {t("vouchers.unallocatedRemainder")} <MoneyDisplay value={toMajor(summary.unallocated)} />
          </span>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("vouchers.invoiceNumber")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.amount")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.date")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px]" />
                </tr>
              </thead>
              <tbody>
                {activeAllocations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-[15px] py-[16px] text-center text-ink-muted">{t("vouchers.noAllocationsYet")}</td>
                  </tr>
                ) : (
                  activeAllocations.map((a) => {
                    const inv = invoiceById.get(a.invoiceId);
                    return (
                      <tr key={a.id} className="border-b border-border last:border-b-0">
                        <td className="mz-num px-[15px] py-[11px] text-ink">{inv?.invoiceNo ?? a.invoiceId}</td>
                        <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={toMajor(a.amount)} /></td>
                        <td className="mz-num px-[15px] py-[11px] text-ink-muted">{a.createdAt.slice(0, 10)}</td>
                        <td className="px-[15px] py-[11px] text-end">
                          <Button
                            size="sm"
                            variant="danger-outline"
                            disabled={reversingAllocId === a.id}
                            onClick={() => handleReverseAllocation(a.id)}
                          >
                            {reversingAllocId === a.id ? "…" : t("vouchers.reverseAllocation")}
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {doc.status === "confirmed" && summary.needsAllocation ? (
          <Card className="flex flex-col gap-[12px] p-[16px_18px]">
            <h3 className="font-display text-[13.5px] font-bold text-ink">{t("vouchers.allocateAnAmountToAn")}</h3>
            {openInvoices.length === 0 ? (
              <div className="text-[12.5px] text-ink-muted">{t("vouchers.thisPartyHasNoOpen")}</div>
            ) : (
              <>
                <SelectField
                  label={t("vouchers.invoice")}
                  value={invoiceId}
                  onChange={setInvoiceId}
                  options={[
                    { value: "", label: t("vouchers.chooseAnInvoice") },
                    ...openInvoices.map((i) => ({
                      value: i.id,
                      label: t("vouchers.invoiceOutstanding", { number: i.invoiceNo, outstanding: i.outstanding }),
                    })),
                  ]}
                />
                <div>
                  <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("common.amount")}</div>
                  <MoneyInput value={allocAmount} onChange={setAllocAmount} aria-label={t("vouchers.amountToAllocate")} />
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" disabled={busy || invoiceId === "" || !allocAmount} onClick={handleAllocate}>
                    {t("vouchers.allocate")}
                  </Button>
                </div>
              </>
            )}
          </Card>
        ) : null}
      </div>
    ),
  };

  const tabs = [
    ...(def.allocatable ? [allocationTab] : []),
    {
      key: "gl",
      label: t("vouchers.journalEntries"),
      content: (
        <Card className="p-[16px_18px] text-[12.5px] text-ink-muted">
          {doc.journalEntryId ? (
            <span>
              {t("vouchers.thisVoucherPostedABalanced")} <span className="mz-num text-ink">{doc.docNo}</span>
            </span>
          ) : (
            <span>{t("vouchers.thisVoucherHasNotPosted")}</span>
          )}
        </Card>
      ),
    },
    {
      key: "attachments",
      label: t("attachments.tab"),
      content: <AttachmentsTab entityType="voucher" entityId={doc.id} />,
    },
  ];

  return (
    <div className="w-full">
      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <DocumentDetail
        title={doc.docNo ?? t("vouchers.cashVoucher")}
        statusLabel={t(STATUS_KEY[doc.status])}
        statusTone={STATUS_TONE[doc.status]}
        subtitle={<DocumentStatusStepper steps={STEPPER_KEYS.map((step): DocumentStatusStep => ({ key: step.key, label: t(step.labelKey) }))} currentKey={doc.status} tone={doc.status === "reversed" ? "danger" : "brand"} />}
        actions={
          <>
            <Button onClick={onBack}>{t("common.back")}</Button>
            {doc.status === "confirmed" ? (
              <Button variant="danger-outline" disabled={busy} onClick={handleReverseVoucher}>
                {t("vouchers.reverseVoucher")}
              </Button>
            ) : null}
          </>
        }
        summary={summaryItems}
        effectsTitle={t("vouchers.whatThisVoucherDoes")}
        effects={(effects?.effects ?? []).map((e) => e.description)}
        tabs={tabs}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

/**
 * Egypt withholds tax on most local B2B payments (docs/defects.md D27): the
 * supplier is settled in FULL for `amount`, and the withheld slice goes to the
 * authority instead of to them. Only a payment can withhold.
 */
const WITHHOLDING_GL_ACCOUNT = "2210";

function withholdingOf(amount: Money, ratePercent: number | null, direction: string) {
  if (direction !== "payment" || !ratePercent || ratePercent <= 0) {
    return { withholdingAmount: null, withholdingRatePercent: null, withholdingGlAccountId: null };
  }
  const withheld = Money.fromScaled((amount.scaled * BigInt(Math.round(ratePercent * 100))) / 10_000n);
  return {
    withholdingAmount: withheld,
    withholdingRatePercent: ratePercent,
    withholdingGlAccountId: WITHHOLDING_GL_ACCOUNT,
  };
}

interface CreateDraft {
  amount: number | null;
  paymentMethod: VoucherPaymentMethod;
  treasuryAccountId: string;
  counterTreasuryAccountId: string;
  counterpartyGlAccountId: string;
  partyId: string;
  date: string;
  referenceNo: string;
  costCenterId: string;
  withholdingRatePercent: number | null;
  memo: string;
}

function CreateVoucherView({
  customers,
  suppliers,
  treasuryAccounts,
  accounts,
  initialCustomerId = null,
  initialSupplierId = null,
  onDone,
}: {
  customers: CustomerDTO[];
  suppliers: SupplierDTO[];
  treasuryAccounts: TreasuryAccountDTO[];
  accounts: AccountDTO[];
  initialCustomerId?: string | null;
  initialSupplierId?: string | null;
  onDone: () => void;
}) {
  const { t } = useAppTranslation();
  const { label: voucherLabel, subtitle: voucherSubtitle } = useDomainLabels();
  const createVoucher = useCreateVoucher();
  const confirmVoucher = useConfirmVoucher();
  const branchesQuery = useBranches();
  const costCentersQuery = useCostCenters();

  // A collection is what «تحصيل» means; without a customer the user still picks the type.
  // «تحصيل» means a collection and «صرف دفعة» a supplier payment; without a
  // party the user still picks the type from the grid.
  const [type, setType] = useState<VoucherType | null>(
    initialCustomerId ? "customer_collection" : initialSupplierId ? "supplier_payment" : null,
  );
  const [draft, setDraft] = useState<CreateDraft>({
    amount: null,
    paymentMethod: "cash",
    treasuryAccountId: treasuryAccounts[0]?.id ?? "",
    counterTreasuryAccountId: treasuryAccounts[1]?.id ?? "",
    counterpartyGlAccountId: "4900",
    partyId: initialCustomerId ?? initialSupplierId ?? "",
    date: todayIso(),
    referenceNo: "",
    costCenterId: "",
    withholdingRatePercent: null,
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const def = type ? getVoucherTypeDefinition(type) : null;

  const workingLocation = useWorkingLocation();
  const treasuryOptions = treasuryAccounts.map((account) => ({ value: account.id, label: `${account.name} (${account.code})` }));
  const partyOptions: EntityPickerOption[] = def?.requiresCustomer
    ? customers.map((c) => ({ id: c.id, label: c.nameAr }))
    : def?.requiresSupplier
      ? suppliers.map((s) => ({ id: s.id, label: s.nameAr }))
      : [];
  const costCenterOptions = [
    { value: "", label: t("vouchers.costCenterUnassigned") },
    ...(costCentersQuery.data ?? []).map((cc) => ({ value: cc.id, label: `${cc.code} — ${cc.nameAr}` })),
  ];
  const revenueOrExpenseOptions =
    type === "other_income"
      ? accounts.filter((a) => a.type === "revenue").map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` }))
      : type === "other_expense"
        ? accounts.filter((a) => a.type === "expense").map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` }))
        : [];

  function treasuryGlOf(id: string): string {
    return treasuryAccounts.find((account) => account.id === id)?.glAccountId ?? "";
  }

  function counterpartyGl(): string | null {
    if (!type) return null;
    if (def!.direction === "transfer") return null;
    const fixed = FIXED_COUNTERPARTY[type];
    return fixed ?? draft.counterpartyGlAccountId;
  }

  function buildLine(): VoucherLine | null {
    if (!type || !def) return null;
    const amount = Money.fromMajor(String(draft.amount ?? 0));
    return {
      voucherType: type,
      direction: def.direction,
      amount,
      currency: "EGP",
      branchId: workingLocation.branchId ?? branchesQuery.data?.[0]?.id ?? "",
      paymentMethod: draft.paymentMethod,
      treasuryAccountId: draft.treasuryAccountId,
      treasuryGlAccountId: treasuryGlOf(draft.treasuryAccountId),
      counterpartyGlAccountId: counterpartyGl(),
      counterTreasuryAccountId: def.direction === "transfer" ? draft.counterTreasuryAccountId : null,
      counterTreasuryGlAccountId: def.direction === "transfer" ? treasuryGlOf(draft.counterTreasuryAccountId) : null,
      customerId: def.requiresCustomer ? draft.partyId || null : null,
      supplierId: def.requiresSupplier ? draft.partyId || null : null,
      referenceNo: draft.referenceNo || null,
      costCenterId: draft.costCenterId || null,
      ...withholdingOf(amount, draft.withholdingRatePercent, def.direction),
    };
  }

  // A preview document for the live effects panel — a pure client-side computation, no network call.
  const previewEffects = useMemo(() => {
    if (!type || !def) return null;
    const line = buildLine();
    if (!line || line.amount.scaled <= 0n) return null;
    const preview = toPreviewDoc(line, { id: "preview", date: draft.date, memo: draft.memo || voucherLabel(def), status: "draft" });
    try {
      return voucherDocumentType.describeEffects(preview);
    } catch {
      return null;
    }
  }, [type, def, draft]);

  async function submitVoucher() {
    if (!type || !def || busy) return;
    const line = buildLine();
    if (!line) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createVoucher.mutateAsync({
        date: draft.date,
        memo: draft.memo || voucherLabel(def),
        voucherType: line.voucherType,
        amount: line.amount.toString(),
        branchId: line.branchId,
        paymentMethod: line.paymentMethod,
        treasuryAccountId: line.treasuryAccountId,
        treasuryGlAccountId: line.treasuryGlAccountId,
        counterpartyGlAccountId: line.counterpartyGlAccountId,
        counterTreasuryAccountId: line.counterTreasuryAccountId,
        counterTreasuryGlAccountId: line.counterTreasuryGlAccountId,
        customerId: line.customerId,
        supplierId: line.supplierId,
        referenceNo: line.referenceNo,
        costCenterId: line.costCenterId ?? null,
        withholdingAmount: line.withholdingAmount ? line.withholdingAmount.toString() : null,
        withholdingRatePercent: line.withholdingRatePercent ?? null,
        withholdingGlAccountId: line.withholdingGlAccountId ?? null,
      });
      await confirmVoucher.mutateAsync({ id: created.id });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("vouchers.theVoucherCouldNotBe3"));
    } finally {
      setBusy(false);
    }
  }

  if (!type || !def) {
    return (
      <div className="w-full">
        <div className="mb-[16px] flex items-end justify-between gap-[18px]">
          <div>
            <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("vouchers.chooseAVoucherType")}</h1>
          </div>
          <Button onClick={onDone}>{t("common.cancel")}</Button>
        </div>
        <FulcrumRule />
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
          {VOUCHER_TYPE_DEFINITIONS.map((d) => (
            <button
              key={d.code}
              type="button"
              onClick={() => setType(d.code)}
              className="rounded-lg border border-border bg-surface p-[16px] text-start shadow-1 transition-colors hover:border-brand"
            >
              <div className="font-display text-[14px] font-bold text-ink">{voucherLabel(d)}</div>
              <div className="mt-[6px] text-[12px] text-ink-muted">{voucherSubtitle(d)}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const canSubmit =
    !busy &&
    (draft.amount ?? 0) > 0 &&
    draft.treasuryAccountId !== "" &&
    (!def.requiresCustomer && !def.requiresSupplier ? true : draft.partyId !== "") &&
    (def.direction === "transfer" ? draft.counterTreasuryAccountId !== "" && draft.counterTreasuryAccountId !== draft.treasuryAccountId : true);

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{voucherLabel(def)}</h1>
          <button type="button" onClick={() => setType(null)} className="mt-[6px] text-[12px] text-brand underline">
            {t("vouchers.changeVoucherType")}
          </button>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submitVoucher}>
            {t("vouchers.createAndConfirm")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="flex flex-col gap-[14px] p-[18px]">
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("vouchers.amount")}</div>
            <MoneyInput value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} aria-label={t("common.amount")} />
          </div>

          <SelectField
            label={t("vouchers.paymentMethod2")}
            value={draft.paymentMethod}
            onChange={(v) => setDraft((d) => ({ ...d, paymentMethod: v as VoucherPaymentMethod }))}
            options={VOUCHER_PAYMENT_METHODS.map((m) => ({ value: m.code, label: voucherLabel(m) }))}
          />

          <SelectField
            label={def.direction === "transfer" ? t("vouchers.fromTreasury") : t("vouchers.treasuryAccount2")}
            value={draft.treasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, treasuryAccountId: v }))}
            options={treasuryOptions}
          />

          {def.direction === "transfer" ? (
            <SelectField
              label={t("vouchers.toTreasury")}
              value={draft.counterTreasuryAccountId}
              onChange={(v) => setDraft((d) => ({ ...d, counterTreasuryAccountId: v }))}
              options={treasuryOptions}
            />
          ) : null}

          {def.requiresCustomer || def.requiresSupplier ? (
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{def.requiresCustomer ? t("vouchers.customer") : t("vouchers.supplier")}</div>
              <EntityPicker
                label={undefined}
                value={partyOptions.find((o) => o.id === draft.partyId) ?? null}
                onChange={(o) => setDraft((d) => ({ ...d, partyId: o?.id ?? "" }))}
                options={partyOptions}
                placeholder={def.requiresCustomer ? t("vouchers.searchForACustomer") : t("vouchers.searchForASupplier")}
              />
            </div>
          ) : null}

          {type === "other_income" || type === "other_expense" ? (
            <SelectField
              label={t("vouchers.contraAccount")}
              value={draft.counterpartyGlAccountId}
              onChange={(v) => setDraft((d) => ({ ...d, counterpartyGlAccountId: v }))}
              options={revenueOrExpenseOptions}
            />
          ) : null}

          <TextField label={t("vouchers.date")} value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />
          <TextField label={t("vouchers.referenceNumber")} value={draft.referenceNo} onChange={(v) => setDraft((d) => ({ ...d, referenceNo: v }))} />
          {def.direction === "payment" ? (
            <NumberField
              label={t("vouchers.withholdingRate")}
              value={draft.withholdingRatePercent ?? 0}
              onChange={(v) => setDraft((d) => ({ ...d, withholdingRatePercent: v }))}
              hint={t("vouchers.withholdingHint")}
            />
          ) : null}
          <SelectField
            label={t("vouchers.costCenter")}
            value={draft.costCenterId}
            onChange={(v) => setDraft((d) => ({ ...d, costCenterId: v }))}
            options={costCenterOptions}
          />
          <TextField label={t("common.notes")} value={draft.memo} onChange={(v) => setDraft((d) => ({ ...d, memo: v }))} placeholder={voucherLabel(def)} />
        </Card>

        <div
          className="h-fit rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
          style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
        >
          <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">{t("vouchers.whatThisVoucherDoes")}</h3>
          <p className="mb-[10px] text-[12px] text-ink-muted">{def.subtitleAr}</p>
          <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
            {(previewEffects?.effects ?? []).map((e, i) => (
              <li key={i} className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {e.description}
              </li>
            ))}
            {!previewEffects ? <li className="text-ink-muted">{t("vouchers.enterAnAmountToSee")}</li> : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

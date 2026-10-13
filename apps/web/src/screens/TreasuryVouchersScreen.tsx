import { useCallback, useEffect, useMemo, useState } from "react";
import { useDocumentEffectText } from "../lib/document-effects";
import {
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  EmptyState,
  Money as MoneyDisplay,
  StatusPill,
  Chip,
  Card,
  Button,
  MoneyStringInput,
  EntityPicker,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
  type EntityPickerOption,
  RowMenu,
} from "@mezan/ui";
import {
  getVoucherPaymentMethodLabel,
  getVoucherTypeDefinition,
  isVoucherType,
  BASE_CURRENCY,
  convertFromBase,
  Money,
  VOUCHER_PAYMENT_METHODS,
  VOUCHER_TYPE_DEFINITIONS,
  type VoucherDocument,
  voucherDocumentType,
  type VoucherLine,
  type VoucherPaymentMethod,
  type VoucherType,
} from "@mezan/domain";
import type {
  AccountDTO,
  CostCategoryDTO,
  CustomerDTO,
  ProjectDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  VoucherListQueryDTO,
  VoucherStatusDTO,
} from "@mezan/contracts";
import { ReversalDocumentType } from "@mezan/contracts";
import {
  useAccounts,
  useBranches,
  useExchangeRates,
  useCostCenters,
  useConfirmVoucher,
  useCreateAllocation,
  useCreateVoucher,
  useCreateCollection,
  useCustomers,
  useOpenInvoices,
  useProjects,
  useReverseAllocation,
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
import { TreasuryCurrencyNotice, type TreasuryCurrencyRate } from "./TreasuryCurrencyNotice";
import { NumberField, SelectField, TextField } from "../settings/form-controls";
import { VoucherPrintPage } from "../print/documents";
import { useNameSubPage, useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { useDomainLabels } from "../lib/domain-labels";
import { useDebounced } from "../lib/use-debounced";
import { todayIso } from "../lib/dates";
import { useReverseDocumentAction } from "../reversal/ReverseDocumentAction";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** السندات النقدية (Treasury Vouchers) — docs/archive/catalog/04, on the real `/vouchers` API. */

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

/** Projects still open for new spend/income — a project that finished or was cancelled cannot take new lines. */
const OPEN_PROJECT_STATUSES = new Set<ProjectDTO["status"]>(["planned", "active", "on_hold"]);

const COST_CATEGORY_VALUES: readonly CostCategoryDTO[] = ["materials", "labour", "equipment", "subcontract", "indirect"];

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
  projectId?: string | null;
  costCategory?: CostCategoryDTO | null;
  treasuryFx?: VoucherRowDTO["treasuryFx"];
}): VoucherLine {
  const leg = d.treasuryFx;
  return {
    ...d,
    amount: Money.fromMajor(d.amount),
    treasuryFx: leg
      ? {
          currency: leg.currency,
          fxRate: leg.fxRate,
          foreignAmount: Money.fromMajor(leg.foreignAmount),
          ...(leg.carryingBase ? { carryingBase: Money.fromMajor(leg.carryingBase) } : {}),
          ...(leg.realised ? { realised: Money.fromMajor(leg.realised) } : {}),
          ...(leg.realisedAccountId ? { realisedAccountId: leg.realisedAccountId } : {}),
        }
      : null,
    counterTreasuryFx: null,
  };
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
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const { label: voucherLabel, subtitle: voucherSubtitle } = useDomainLabels();
  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const treasuryQuery = useTreasuryAccounts();
  const accountsQuery = useAccounts();

  // The open voucher lives in the URL like every other document screen, so the
  // shell's breadcrumb (and the «رجوع» that sits beside it) can lead out of it.
  const subPage = useSubPage();
  const [selectedId] = subPage.segments;
  // Arriving from «تحصيل» on an invoice row: the customer is known, so the
  // create form opens as a collection already pointed at them (R3.5).
  const [prefillParty, setPrefillParty] = useState<{ customerId?: string; supplierId?: string } | null>(null);
  // A caller that names the voucher type gets the form open on it. The command
  // palette offers «تحصيل من عميل» and «دفع لمورد» as separate entries; without
  // this they both landed on the same untyped grid, so two of the three
  // advertised actions were describing something the app did not do.
  const [prefillType, setPrefillType] = useState<VoucherType | null>(null);
  useScreenIntent((intent) => {
    setPrefillParty(
      intent.prefill?.customerId
        ? { customerId: intent.prefill.customerId }
        : intent.prefill?.supplierId
          ? { supplierId: intent.prefill.supplierId }
          : null,
    );
    const named = intent.prefill?.voucherType;
    setPrefillType(named && isVoucherType(named) ? named : null);
    subPage.open("new");
  });
  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | "needs_allocation" | "needs_allocation_receipt" | "needs_allocation_payment" | VoucherStatusDTO,
    (next: string) => void,
  ];
  const [typeFilter, setTypeFilter] = useUrlParam("type", "all") as [
    "all" | VoucherType,
    (next: string) => void,
  ];
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const debouncedSearch = useDebounced(search);
  /**
   * One filter object for the rows and the chip counts, including the
   * needs-allocation queues — which are a server concern (R8.3): a work queue
   * has to be right over every voucher, not over the page the client holds.
   */
  const listFilter: Partial<VoucherListQueryDTO> = useMemo(
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
  // Only the ROWS query carries the page (Q-9): the screen used to fetch every
  // voucher in the book and slice it here, and the chips and the KPI strip
  // still have to speak for the whole filtered set.
  const query = useVouchers({ ...listFilter, page, pageSize });
  const voucherCounts = useVoucherCounts(listFilter).data ?? {};
  // The KPI strip has to honour the active chip (R1.1) — /stats, unlike
  // /counts, keeps the status filter, so switching to "مسودة" moves the
  // header numbers instead of leaving them at the grand total.
  const voucherStats = useVoucherStats(listFilter).data ?? {};
  const branches = useBranches().data ?? [];
  const cancelVoucher = useCancelVoucher();
  /**
   * WHICH voucher is being cancelled, not merely that one is.
   *
   * `cancelVoucher.isPending` is mutation-wide, so binding it to every row's
   * menu greyed out «إلغاء» on every other draft voucher while one request was
   * in flight. The cashier cancelling a mistyped voucher could not touch the
   * next one until the first came back.
   */
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const documents = query.data ?? [];
  const customers = customersQuery.data ?? EMPTY;
  const suppliers = suppliersQuery.data ?? EMPTY;
  const treasuryAccounts = treasuryQuery.data ?? EMPTY;
  const accounts = accountsQuery.data ?? [];

  const partyName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, nameOf(c));
    for (const s of suppliers) map.set(s.id, nameOf(s));
    return (id: string | null) => (id ? (map.get(id) ?? id) : t("vouchers.noParty"));
  }, [customers, suppliers, nameOf, t]);

  const treasuryName = useMemo(() => {
    const map = new Map(treasuryAccounts.map((account) => [account.id, nameOf(account)]));
    return (id: string) => map.get(id) ?? id;
  }, [treasuryAccounts, nameOf]);

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

  // What the server returned IS the page; `counts.all` is the filtered total.
  const pageRows = documents;
  const totalRows = counts.all ?? pageRows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

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
    subPage.open(id);
  }
  const addressed = selectedId && selectedId !== "new" ? documents.find((d) => d.id === selectedId || d.docNo === selectedId) : undefined;
  useNameSubPage(addressed ? selectedId : null, addressed ? (addressed.docNo ?? t("docStatus.draft")) : null);

  if (selectedId === "new") {
    return (
      <CreateVoucherView
        customers={customers}
        suppliers={suppliers}
        treasuryAccounts={treasuryAccounts}
        accounts={accounts}
        initialCustomerId={prefillParty?.customerId ?? null}
        initialSupplierId={prefillParty?.supplierId ?? null}
        initialVoucherType={prefillType}
        onDone={subPage.close}
      />
    );
  }

  // سند الخزينة as a document (P-6). It was `window.print()` over the list,
  // which put the browser chrome and the filter bar on a signed instrument.
  if (selectedId && subPage.segments[1] === "print") {
    const voucher = documents.find((d) => d.id === selectedId || d.docNo === selectedId);
    if (voucher) {
      return <VoucherPrintPage voucher={voucher} partyName={partyName(voucher.customerId ?? voucher.supplierId)} />;
    }
  }

  if (selectedId) {
    return <VoucherDetailView id={selectedId} partyName={partyName} treasuryName={treasuryName} onBack={subPage.close} />;
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
          <Button variant="primary" onClick={() => subPage.open("new")}>
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
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
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
          <div className="flex flex-wrap gap-[8px]" role="radiogroup">
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
        loading={query.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        rowAction={(d) => (
          <RowMenu
            label={t("vouchers.action.view") + " " + (d.docNo ?? d.id)}
            items={[
              { key: "view", label: t("vouchers.action.view"), onSelect: () => openDetail(d.id) },
              { key: "print", label: t("vouchers.action.print"), onSelect: () => subPage.open(d.docNo ?? d.id, "print") },
              // A confirmed voucher is REVERSED, never cancelled — the entry
              // it posted is immutable. Only a draft can be voided outright.
              ...(d.status === "draft"
                ? [
                    {
                      key: "cancel",
                      label: t("vouchers.action.cancel"),
                      tone: "danger" as const,
                      disabled: cancellingId === d.id,
                      onSelect: () => {
                        // The concurrency guard stays an early return rather
                        // than a disabled attribute on every sibling row.
                        if (cancellingId !== null) return;
                        setCancellingId(d.id);
                        // onSettled, not onSuccess: a failed cancel that never
                        // cleared this left the row disabled for good.
                        cancelVoucher.mutate(d.id, { onSettled: () => setCancellingId(null) });
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
            action={{ label: t("vouchers.newVoucher"), onClick: () => subPage.open("new") }}
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
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const { label: voucherLabel, subtitle: voucherSubtitle } = useDomainLabels();
  const effectText = useDocumentEffectText();
  const query = useVoucherDetail(id);
  const projectsQuery = useProjects();
  const reversal = useReverseDocumentAction(ReversalDocumentType.Voucher);
  const createAllocation = useCreateAllocation();
  const reverseAllocation = useReverseAllocation();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reversingAllocId, setReversingAllocId] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState("");
  const [allocAmount, setAllocAmount] = useState("");
  const [allocDate, setAllocDate] = useState("");
  const [allocatedOn, setAllocatedOn] = useState<string | null>(null);

  const doc = query.data;
  const def = doc ? getVoucherTypeDefinition(doc.voucherType) : null;
  const partyId = doc ? (doc.customerId ?? doc.supplierId) : null;
  const openInvoicesQuery = useOpenInvoices(def?.allocationKind ?? undefined, partyId);
  const openInvoices = openInvoicesQuery.data ?? EMPTY;
  const invoiceById = useMemo(() => new Map(openInvoices.map((i) => [i.id, i])), [openInvoices]);

  const chosenInvoice = invoiceById.get(invoiceId);
  const defaultAllocDate = doc && chosenInvoice ? (chosenInvoice.date.slice(0, 10) > doc.date.slice(0, 10) ? chosenInvoice.date.slice(0, 10) : doc.date.slice(0, 10)) : "";

  const effects = useMemo(() => {
    if (!doc) return null;
    const line = toVoucherLine(doc);
    const preview = toPreviewDoc(line, { id: doc.id, date: doc.date, memo: doc.memo, status: doc.status });
    return voucherDocumentType.describeEffects(preview);
  }, [doc]);

  async function handleAllocate() {
    if (busy || !doc || invoiceId === "" || allocAmount === "" || Money.fromMajor(allocAmount).scaled <= 0n) return;
    setBusy(true);
    setError(null);
    setAllocatedOn(null);
    try {
      const chosen = allocDate !== "" && allocDate !== defaultAllocDate ? { date: allocDate } : {};
      const made = await createAllocation.mutateAsync({ voucherId: doc.id, body: { invoiceId, amount: allocAmount, ...chosen } });
      setAllocatedOn(made.date ?? null);
      setInvoiceId("");
      setAllocAmount("");
      setAllocDate("");
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
  const project = doc.projectId ? (projectsQuery.data ?? []).find((p) => p.id === doc.projectId) : null;

  const summaryItems = [
    { label: t("common.type"), value: voucherLabel(def) },
    { label: t("common.date"), value: <span className="mz-num">{doc.date}</span> },
    { label: t("vouchers.paymentMethod"), value: getVoucherPaymentMethodLabel(doc.paymentMethod) },
    { label: t("vouchers.party"), value: partyName(partyId) },
    { label: t("common.amount"), value: <MoneyDisplay value={toMajor(doc.amount)} currencyLabel={doc.fxRate ? doc.currency : undefined} /> },
    ...(doc.projectId
      ? [
          {
            label: t("common.project"),
            value: project ? `${project.code} — ${nameOf(project)}` : doc.projectId,
          },
        ]
      : []),
    ...(doc.costCategory
      ? [{ label: t("common.costCategory"), value: t(`costCategory.${doc.costCategory}` as AppTranslationKey) }]
      : []),
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
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("vouchers.invoiceNumber")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("vouchers.alloc.amountApplied")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("vouchers.alloc.invoiceRelieved")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("vouchers.alloc.fxDifference")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.date")}</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px]" />
                </tr>
              </thead>
              <tbody>
                {activeAllocations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-[15px] py-[16px] text-center text-ink-muted">{t("vouchers.noAllocationsYet")}</td>
                  </tr>
                ) : (
                  activeAllocations.map((a) => {
                    const inv = invoiceById.get(a.invoiceId);
                    const base = Money.fromMajor(a.amount);
                    const applied = doc.fxRate ? convertFromBase(base, doc.fxRate) : base;
                    const relieved = a.carryingAmount ?? a.invoiceAmount ?? a.amount;
                    const difference = Money.fromMajor(a.fxDifference ?? "0").scaled;
                    const isGain = def.allocationKind === "purchase" ? difference < 0n : difference > 0n;
                    return (
                      <tr key={a.id} className="border-b border-border last:border-b-0">
                        <td className="mz-num px-[15px] py-[11px] text-ink">{a.invoiceNo ?? inv?.invoiceNo ?? a.invoiceId}</td>
                        <td className="px-[15px] py-[11px] text-end">
                          <MoneyDisplay value={toMajor(applied.toString())} currencyLabel={doc.fxRate ? doc.currency : undefined} />
                        </td>
                        <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={toMajor(relieved)} /></td>
                        <td className="px-[15px] py-[11px] text-end">
                          {difference === 0n ? (
                            <span className="text-ink-faint">—</span>
                          ) : (
                            <span className="inline-flex items-center gap-[8px]">
                              <StatusPill label={isGain ? t("vouchers.alloc.fxGain") : t("vouchers.alloc.fxLoss")} tone={isGain ? "success" : "danger"} />
                              <MoneyDisplay value={toMajor(Money.fromScaled(difference < 0n ? -difference : difference).toString())} />
                            </span>
                          )}
                        </td>
                        <td className="mz-num px-[15px] py-[11px] text-ink-muted">{a.date ?? a.createdAt.slice(0, 10)}</td>
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

        {allocatedOn ? (
          <div role="status" className="rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
            {t("vouchers.allocationDatedOn", { date: allocatedOn })}
          </div>
        ) : null}
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
                  <MoneyStringInput value={allocAmount} onChange={setAllocAmount} aria-label={t("vouchers.amountToAllocate")} />
                </div>
                <TextField label={t("vouchers.allocationDate")} hint={t("vouchers.allocationDateHint")} type="date" value={allocDate || defaultAllocDate} onChange={setAllocDate} disabled={invoiceId === ""} />
                <div className="flex justify-end">
                  <Button variant="primary" disabled={busy || invoiceId === "" || allocAmount === ""} onClick={handleAllocate}>
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
            {doc.status === "confirmed" && reversal.allowed ? (
              <Button variant="danger-outline" disabled={busy || reversal.pendingId === doc.id} onClick={() => void reversal.ask({ id: doc.id, params: { id: doc.id }, subject: doc.docNo ?? t("vouchers.cashVoucher") })}>
                {t("vouchers.reverseVoucher")}
              </Button>
            ) : null}
          </>
        }
        summary={summaryItems}
        effectsTitle={t("vouchers.whatThisVoucherDoes")}
        effects={(effects?.effects ?? []).map((e) => effectText(e).text)}
        tabs={tabs}
      />
      {reversal.dialog}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

/**
 * Egypt withholds tax on most local B2B payments (docs/archive/defect-register.md D27): the
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

const EMPTY_RATES: readonly TreasuryCurrencyRate[] = [];

interface CreateDraft {
  amount: string;
  currency: string;
  paymentMethod: VoucherPaymentMethod;
  treasuryAccountId: string;
  counterTreasuryAccountId: string;
  counterpartyGlAccountId: string;
  partyId: string;
  date: string;
  referenceNo: string;
  costCenterId: string;
  projectId: string;
  costCategory: CostCategoryDTO | "";
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
  initialVoucherType = null,
  onDone,
}: {
  customers: CustomerDTO[];
  suppliers: SupplierDTO[];
  treasuryAccounts: TreasuryAccountDTO[];
  accounts: AccountDTO[];
  initialCustomerId?: string | null;
  initialSupplierId?: string | null;
  /** Opens the form on this type instead of the grid. Overridden by a named party. */
  initialVoucherType?: VoucherType | null;
  onDone: () => void;
}) {
  const effectText = useDocumentEffectText();
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const { label: voucherLabel, subtitle: voucherSubtitle } = useDomainLabels();
  const createVoucher = useCreateVoucher();
  const confirmVoucher = useConfirmVoucher();
  const createCollection = useCreateCollection();
  const branchesQuery = useBranches();
  const exchangeRatesQuery = useExchangeRates();
  const costCentersQuery = useCostCenters();
  const projectsQuery = useProjects();

  // A collection is what «تحصيل» means; without a customer the user still picks the type.
  // «تحصيل» means a collection and «صرف دفعة» a supplier payment; without a
  // party the user still picks the type from the grid.
  const [type, setType] = useState<VoucherType | null>(
    initialCustomerId ? "customer_collection" : initialSupplierId ? "supplier_payment" : initialVoucherType,
  );
  const [draft, setDraft] = useState<CreateDraft>({
    amount: "",
    currency: "",
    paymentMethod: "cash",
    treasuryAccountId: treasuryAccounts[0]?.id ?? "",
    counterTreasuryAccountId: treasuryAccounts[1]?.id ?? "",
    counterpartyGlAccountId: "4900",
    partyId: initialCustomerId ?? initialSupplierId ?? "",
    date: todayIso(),
    referenceNo: "",
    costCenterId: "",
    projectId: "",
    costCategory: "",
    withholdingRatePercent: null,
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [heldVoucher, setHeldVoucher] = useState<{ docNo: string } | null>(null);

  const def = type ? getVoucherTypeDefinition(type) : null;

  const workingLocation = useWorkingLocation();
  const treasuryOptions = treasuryAccounts.map((account) => ({ value: account.id, label: `${nameOf(account)} (${account.code})` }));
  const partyOptions: EntityPickerOption[] = def?.requiresCustomer
    ? customers.map((c) => ({ id: c.id, label: nameOf(c) }))
    : def?.requiresSupplier
      ? suppliers.map((s) => ({ id: s.id, label: nameOf(s) }))
      : [];
  const costCenterOptions = [
    { value: "", label: t("vouchers.costCenterUnassigned") },
    ...(costCentersQuery.data ?? []).map((cc) => ({ value: cc.id, label: `${cc.code} — ${nameOf(cc)}` })),
  ];
  const projectOptions: EntityPickerOption[] = (projectsQuery.data ?? [])
    .filter((p) => OPEN_PROJECT_STATUSES.has(p.status))
    .map((p) => ({ id: p.id, label: `${p.code} — ${nameOf(p)}` }));
  const costCategoryOptions = [
    { value: "", label: t("common.none") },
    ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(`costCategory.${c}` as AppTranslationKey) })),
  ];
  const revenueOrExpenseOptions =
    type === "other_income"
      ? accounts.filter((a) => a.type === "revenue").map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }))
      : type === "other_expense"
        ? accounts.filter((a) => a.type === "expense").map((a) => ({ value: a.id, label: `${a.code} — ${nameOf(a)}` }))
        : [];

  const treasuryGlOf = useCallback(
    (id: string): string => treasuryAccounts.find((account) => account.id === id)?.glAccountId ?? "",
    [treasuryAccounts],
  );

  const counterpartyGl = useCallback((): string | null => {
    if (!type) return null;
    if (def!.direction === "transfer") return null;
    const fixed = FIXED_COUNTERPARTY[type];
    return fixed ?? draft.counterpartyGlAccountId;
  }, [type, def, draft.counterpartyGlAccountId]);

  const chosenTreasuryAccounts = useMemo(
    () =>
      [draft.treasuryAccountId, def?.direction === "transfer" ? draft.counterTreasuryAccountId : ""]
        .map((id) => treasuryAccounts.find((account) => account.id === id))
        .filter((account): account is TreasuryAccountDTO => account !== undefined),
    [draft.treasuryAccountId, draft.counterTreasuryAccountId, def?.direction, treasuryAccounts],
  );
  const accountCurrencies = new Set([...chosenTreasuryAccounts.map((account) => account.currency), BASE_CURRENCY]);
  const voucherCurrency = draft.currency !== "" && accountCurrencies.has(draft.currency) ? draft.currency : (chosenTreasuryAccounts[0]?.currency ?? BASE_CURRENCY);

  const buildLine = useCallback((): VoucherLine | null => {
    if (!type || !def) return null;
    const amount = draft.amount === "" ? Money.zero() : Money.fromMajor(draft.amount);
    return {
      voucherType: type,
      direction: def.direction,
      amount,
      currency: voucherCurrency,
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
      projectId: draft.projectId || null,
      costCategory: draft.projectId && draft.costCategory ? draft.costCategory : null,
      ...withholdingOf(amount, draft.withholdingRatePercent, def.direction),
    };
    // `workingLocation` and the branch list are real inputs: the line's branch
    // is resolved from them, and leaving them out let the effects preview keep
    // showing the branch that was current when the form opened.
  }, [type, def, draft, workingLocation.branchId, branchesQuery.data, treasuryGlOf, counterpartyGl, voucherCurrency]);

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
  }, [type, def, draft, buildLine, voucherLabel]);

  async function submitVoucher() {
    if (!type || !def || busy) return;
    const line = buildLine();
    if (!line) return;
    if (def.requiresProject && !line.projectId) {
      setError(t("vouchers.projectRequiredForAdvance"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (line.voucherType === "customer_collection" && line.customerId) {
        const collected = await createCollection.mutateAsync({
          date: draft.date,
          memo: draft.memo || voucherLabel(def),
          customerId: line.customerId,
          branchId: line.branchId,
          treasuryAccountId: line.treasuryAccountId,
          amount: line.amount.toString(),
          currency: line.currency,
          paymentMethod: line.paymentMethod,
          referenceNo: line.referenceNo,
          costCenterId: line.costCenterId ?? null,
          projectId: line.projectId ?? null,
          costCategory: line.costCategory ?? null,
          withholdingAmount: line.withholdingAmount ? line.withholdingAmount.toString() : null,
          withholdingRatePercent: line.withholdingRatePercent ?? null,
          withholdingGlAccountId: line.withholdingGlAccountId ?? null,
          allocations: [],
        });
        if (collected.held) {
          setHeldVoucher({ docNo: collected.voucher.docNo ?? "" });
          return;
        }
        onDone();
        return;
      }
      const created = await createVoucher.mutateAsync({
        date: draft.date,
        memo: draft.memo || voucherLabel(def),
        voucherType: line.voucherType,
        amount: line.amount.toString(),
        currency: line.currency,
        branchId: line.branchId,
        paymentMethod: line.paymentMethod,
        treasuryAccountId: line.treasuryAccountId,
        counterpartyGlAccountId: line.counterpartyGlAccountId,
        counterTreasuryAccountId: line.counterTreasuryAccountId,
        customerId: line.customerId,
        supplierId: line.supplierId,
        referenceNo: line.referenceNo,
        costCenterId: line.costCenterId ?? null,
        projectId: line.projectId ?? null,
        costCategory: line.costCategory ?? null,
        withholdingAmount: line.withholdingAmount ? line.withholdingAmount.toString() : null,
        withholdingRatePercent: line.withholdingRatePercent ?? null,
        withholdingGlAccountId: line.withholdingGlAccountId ?? null,
      });
      const confirmed = await confirmVoucher.mutateAsync({ id: created.id });
      // An approval gate holds the confirm: the voucher exists, nothing was
      // posted, and closing the wizard here reported plain success for money
      // that has not moved (D83).
      if (confirmed.held) {
        setHeldVoucher({ docNo: confirmed.docNo ?? created.docNo ?? "" });
        return;
      }
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

  if (heldVoucher) {
    return (
      <div className="w-full max-w-[560px]">
        <h1 className="mb-[16px] mt-[5px] font-display text-2xl font-bold text-ink">{t("vouchers.heldTitle")}</h1>
        <Card className="flex flex-col gap-[12px] p-[18px]">
          <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
            {t("vouchers.heldBody", { docNo: heldVoucher.docNo })}
          </div>
          <p className="text-[12.5px] text-ink-muted">{t("vouchers.heldNoMoneyMoved")}</p>
          <div className="flex items-center justify-end">
            <Button variant="primary" onClick={onDone}>
              {t("vouchers.heldBackToList")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const canSubmit =
    !busy &&
    draft.amount !== "" &&
    Money.fromMajor(draft.amount).scaled > 0n &&
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

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card className="flex flex-col gap-[14px] p-[18px]">
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("vouchers.amount")}</div>
            <MoneyStringInput value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} aria-label={t("common.amount")} />
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

          <TreasuryCurrencyNotice
            baseCurrency={BASE_CURRENCY}
            accounts={chosenTreasuryAccounts}
            voucherCurrency={voucherCurrency}
            onVoucherCurrencyChange={(currency) => setDraft((d) => ({ ...d, currency }))}
            amount={draft.amount}
            date={draft.date}
            rates={exchangeRatesQuery.data ?? EMPTY_RATES}
          />

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
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">
              {t("common.project")}
              {def.requiresProject ? " *" : ""}
            </div>
            <EntityPicker
              label={undefined}
              value={projectOptions.find((o) => o.id === draft.projectId) ?? null}
              onChange={(o) => setDraft((d) => ({ ...d, projectId: o?.id ?? "", costCategory: o ? d.costCategory : "" }))}
              options={projectOptions}
              placeholder={t("common.noProject")}
            />
          </div>
          <SelectField
            label={t("common.costCategory")}
            value={draft.costCategory}
            onChange={(v) => setDraft((d) => ({ ...d, costCategory: v as CostCategoryDTO | "" }))}
            options={costCategoryOptions}
            disabled={!draft.projectId}
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
                {effectText(e).text}
              </li>
            ))}
            {!previewEffects ? <li className="text-ink-muted">{t("vouchers.enterAnAmountToSee")}</li> : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

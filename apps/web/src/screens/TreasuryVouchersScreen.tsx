import { useMemo, useState } from "react";
import {
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
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
import type { AccountDTO, CustomerDTO, SupplierDTO, TreasuryAccountDTO, VoucherStatusDTO } from "@mezan/contracts";
import {
  useAccounts,
  useBranches,
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
  type VoucherDetailDTO,
  type VoucherRowDTO,
} from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";

/** السندات النقدية (Treasury Vouchers) — docs/catalog/04, on the real `/vouchers` API. */

const STATUS_LABEL: Record<VoucherStatusDTO, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  posted: "مرحل",
  confirmed: "مؤكد",
  reversed: "معكوس",
  cancelled: "ملغي",
};
const STATUS_TONE: Record<VoucherStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  posted: "success",
  confirmed: "success",
  reversed: "danger",
  cancelled: "neutral",
};

const STEPPER_STEPS: DocumentStatusStep[] = [
  { key: "draft", label: "مسودة" },
  { key: "pending", label: "بانتظار الموافقة" },
  { key: "confirmed", label: "مؤكد" },
  { key: "reversed", label: "معكوس" },
];

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

export function TreasuryVouchersScreen() {
  const query = useVouchers();
  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const treasuryQuery = useTreasuryAccounts();
  const accountsQuery = useAccounts();

  const [mode, setMode] = useState<"list" | "create" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "needs_allocation" | VoucherStatusDTO>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | VoucherType>("all");

  const documents = query.data ?? [];
  const customers = customersQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const accounts = accountsQuery.data ?? [];

  const partyName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.nameAr);
    for (const s of suppliers) map.set(s.id, s.nameAr);
    return (id: string | null) => (id ? (map.get(id) ?? id) : "بدون طرف محدد");
  }, [customers, suppliers]);

  const treasuryName = useMemo(() => {
    const map = new Map(treasuryAccounts.map((t) => [t.id, t.name]));
    return (id: string) => map.get(id) ?? id;
  }, [treasuryAccounts]);

  const counts = useMemo(() => {
    let confirmed = 0;
    let draft = 0;
    let needsAllocation = 0;
    for (const d of documents) {
      if (d.status === "confirmed") confirmed += 1;
      if (d.status === "draft") draft += 1;
      if (d.status === "confirmed" && d.allocatable && d.allocationSummary.needsAllocation) needsAllocation += 1;
    }
    return { all: documents.length, confirmed, draft, needsAllocation };
  }, [documents]);

  const typeBreakdown = useMemo(() => {
    const map = new Map<VoucherType, number>();
    for (const d of documents) map.set(d.voucherType, (map.get(d.voucherType) ?? 0) + 1);
    return [...map.entries()];
  }, [documents]);

  const filtered = useMemo(() => {
    let rows = documents;
    if (typeFilter !== "all") rows = rows.filter((d) => d.voucherType === typeFilter);
    if (statusFilter === "needs_allocation") {
      rows = rows.filter((d) => d.status === "confirmed" && d.allocatable && d.allocationSummary.needsAllocation);
    } else if (statusFilter !== "all") {
      rows = rows.filter((d) => d.status === statusFilter);
    }
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((d) => {
        return (
          (d.docNo ?? "").toLowerCase().includes(q) ||
          partyName(d.customerId ?? d.supplierId).toLowerCase().includes(q) ||
          (d.referenceNo ?? "").toLowerCase().includes(q)
        );
      });
    }
    return rows;
  }, [documents, typeFilter, statusFilter, search, partyName]);

  const columns: DocumentListColumn<VoucherRowDTO>[] = [
    {
      key: "docNo",
      header: "رقم السند",
      sortable: true,
      render: (d) => (
        <div>
          <div className="mz-num font-semibold text-ink">{d.docNo ?? "—"}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{d.date}</div>
        </div>
      ),
    },
    { key: "type", header: "نوع السند", render: (d) => getVoucherTypeDefinition(d.voucherType).labelAr },
    {
      key: "party",
      header: "الطرف",
      render: (d) => <span className="text-ink">{partyName(d.customerId ?? d.supplierId)}</span>,
    },
    {
      key: "treasury",
      header: "حساب الخزينة",
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
      header: "المبلغ",
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
    { key: "status", header: "الحالة", render: (d) => <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} /> },
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
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل السندات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<VoucherRowDTO>
        eyebrow="Treasury · Vouchers"
        title="السندات النقدية"
        description="سندات القبض والصرف والتحويل — مستند موحّد بـ11 نوعاً على إطار المستندات، مع تخصيص على الفواتير"
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            سند جديد
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{counts.all}</span> },
          { label: "مؤكد", value: <span className="mz-num">{counts.confirmed}</span> },
          { label: "بحاجة لتخصيص", value: <span className="mz-num">{counts.needsAllocation}</span> },
          { label: "مسودة", value: <span className="mz-num">{counts.draft}</span> },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: counts.all },
          { key: "needs_allocation", label: "بحاجة لتخصيص", count: counts.needsAllocation },
          { key: "confirmed", label: "مؤكد", count: counts.confirmed },
          { key: "draft", label: "مسودة", count: counts.draft },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as typeof statusFilter)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم السند، المرجع، العميل، المورد…"
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
              كل الأنواع
            </Chip>
            {typeBreakdown.map(([type, n]) => (
              <Chip key={type} active={typeFilter === type} onClick={() => setTypeFilter(type)}>
                {getVoucherTypeDefinition(type).labelAr} ({n})
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> سند
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد سندات مطابقة</div>}
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
      setError(err instanceof Error ? err.message : "تعذر عكس السند.");
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
      setError(err instanceof Error ? err.message : "تعذر تخصيص المبلغ.");
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
      setError(err instanceof Error ? err.message : "تعذر عكس التخصيص.");
    } finally {
      setReversingAllocId(null);
    }
  }

  if (!doc || !def) {
    return (
      <div className="w-full">
        <Button onClick={onBack}>رجوع</Button>
        {query.isError ? (
          <Card className="mt-[16px] p-[18px_20px]">
            <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل السند.</p>
          </Card>
        ) : null}
      </div>
    );
  }

  const summary = doc.allocationSummary;
  const activeAllocations = doc.allocations.filter((a) => a.status === "active");

  const summaryItems = [
    { label: "النوع", value: def.labelAr },
    { label: "التاريخ", value: <span className="mz-num">{doc.date}</span> },
    { label: "طريقة الدفع", value: getVoucherPaymentMethodLabel(doc.paymentMethod) },
    { label: "الطرف", value: partyName(partyId) },
    { label: "المبلغ", value: <MoneyDisplay value={toMajor(doc.amount)} /> },
    ...(def.allocatable
      ? [
          {
            label: "التخصيص",
            value: summary.fullyAllocated ? "مخصّص بالكامل" : `مخصّص ${summary.allocated}`,
            valueTone: summary.needsAllocation ? ("danger" as const) : ("success" as const),
          },
        ]
      : []),
  ];

  const allocationTab = {
    key: "allocation",
    label: `تخصيص على الفواتير (${activeAllocations.length})`,
    content: (
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <StatusPill
            label={summary.needsAllocation ? "بحاجة لتخصيص" : "مخصّص بالكامل"}
            tone={summary.needsAllocation ? "warning" : "success"}
          />
          <span className="text-[12.5px] text-ink-muted">
            المتبقي غير المخصص: <MoneyDisplay value={toMajor(summary.unallocated)} />
          </span>
        </div>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">رقم الفاتورة</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">المبلغ</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">التاريخ</th>
                  <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px]" />
                </tr>
              </thead>
              <tbody>
                {activeAllocations.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-[15px] py-[16px] text-center text-ink-muted">لا توجد تخصيصات بعد</td>
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
                            {reversingAllocId === a.id ? "…" : "عكس التخصيص"}
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
            <h3 className="font-display text-[13.5px] font-bold text-ink">تخصيص مبلغ على فاتورة</h3>
            {openInvoices.length === 0 ? (
              <div className="text-[12.5px] text-ink-muted">لا توجد فواتير مفتوحة لهذا الطرف.</div>
            ) : (
              <>
                <SelectField
                  label="الفاتورة"
                  value={invoiceId}
                  onChange={setInvoiceId}
                  options={[
                    { value: "", label: "اختر فاتورة…" },
                    ...openInvoices.map((i) => ({
                      value: i.id,
                      label: `${i.invoiceNo} — متبقٍ ${i.outstanding}`,
                    })),
                  ]}
                />
                <div>
                  <div className="mb-[6px] text-[12.5px] font-semibold text-ink">المبلغ</div>
                  <MoneyInput value={allocAmount} onChange={setAllocAmount} aria-label="مبلغ التخصيص" />
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" disabled={busy || invoiceId === "" || !allocAmount} onClick={handleAllocate}>
                    تخصيص
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
      label: "القيود المحاسبية",
      content: (
        <Card className="p-[16px_18px] text-[12.5px] text-ink-muted">
          {doc.journalEntryId ? (
            <span>
              رُحّل هذا السند إلى قيد محاسبي متوازن — المعرّف: <span className="mz-num text-ink">{doc.docNo}</span>
            </span>
          ) : (
            <span>لم يُرحّل هذا السند بعد.</span>
          )}
        </Card>
      ),
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
        title={doc.docNo ?? "سند نقدي"}
        statusLabel={STATUS_LABEL[doc.status]}
        statusTone={STATUS_TONE[doc.status]}
        subtitle={<DocumentStatusStepper steps={STEPPER_STEPS} currentKey={doc.status} tone={doc.status === "reversed" ? "danger" : "brand"} />}
        actions={
          <>
            <Button onClick={onBack}>رجوع</Button>
            {doc.status === "confirmed" ? (
              <Button variant="danger-outline" disabled={busy} onClick={handleReverseVoucher}>
                عكس السند
              </Button>
            ) : null}
          </>
        }
        summary={summaryItems}
        effectsTitle="تأثيرات هذا السند"
        effects={(effects?.effects ?? []).map((e) => e.description)}
        tabs={tabs}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

interface CreateDraft {
  amount: number | null;
  paymentMethod: VoucherPaymentMethod;
  treasuryAccountId: string;
  counterTreasuryAccountId: string;
  counterpartyGlAccountId: string;
  partyId: string;
  date: string;
  referenceNo: string;
  memo: string;
}

function CreateVoucherView({
  customers,
  suppliers,
  treasuryAccounts,
  accounts,
  onDone,
}: {
  customers: CustomerDTO[];
  suppliers: SupplierDTO[];
  treasuryAccounts: TreasuryAccountDTO[];
  accounts: AccountDTO[];
  onDone: () => void;
}) {
  const createVoucher = useCreateVoucher();
  const confirmVoucher = useConfirmVoucher();
  const branchesQuery = useBranches();

  const [type, setType] = useState<VoucherType | null>(null);
  const [draft, setDraft] = useState<CreateDraft>({
    amount: null,
    paymentMethod: "cash",
    treasuryAccountId: treasuryAccounts[0]?.id ?? "",
    counterTreasuryAccountId: treasuryAccounts[1]?.id ?? "",
    counterpartyGlAccountId: "4900",
    partyId: "",
    date: new Date().toISOString().slice(0, 10),
    referenceNo: "",
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const def = type ? getVoucherTypeDefinition(type) : null;

  const treasuryOptions = treasuryAccounts.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }));
  const partyOptions: EntityPickerOption[] = def?.requiresCustomer
    ? customers.map((c) => ({ id: c.id, label: c.nameAr }))
    : def?.requiresSupplier
      ? suppliers.map((s) => ({ id: s.id, label: s.nameAr }))
      : [];
  const revenueOrExpenseOptions =
    type === "other_income"
      ? accounts.filter((a) => a.type === "revenue").map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` }))
      : type === "other_expense"
        ? accounts.filter((a) => a.type === "expense").map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` }))
        : [];

  function treasuryGlOf(id: string): string {
    return treasuryAccounts.find((t) => t.id === id)?.glAccountId ?? "";
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
      branchId: branchesQuery.data?.[0]?.id ?? "MAIN",
      paymentMethod: draft.paymentMethod,
      treasuryAccountId: draft.treasuryAccountId,
      treasuryGlAccountId: treasuryGlOf(draft.treasuryAccountId),
      counterpartyGlAccountId: counterpartyGl(),
      counterTreasuryAccountId: def.direction === "transfer" ? draft.counterTreasuryAccountId : null,
      counterTreasuryGlAccountId: def.direction === "transfer" ? treasuryGlOf(draft.counterTreasuryAccountId) : null,
      customerId: def.requiresCustomer ? draft.partyId || null : null,
      supplierId: def.requiresSupplier ? draft.partyId || null : null,
      referenceNo: draft.referenceNo || null,
    };
  }

  // A preview document for the live effects panel — a pure client-side computation, no network call.
  const previewEffects = useMemo(() => {
    if (!type || !def) return null;
    const line = buildLine();
    if (!line || line.amount.scaled <= 0n) return null;
    const preview = toPreviewDoc(line, { id: "preview", date: draft.date, memo: draft.memo || def.labelAr, status: "draft" });
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
        memo: draft.memo || def.labelAr,
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
      });
      await confirmVoucher.mutateAsync({ id: created.id });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إنشاء السند.");
    } finally {
      setBusy(false);
    }
  }

  if (!type || !def) {
    return (
      <div className="w-full">
        <div className="mb-[22px] flex items-end justify-between gap-[18px]">
          <div>
            <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Treasury · New Voucher</div>
            <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">اختر نوع السند</h1>
          </div>
          <Button onClick={onDone}>إلغاء</Button>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
          {VOUCHER_TYPE_DEFINITIONS.map((d) => (
            <button
              key={d.code}
              type="button"
              onClick={() => setType(d.code)}
              className="rounded-lg border border-border bg-surface p-[16px] text-start shadow-1 transition-colors hover:border-brand"
            >
              <div className="font-display text-[14px] font-bold text-ink">{d.labelAr}</div>
              <div className="mt-[6px] text-[12px] text-ink-muted">{d.subtitleAr}</div>
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
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Treasury · New Voucher</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{def.labelAr}</h1>
          <button type="button" onClick={() => setType(null)} className="mt-[6px] text-[12px] text-brand underline">
            تغيير نوع السند
          </button>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>إلغاء</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submitVoucher}>
            إنشاء وتأكيد
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
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">المبلغ *</div>
            <MoneyInput value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} aria-label="المبلغ" />
          </div>

          <SelectField
            label="طريقة الدفع *"
            value={draft.paymentMethod}
            onChange={(v) => setDraft((d) => ({ ...d, paymentMethod: v as VoucherPaymentMethod }))}
            options={VOUCHER_PAYMENT_METHODS.map((m) => ({ value: m.code, label: m.labelAr }))}
          />

          <SelectField
            label={def.direction === "transfer" ? "من الخزينة *" : "حساب الخزينة *"}
            value={draft.treasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, treasuryAccountId: v }))}
            options={treasuryOptions}
          />

          {def.direction === "transfer" ? (
            <SelectField
              label="إلى الخزينة *"
              value={draft.counterTreasuryAccountId}
              onChange={(v) => setDraft((d) => ({ ...d, counterTreasuryAccountId: v }))}
              options={treasuryOptions}
            />
          ) : null}

          {def.requiresCustomer || def.requiresSupplier ? (
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{def.requiresCustomer ? "العميل *" : "المورّد *"}</div>
              <EntityPicker
                label={undefined}
                value={partyOptions.find((o) => o.id === draft.partyId) ?? null}
                onChange={(o) => setDraft((d) => ({ ...d, partyId: o?.id ?? "" }))}
                options={partyOptions}
                placeholder={def.requiresCustomer ? "ابحث عن عميل…" : "ابحث عن مورّد…"}
              />
            </div>
          ) : null}

          {type === "other_income" || type === "other_expense" ? (
            <SelectField
              label="الحساب المقابل *"
              value={draft.counterpartyGlAccountId}
              onChange={(v) => setDraft((d) => ({ ...d, counterpartyGlAccountId: v }))}
              options={revenueOrExpenseOptions}
            />
          ) : null}

          <TextField label="التاريخ *" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />
          <TextField label="رقم المرجع" value={draft.referenceNo} onChange={(v) => setDraft((d) => ({ ...d, referenceNo: v }))} />
          <TextField label="ملاحظات" value={draft.memo} onChange={(v) => setDraft((d) => ({ ...d, memo: v }))} placeholder={def.labelAr} />
        </Card>

        <div
          className="h-fit rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
          style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
        >
          <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">تأثيرات هذا السند</h3>
          <p className="mb-[10px] text-[12px] text-ink-muted">{def.subtitleAr}</p>
          <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
            {(previewEffects?.effects ?? []).map((e, i) => (
              <li key={i} className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {e.description}
              </li>
            ))}
            {!previewEffects ? <li className="text-ink-muted">أدخل مبلغاً لعرض التأثيرات.</li> : null}
          </ul>
        </div>
      </div>
    </div>
  );
}

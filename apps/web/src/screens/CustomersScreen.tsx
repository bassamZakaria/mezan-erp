import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import { ETA_BUYER_TYPES, SALES_INVOICE_ACTIVE_STATUSES, SALES_INVOICE_STATUS_LABELS_AR } from "@mezan/domain";
import type { CustomerDTO, EtaBuyerTypeDTO, SalesInvoiceStatusDTO } from "@mezan/contracts";
import {
  useCreateCustomer,
  useCustomers,
  useSalesInvoices,
  useSalesReturns,
  useUpdateCustomer,
  useVouchers,
} from "../data/hooks";
import {
  MONEY_RECONCILIATION_TOLERANCE,
  agingBucketsFor,
  moneyFromNumber,
  moneyToNumber,
  multiplyMoney,
  parseMoney,
  sumActiveAllocations,
  sumMoney,
  useCustomerAging,
  useVoucherAllocations,
} from "../data/partner-detail-hooks";
import { TextField, NumberField, SelectField, ToggleField } from "../settings/form-controls";

/**
 * العملاء (Customers) — docs/catalog/01-sales.md "العملاء (Customers —
 * Customer master)". List + detail (DocumentList/DocumentDetail) + add/edit
 * form (SidePanel), backed by the real `/customers` API.
 *
 * الفواتير reads `GET /sales-invoices?customerId=…`. كشف حساب builds a running
 * AR balance from every movement this build records against the customer —
 * opening balance, live sales invoices, confirmed sales returns, and confirmed
 * treasury vouchers split over the invoices they were allocated onto — and
 * reconciles the closing figure against `GET /reports/aging/customers`.
 *
 * There is NO attachments tab: this build has no file-storage subsystem of any
 * kind (no upload route, no blob store, no attachment table), so an attachments
 * tab would be a navigational dead end rather than an empty collection.
 */

const ETA_BUYER_TYPE_LABEL: Record<EtaBuyerTypeDTO, string> = {
  auto: "تلقائي (منشأة إذا وُجد رقم ضريبي، وإلا فرد)",
  business: "منشأة",
  individual: "فرد",
};

const INVOICE_STATUS_TONE: Record<SalesInvoiceStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  partially_paid: "warning",
  paid: "success",
  cancelled: "danger",
  reversed: "danger",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function isoToDisplay(date: string): string {
  return date.split("-").reverse().join("/");
}

function TabMessage({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[22px_24px]">
      <p className="text-[13.5px] font-semibold text-ink">{title}</p>
      <div className="mt-[8px] max-w-[70ch] text-[12.5px] leading-[1.9] text-ink-muted">{body}</div>
    </div>
  );
}

function TabError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-[18px_20px]">
      <p className="text-[13px] font-semibold text-danger-ink">{message}</p>
      <Button size="sm" className="mt-[10px]" onClick={onRetry}>
        إعادة المحاولة
      </Button>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-[13px_15px]">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[5px] text-[14.5px] font-bold text-ink">{value}</div>
    </div>
  );
}

/** فواتير العميل — `GET /sales-invoices?customerId=…`, the customer's own invoice ledger. */
function CustomerInvoicesTab({ customerId }: { customerId: string }) {
  const query = useSalesInvoices({ customerId });
  const invoices = useMemo(
    () => [...(query.data ?? [])].sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date))),
    [query.data],
  );

  if (query.isError) return <TabError message="تعذّر تحميل فواتير العميل." onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل الفواتير…</p>;
  if (invoices.length === 0) {
    return (
      <TabMessage
        title="لا توجد فواتير مبيعات مسجّلة لهذا العميل"
        body="أول فاتورة تُصدر لهذا العميل من شاشة «فواتير المبيعات» ستظهر هنا فور حفظها."
      />
    );
  }

  const live = invoices.filter((inv) => SALES_INVOICE_ACTIVE_STATUSES.has(inv.status));
  const invoiced = sumMoney(live.map((inv) => inv.totals.grandTotal));
  const collected = sumMoney(live.map((inv) => inv.amountPaid));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label="عدد الفواتير" value={<span className="mz-num">{invoices.length}</span>} />
        <MiniStat label="فواتير سارية" value={<span className="mz-num">{live.length}</span>} />
        <MiniStat label="إجمالي الفواتير السارية" value={<MoneyValue value={moneyToNumber(invoiced)} showUnit={false} />} />
        <MiniStat label="المحصّل" value={<MoneyValue value={moneyToNumber(collected)} showUnit={false} />} />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">رقم الفاتورة</th>
              <th className="p-[10px] text-start font-semibold">التاريخ</th>
              <th className="p-[10px] text-start font-semibold">الاستحقاق</th>
              <th className="p-[10px] text-start font-semibold">الحالة</th>
              <th className="p-[10px] text-end font-semibold">الإجمالي</th>
              <th className="p-[10px] text-end font-semibold">المحصّل</th>
              <th className="p-[10px] text-end font-semibold">المتبقي</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] font-semibold text-ink">{inv.docNo ?? "—"}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(inv.date)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(inv.dueDate)}</td>
                <td className="p-[10px]">
                  <StatusPill label={SALES_INVOICE_STATUS_LABELS_AR[inv.status]} tone={INVOICE_STATUS_TONE[inv.status]} />
                </td>
                <td className="p-[10px] text-end text-ink">
                  <MoneyValue value={num(inv.totals.grandTotal)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={num(inv.amountPaid)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end font-semibold text-ink">
                  <MoneyValue value={num(inv.remainingBalance)} showUnit={false} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface StatementRow {
  readonly key: string;
  readonly date: string | null;
  readonly label: string;
  readonly note: string | null;
  readonly reference: string;
  readonly debit: bigint;
  readonly credit: bigint;
}

/**
 * كشف حساب العميل — a dated AR movement ledger over every document this build
 * records against the customer.
 *
 * Collections are taken from the voucher allocation sub-ledger first: a
 * confirmed sales invoice is written into it on confirmation, so an allocation
 * (`GET /vouchers/:id/allocations`) carries both the invoice it settles and —
 * through its voucher — a date and a GL posting. The cumulative `amountPaid`
 * counter that `POST /sales-invoices/:id/payments` bumps carries no date and is
 * used only for invoices the sub-ledger has no allocation for, labelled as such
 * on the invoice's own row.
 */
function CustomerStatementTab({ customer }: { customer: CustomerDTO }) {
  const invoicesQuery = useSalesInvoices({ customerId: customer.id });
  const returnsQuery = useSalesReturns();
  const vouchersQuery = useVouchers();
  const agingQuery = useCustomerAging();

  const customerVouchers = useMemo(
    () =>
      (vouchersQuery.data ?? []).filter(
        (voucher) => voucher.customerId === customer.id && (voucher.status === "confirmed" || voucher.status === "posted"),
      ),
    [vouchersQuery.data, customer.id],
  );
  const allocationsQuery = useVoucherAllocations(customerVouchers.map((voucher) => voucher.id));

  const rows = useMemo<StatementRow[]>(() => {
    const allocations = allocationsQuery.data ?? [];
    const activeAllocations = allocations.filter((alloc) => alloc.status === "active");
    const allocatedInvoiceIds = new Set(activeAllocations.map((alloc) => alloc.invoiceId));
    const invoiceLabels = new Map((invoicesQuery.data ?? []).map((inv) => [inv.id, inv.docNo ?? inv.id]));

    const opening = parseMoney(customer.openingBalance);
    const built: StatementRow[] = [
      {
        key: "opening",
        date: null,
        label: "رصيد افتتاحي",
        note: null,
        reference: "سجل العميل",
        debit: opening > 0n ? opening : 0n,
        credit: opening < 0n ? -opening : 0n,
      },
    ];

    for (const inv of invoicesQuery.data ?? []) {
      if (!SALES_INVOICE_ACTIVE_STATUSES.has(inv.status)) continue;
      const counterPaid = parseMoney(inv.amountPaid);
      const hasAllocations = allocatedInvoiceIds.has(inv.id);
      built.push({
        key: `inv-${inv.id}`,
        date: inv.date,
        label: "فاتورة مبيعات",
        note:
          counterPaid === 0n
            ? null
            : hasAllocations
              ? "المحصّل على الفاتورة مُدرج من سندات القبض المخصصة عليها"
              : "تحصيل مسجّل على الفاتورة نفسها — مبلغ تراكمي بلا تاريخ",
        reference: inv.docNo ?? inv.id,
        debit: parseMoney(inv.totals.grandTotal),
        credit: hasAllocations ? 0n : counterPaid,
      });
    }

    for (const doc of returnsQuery.data ?? []) {
      if (doc.status !== "confirmed") continue;
      const mine = doc.lines.filter((line) => line.customerId === customer.id);
      if (mine.length === 0) continue;
      const amount = mine.reduce<bigint>(
        (total, line) => total + multiplyMoney(line.qty, line.unitPrice) + parseMoney(line.taxAmount),
        0n,
      );
      built.push({
        key: `ret-${doc.id}`,
        date: doc.date,
        label: "مرتجع مبيعات",
        note: null,
        reference: doc.docNo ?? doc.id,
        debit: 0n,
        credit: amount,
      });
    }

    for (const voucher of customerVouchers) {
      if (voucher.direction === "transfer") continue;
      const isReceipt = voucher.direction === "receipt";
      const label = isReceipt ? "سند قبض" : "سند صرف";
      const voucherRef = voucher.docNo ?? voucher.id;
      const mine = activeAllocations.filter((alloc) => alloc.voucherId === voucher.id);
      for (const alloc of mine) {
        const amount = parseMoney(alloc.amount);
        built.push({
          key: `alloc-${alloc.id}`,
          date: voucher.date,
          label,
          note: `مخصص على الفاتورة ${invoiceLabels.get(alloc.invoiceId) ?? alloc.invoiceId}`,
          reference: voucherRef,
          debit: isReceipt ? 0n : amount,
          credit: isReceipt ? amount : 0n,
        });
      }
      const remainder = parseMoney(voucher.amount) - sumActiveAllocations(mine);
      if (remainder !== 0n) {
        const amount = remainder < 0n ? -remainder : remainder;
        const towardsCredit = remainder > 0n ? isReceipt : !isReceipt;
        built.push({
          key: `vch-${voucher.id}`,
          date: voucher.date,
          label,
          note: "غير مخصص على فاتورة — تحت حساب العميل",
          reference: voucherRef,
          debit: towardsCredit ? 0n : amount,
          credit: towardsCredit ? amount : 0n,
        });
      }
    }

    return built.sort((a, b) => {
      if (a.date === null) return -1;
      if (b.date === null) return 1;
      return a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date);
    });
  }, [customer.openingBalance, invoicesQuery.data, returnsQuery.data, customerVouchers, allocationsQuery.data]);

  const isError = invoicesQuery.isError || returnsQuery.isError || vouchersQuery.isError || allocationsQuery.isError;
  const isLoading = invoicesQuery.isLoading || returnsQuery.isLoading || vouchersQuery.isLoading || allocationsQuery.isLoading;

  if (isError) {
    return (
      <TabError
        message="تعذّر تحميل حركة حساب العميل."
        onRetry={() => {
          invoicesQuery.refetch();
          returnsQuery.refetch();
          vouchersQuery.refetch();
          allocationsQuery.refetch();
        }}
      />
    );
  }
  if (isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل كشف الحساب…</p>;

  const closing = rows.reduce<bigint>((total, row) => total + row.debit - row.credit, 0n);
  const totalDebit = rows.reduce<bigint>((total, row) => total + row.debit, 0n);
  const totalCredit = rows.reduce<bigint>((total, row) => total + row.credit, 0n);
  const agingRow = agingQuery.data?.rows.find((r) => r.customerId === customer.id);
  const agingTotal = moneyFromNumber(agingBucketsFor(agingRow).total);
  const agingKnown = agingQuery.isSuccess;
  const matchesAging = (closing > agingTotal ? closing - agingTotal : agingTotal - closing) <= MONEY_RECONCILIATION_TOLERANCE;

  let running = 0n;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label="رصيد افتتاحي" value={<MoneyValue value={num(customer.openingBalance)} showUnit={false} />} />
        <MiniStat label="إجمالي المدين" value={<MoneyValue value={moneyToNumber(totalDebit)} showUnit={false} />} />
        <MiniStat label="إجمالي الدائن" value={<MoneyValue value={moneyToNumber(totalCredit)} showUnit={false} />} />
        <MiniStat label="الرصيد الختامي" value={<MoneyValue value={moneyToNumber(closing)} showUnit={false} />} />
      </div>

      {agingKnown ? (
        <div className="flex flex-wrap items-center gap-[10px] rounded-lg border border-border bg-surface p-[12px_15px]">
          <StatusPill label={matchesAging ? "مطابق لتقرير أعمار الديون" : "يختلف عن تقرير أعمار الديون"} tone={matchesAging ? "success" : "warning"} />
          <span className="text-[12px] text-ink-muted">
            رصيد التقرير <MoneyValue value={moneyToNumber(agingTotal)} showUnit={false} className="text-ink" />
            {matchesAging
              ? " — محسوب من أرصدة الفواتير السارية."
              : " — التقرير يحتسب أرصدة الفواتير السارية من عدّاد «المحصّل» على الفاتورة فقط: لا يخصم تخصيصات سندات القبض، ولا يشمل الرصيد الافتتاحي ولا مرتجعات المبيعات."}
          </span>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">التاريخ</th>
              <th className="p-[10px] text-start font-semibold">الحركة</th>
              <th className="p-[10px] text-start font-semibold">المرجع</th>
              <th className="p-[10px] text-end font-semibold">مدين</th>
              <th className="p-[10px] text-end font-semibold">دائن</th>
              <th className="p-[10px] text-end font-semibold">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              running += row.debit - row.credit;
              return (
                <tr key={row.key} className="border-b border-border last:border-b-0">
                  <td className="mz-num p-[10px] text-ink-muted">{row.date === null ? "—" : isoToDisplay(row.date)}</td>
                  <td className="p-[10px] text-ink">
                    {row.label}
                    {row.note ? <div className="mt-[3px] text-[11px] text-ink-faint">{row.note}</div> : null}
                  </td>
                  <td className="mz-num p-[10px] text-ink-muted">{row.reference}</td>
                  <td className="p-[10px] text-end text-ink">
                    {row.debit === 0n ? "—" : <MoneyValue value={moneyToNumber(row.debit)} showUnit={false} />}
                  </td>
                  <td className="p-[10px] text-end text-ink">
                    {row.credit === 0n ? "—" : <MoneyValue value={moneyToNumber(row.credit)} showUnit={false} />}
                  </td>
                  <td className="p-[10px] text-end font-semibold text-ink">
                    <MoneyValue value={moneyToNumber(running)} showUnit={false} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="max-w-[80ch] text-[11.5px] leading-[1.9] text-ink-faint">
        التحصيل يُقرأ أولاً من دفتر تخصيص السندات: كل تخصيص يظهر بتاريخ سنده وبرقم الفاتورة المخصص عليها، وما لم يُخصَّص من السند يظهر
        كدفعة تحت حساب العميل بتاريخ السند نفسه. أما التحصيل المُسجَّل مباشرة على الفاتورة عبر عدّاد «المحصّل» فهو مبلغ تراكمي بلا تاريخ،
        ولا يُستخدم إلا للفواتير التي لا تخصيص عليها — ويظهر عندئذٍ في خانة «دائن» الخاصة بفاتورته مع بيان ذلك. القيود اليومية المُرحَّلة
        مباشرة على حساب الذمم المدينة (1105) لا ترتبط بعميل بعينه ولا تظهر في هذا الكشف.
      </p>
    </div>
  );
}

interface CustomerDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  phone: string;
  email: string;
  contactPerson: string;
  taxNumber: string;
  category: string;
  notes: string;
  paymentTermsDays: number;
  currency: string;
  creditLimit: number;
  priceListId: string;
  taxExempt: boolean;
  etaBuyerType: EtaBuyerTypeDTO;
  nationalId: string;
  active: boolean;
}

const BLANK_DRAFT: CustomerDraft = {
  code: "",
  nameAr: "",
  nameEn: "",
  phone: "",
  email: "",
  contactPerson: "",
  taxNumber: "",
  category: "",
  notes: "",
  paymentTermsDays: 30,
  currency: "EGP",
  creditLimit: 0,
  priceListId: "",
  taxExempt: false,
  etaBuyerType: "auto",
  nationalId: "",
  active: true,
};

function draftFromCustomer(customer: CustomerDTO): CustomerDraft {
  return {
    code: customer.code,
    nameAr: customer.nameAr,
    nameEn: customer.nameEn ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    contactPerson: customer.contactPerson ?? "",
    taxNumber: customer.taxNumber ?? "",
    category: customer.category ?? "",
    notes: customer.notes ?? "",
    paymentTermsDays: customer.paymentTermsDays,
    currency: customer.currency,
    creditLimit: num(customer.creditLimit),
    priceListId: customer.priceListId ?? "",
    taxExempt: customer.taxExempt,
    etaBuyerType: customer.etaBuyerType,
    nationalId: customer.nationalId ?? "",
    active: customer.active,
  };
}

function CustomerDetail({ customer, onBack, onEdit }: { customer: CustomerDTO; onBack: () => void; onEdit: () => void }) {
  const remainingCredit = num(customer.creditLimit) - num(customer.openingBalance);
  return (
    <DocumentDetail
      title={`${customer.nameAr} · ${customer.code}`}
      statusLabel={customer.active ? "نشط" : "غير نشط"}
      statusTone={customer.active ? "success" : "neutral"}
      subtitle={customer.nameEn ?? undefined}
      actions={
        <>
          <Button variant="primary" onClick={onEdit}>
            تعديل
          </Button>
          <Button onClick={onBack}>رجوع لقائمة العملاء</Button>
        </>
      }
      summary={[
        { label: "التصنيف", value: customer.category ?? "بدون تصنيف" },
        { label: "شروط الدفع", value: <span className="mz-num">{customer.paymentTermsDays} يوم</span> },
        { label: "الحد الائتماني", value: <MoneyValue value={num(customer.creditLimit)} /> },
        { label: "الرصيد الافتتاحي", value: <MoneyValue value={num(customer.openingBalance)} /> },
        {
          label: "متبقي من الحد",
          value: <MoneyValue value={remainingCredit} />,
          valueTone: remainingCredit < 0 ? "danger" : "default",
        },
        { label: "نوع المشتري (ETA)", value: ETA_BUYER_TYPE_LABEL[customer.etaBuyerType] },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              {[
                { label: "الهاتف", value: customer.phone ?? "لا يوجد" },
                { label: "البريد الإلكتروني", value: customer.email ?? "لا يوجد" },
                { label: "جهة الاتصال", value: customer.contactPerson ?? "لا يوجد" },
                { label: "الرقم الضريبي", value: customer.taxNumber ?? "لا يوجد" },
                { label: "الرقم القومي", value: customer.nationalId ?? "لا يوجد" },
                { label: "العملة", value: customer.currency },
                { label: "إعفاء ضريبي", value: customer.taxExempt ? "نعم" : "لا" },
                { label: "قائمة الأسعار", value: customer.priceListId ?? "بدون قائمة أسعار" },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{row.label}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{row.value}</div>
                </div>
              ))}
              {customer.notes ? (
                <div className="col-span-full rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{customer.notes}</div>
                </div>
              ) : null}
            </div>
          ),
        },
        { key: "invoices", label: "الفواتير", content: <CustomerInvoicesTab customerId={customer.id} /> },
        { key: "statement", label: "كشف حساب", content: <CustomerStatementTab customer={customer} /> },
      ]}
    />
  );
}

export function CustomersScreen() {
  const query = useCustomers();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const customers = query.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomerDraft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const selected = customers.find((c) => c.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = customers;
    if (statusFilter !== "all") rows = rows.filter((c) => (statusFilter === "active" ? c.active : !c.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (c) => c.nameAr.includes(search.trim()) || c.code.toLowerCase().includes(q) || (c.phone ?? "").includes(search.trim()),
      );
    }
    return rows;
  }, [customers, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: customers.length },
    { key: "active", label: "نشط", count: customers.filter((c) => c.active).length },
    { key: "inactive", label: "غير نشط", count: customers.filter((c) => !c.active).length },
  ];

  const columns: DocumentListColumn<CustomerDTO>[] = [
    {
      key: "name",
      header: "اسم العميل",
      render: (c) => (
        <div>
          <div className="font-semibold text-ink">{c.nameAr}</div>
          <div className="mz-num text-[11.5px] text-ink-faint">{c.code}</div>
        </div>
      ),
    },
    { key: "phone", header: "الهاتف", render: (c) => c.phone ?? "—" },
    { key: "terms", header: "شروط الدفع", render: (c) => <span className="mz-num">{c.paymentTermsDays} يوم</span> },
    { key: "category", header: "التصنيف", render: (c) => c.category ?? "بدون تصنيف" },
    { key: "creditLimit", header: "الحد الائتماني", align: "end", render: (c) => <MoneyValue value={num(c.creditLimit)} /> },
    { key: "openingBalance", header: "الرصيد الافتتاحي", align: "end", render: (c) => <MoneyValue value={num(c.openingBalance)} /> },
    {
      key: "status",
      header: "الحالة",
      render: (c) => <StatusPill label={c.active ? "نشط" : "غير نشط"} tone={(c.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setError(null);
    setPanelOpen(true);
  }

  function openEditForm(customer: CustomerDTO) {
    setEditingId(customer.id);
    setDraft(draftFromCustomer(customer));
    setError(null);
    setPanelOpen(true);
  }

  async function submit() {
    setError(null);
    if (draft.nameAr.trim() === "") {
      setError("الاسم بالعربية مطلوب");
      return;
    }
    const fields = {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      phone: draft.phone.trim() === "" ? null : draft.phone.trim(),
      email: draft.email.trim() === "" ? null : draft.email.trim(),
      contactPerson: draft.contactPerson.trim() === "" ? null : draft.contactPerson.trim(),
      taxNumber: draft.taxNumber.trim() === "" ? null : draft.taxNumber.trim(),
      category: draft.category.trim() === "" ? null : draft.category.trim(),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      paymentTermsDays: draft.paymentTermsDays,
      currency: draft.currency.trim() === "" ? "EGP" : draft.currency.trim(),
      creditLimit: String(draft.creditLimit || 0),
      priceListId: draft.priceListId.trim() === "" ? null : draft.priceListId.trim(),
      taxExempt: draft.taxExempt,
      etaBuyerType: draft.etaBuyerType,
      nationalId: draft.nationalId.trim() === "" ? null : draft.nationalId.trim(),
    };
    try {
      if (editingId) {
        await updateCustomer.mutateAsync({ id: editingId, patch: { ...fields, active: draft.active } });
      } else {
        // "الكود: تلقائي إذا فارغ" — auto-generate a sequential code when left blank.
        const code = draft.code.trim() === "" ? `C${String(customers.length + 1).padStart(6, "0")}` : draft.code.trim();
        await createCustomer.mutateAsync({ id: crypto.randomUUID(), code, ...fields });
      }
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ بيانات العميل");
    }
  }

  const formFields = (
      <div className="flex flex-col gap-[14px]">
        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}
        <TextField label="اسم العميل *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
        <TextField label="الاسم بالإنجليزي" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
        <TextField
          label="الكود"
          value={draft.code}
          onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
          placeholder="تلقائي إذا فارغ"
          disabled={editingId !== null}
        />
        <NumberField
          label="شروط الدفع (أيام)"
          value={draft.paymentTermsDays}
          onChange={(v) => setDraft((d) => ({ ...d, paymentTermsDays: v }))}
          min={0}
        />
        <TextField label="العملة" value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} placeholder="EGP" />
        <NumberField
          label="الحد الائتماني"
          value={draft.creditLimit}
          onChange={(v) => setDraft((d) => ({ ...d, creditLimit: v }))}
          min={0}
          hint="دائماً بعملة المنشأة الأساسية بغض النظر عن عملة العميل"
        />
        <TextField label="التصنيف" value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} placeholder="بدون تصنيف" />
        <TextField label="قائمة الأسعار" value={draft.priceListId} onChange={(v) => setDraft((d) => ({ ...d, priceListId: v }))} placeholder="بدون قائمة أسعار" />
        <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="01xxxxxxxx" />
        <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
        <TextField label="الرقم الضريبي" value={draft.taxNumber} onChange={(v) => setDraft((d) => ({ ...d, taxNumber: v }))} placeholder="300xxxxxxxxx" />
        <SelectField
          label="نوع المشتري (ETA)"
          value={draft.etaBuyerType}
          onChange={(v) => setDraft((d) => ({ ...d, etaBuyerType: v as EtaBuyerTypeDTO }))}
          options={ETA_BUYER_TYPES.map((t) => ({ value: t, label: ETA_BUYER_TYPE_LABEL[t] }))}
        />
        <TextField label="الرقم القومي" value={draft.nationalId} onChange={(v) => setDraft((d) => ({ ...d, nationalId: v }))} />
        <ToggleField label="إعفاء ضريبي" checked={draft.taxExempt} onChange={(v) => setDraft((d) => ({ ...d, taxExempt: v }))} />
        <TextField label="جهة الاتصال" value={draft.contactPerson} onChange={(v) => setDraft((d) => ({ ...d, contactPerson: v }))} />
        <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
        {editingId ? <ToggleField label="نشط" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
          <Button variant="primary" onClick={submit}>
            {editingId ? "حفظ التعديلات" : "إضافة عميل"}
          </Button>
        </div>
      </div>
  );

  if (selected) {
    return (
      <>
        <CustomerDetail customer={selected} onBack={() => setSelectedId(null)} onEdit={() => openEditForm(selected)} />
        <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل عميل" : "إضافة عميل"} description="بيانات العميل الأساسية">
          {formFields}
        </SidePanel>
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل العملاء.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<CustomerDTO>
        eyebrow="Sales · Customers"
        title="العملاء"
        description="السجل المركزي للعملاء — بيانات الاتصال، شروط الائتمان، والتصنيف والتسعير"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة عميل
          </Button>
        }
        stats={[
          { label: "إجمالي العملاء", value: <span className="mz-num">{customers.length}</span> },
          { label: "نشط", value: <span className="mz-num">{customers.filter((c) => c.active).length}</span> },
          {
            label: "إجمالي حدود الائتمان",
            value: <MoneyValue value={customers.reduce((sum, c) => sum + num(c.creditLimit), 0)} showUnit={false} />,
          },
          {
            label: "إجمالي الأرصدة الافتتاحية",
            value: <MoneyValue value={customers.reduce((sum, c) => sum + num(c.openingBalance), 0)} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as typeof statusFilter)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالاسم أو الكود أو الهاتف…"
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        onRowClick={(c) => setSelectedId(c.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{customers.length}</span> عميل
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا يوجد عملاء مطابقون</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل عميل" : "إضافة عميل"} description="بيانات العميل الأساسية">
        {formFields}
      </SidePanel>
    </>
  );
}

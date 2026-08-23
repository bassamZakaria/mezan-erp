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
import type { PurchaseInvoiceStatusDTO, SupplierDTO } from "@mezan/contracts";
import { useCreateSupplier, useOpenInvoices, usePurchaseInvoices, useSuppliers, useUpdateSupplier, useVouchers } from "../data/hooks";
import {
  MONEY_RECONCILIATION_TOLERANCE,
  agingBucketsFor,
  moneyFromNumber,
  moneyToNumber,
  parseMoney,
  sumActiveAllocations,
  sumMoney,
  useSupplierAging,
  useVoucherAllocations,
} from "../data/partner-detail-hooks";
import { TextField, NumberField, ToggleField } from "../settings/form-controls";

/**
 * الموردون (Suppliers) — docs/catalog/02-purchases.md "الموردون". The mirror
 * of CustomersScreen.tsx: same DocumentList/DocumentDetail/SidePanel shape,
 * backed by the real `/suppliers` API.
 *
 * فواتير المشتريات reads the live `GET /purchases/invoices` narrowed to this
 * supplier. كشف حساب المورد builds a dated running payable from the allocation
 * sub-ledger a confirmed purchase invoice now writes into — opening balance,
 * every confirmed invoice as a credit, every confirmed supplier voucher as a
 * debit split over the invoices it was allocated onto — and reconciles the
 * closing figure against both `GET /open-invoices?kind=purchase` and
 * `GET /reports/aging/suppliers`.
 *
 * There is no attachments tab: this build has no file-storage subsystem of any
 * kind, so the tab would be a navigational dead end rather than an empty list.
 */

const PURCHASE_STATUS_LABEL: Record<PurchaseInvoiceStatusDTO, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  cancelled: "ملغي",
};

const PURCHASE_STATUS_TONE: Record<PurchaseInvoiceStatusDTO, PillTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

function isoToDisplay(date: string): string {
  return date.split("-").reverse().join("/");
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

/** فواتير مشتريات المورد — `GET /purchases/invoices`, narrowed to this supplier. */
function SupplierInvoicesTab({ supplierId }: { supplierId: string }) {
  const query = usePurchaseInvoices();
  const invoices = useMemo(
    () =>
      (query.data ?? [])
        .filter((inv) => inv.supplierId === supplierId)
        .sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : b.date.localeCompare(a.date))),
    [query.data, supplierId],
  );

  if (query.isError) return <TabError message="تعذّر تحميل فواتير المشتريات." onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل الفواتير…</p>;
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-[22px_24px]">
        <p className="text-[13.5px] font-semibold text-ink">لا توجد فواتير مشتريات مسجّلة لهذا المورد</p>
        <p className="mt-[8px] max-w-[70ch] text-[12.5px] leading-[1.9] text-ink-muted">
          أول فاتورة تُسجَّل لهذا المورد من شاشة «فواتير المشتريات» ستظهر هنا فور حفظها.
        </p>
      </div>
    );
  }

  const confirmed = invoices.filter((inv) => inv.status === "confirmed");
  const confirmedTotal = sumMoney(confirmed.map((inv) => inv.total));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label="عدد الفواتير" value={<span className="mz-num">{invoices.length}</span>} />
        <MiniStat label="فواتير مؤكدة" value={<span className="mz-num">{confirmed.length}</span>} />
        <MiniStat label="إجمالي المؤكد" value={<MoneyValue value={moneyToNumber(confirmedTotal)} showUnit={false} />} />
        <MiniStat
          label="آخر فاتورة"
          value={<span className="mz-num">{invoices[0] ? isoToDisplay(invoices[0].date) : "—"}</span>}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">رقم الفاتورة</th>
              <th className="p-[10px] text-start font-semibold">رقم فاتورة المورد</th>
              <th className="p-[10px] text-start font-semibold">التاريخ</th>
              <th className="p-[10px] text-start font-semibold">الاستحقاق</th>
              <th className="p-[10px] text-start font-semibold">الحالة</th>
              <th className="p-[10px] text-end font-semibold">قبل الضريبة</th>
              <th className="p-[10px] text-end font-semibold">الضريبة</th>
              <th className="p-[10px] text-end font-semibold">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id} className="border-b border-border last:border-b-0">
                <td className="mz-num p-[10px] font-semibold text-ink">{inv.number}</td>
                <td className="mz-num p-[10px] text-ink-muted">{inv.supplierInvoiceNumber ?? "—"}</td>
                <td className="mz-num p-[10px] text-ink-muted">{isoToDisplay(inv.date)}</td>
                <td className="mz-num p-[10px] text-ink-muted">{inv.dueDate ? isoToDisplay(inv.dueDate) : "—"}</td>
                <td className="p-[10px]">
                  <StatusPill label={PURCHASE_STATUS_LABEL[inv.status]} tone={PURCHASE_STATUS_TONE[inv.status]} />
                </td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={num(inv.subtotal)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end text-ink-muted">
                  <MoneyValue value={num(inv.tax)} showUnit={false} />
                </td>
                <td className="p-[10px] text-end font-semibold text-ink">
                  <MoneyValue value={num(inv.total)} showUnit={false} />
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
 * كشف حساب المورد — a dated AP movement ledger with a running payable.
 *
 * Confirming a purchase invoice now writes it into the voucher allocation
 * sub-ledger, so AP has a per-supplier dimension: every confirmed invoice is a
 * credit (raising the payable), and every confirmed supplier voucher is a debit
 * split into the invoices it was allocated onto (`GET /vouchers/:id/allocations`,
 * dated by the voucher and posted to the GL) plus any remainder still sitting
 * on account. The closing figure is reconciled twice — against the open-invoice
 * sub-ledger and against the أعمار ديون الموردين report.
 */
function SupplierStatementTab({ supplier }: { supplier: SupplierDTO }) {
  const invoicesQuery = usePurchaseInvoices();
  const vouchersQuery = useVouchers();
  const openInvoicesQuery = useOpenInvoices("purchase", supplier.id);
  const agingQuery = useSupplierAging();

  const supplierVouchers = useMemo(
    () =>
      (vouchersQuery.data ?? []).filter(
        (voucher) => voucher.supplierId === supplier.id && (voucher.status === "confirmed" || voucher.status === "posted"),
      ),
    [vouchersQuery.data, supplier.id],
  );
  const allocationsQuery = useVoucherAllocations(supplierVouchers.map((voucher) => voucher.id));

  const confirmedInvoices = useMemo(
    () => (invoicesQuery.data ?? []).filter((inv) => inv.supplierId === supplier.id && inv.status === "confirmed"),
    [invoicesQuery.data, supplier.id],
  );

  const invoiceLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const inv of openInvoicesQuery.data ?? []) labels.set(inv.id, inv.invoiceNo);
    for (const inv of confirmedInvoices) labels.set(inv.id, inv.number);
    return labels;
  }, [openInvoicesQuery.data, confirmedInvoices]);

  const rows = useMemo<StatementRow[]>(() => {
    const opening = parseMoney(supplier.openingBalance);
    const built: StatementRow[] = [
      {
        key: "opening",
        date: null,
        label: "رصيد افتتاحي",
        note: null,
        reference: "سجل المورد",
        debit: opening < 0n ? -opening : 0n,
        credit: opening > 0n ? opening : 0n,
      },
    ];

    for (const inv of confirmedInvoices) {
      built.push({
        key: `inv-${inv.id}`,
        date: inv.date,
        label: "فاتورة مشتريات",
        note: null,
        reference: inv.number,
        debit: 0n,
        credit: parseMoney(inv.total),
      });
    }

    const allocations = allocationsQuery.data ?? [];
    for (const voucher of supplierVouchers) {
      if (voucher.direction === "transfer") continue;
      const isPayment = voucher.direction === "payment";
      const label = isPayment ? "سند صرف للمورد" : "سند قبض من المورد";
      const voucherRef = voucher.docNo ?? voucher.id;
      const mine = allocations.filter((alloc) => alloc.voucherId === voucher.id && alloc.status === "active");
      for (const alloc of mine) {
        const amount = parseMoney(alloc.amount);
        built.push({
          key: `alloc-${alloc.id}`,
          date: voucher.date,
          label,
          note: `مخصص على الفاتورة ${invoiceLabels.get(alloc.invoiceId) ?? alloc.invoiceId}`,
          reference: voucherRef,
          debit: isPayment ? amount : 0n,
          credit: isPayment ? 0n : amount,
        });
      }
      const remainder = parseMoney(voucher.amount) - sumActiveAllocations(mine);
      if (remainder !== 0n) {
        const amount = remainder < 0n ? -remainder : remainder;
        const towardsDebit = remainder > 0n ? isPayment : !isPayment;
        built.push({
          key: `vch-${voucher.id}`,
          date: voucher.date,
          label,
          note: "غير مخصص على فاتورة — تحت حساب المورد",
          reference: voucherRef,
          debit: towardsDebit ? amount : 0n,
          credit: towardsDebit ? 0n : amount,
        });
      }
    }

    return built.sort((a, b) => {
      if (a.date === null) return -1;
      if (b.date === null) return 1;
      return a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date);
    });
  }, [supplier.openingBalance, confirmedInvoices, supplierVouchers, allocationsQuery.data, invoiceLabels]);

  const isError = invoicesQuery.isError || vouchersQuery.isError || allocationsQuery.isError || openInvoicesQuery.isError;
  const isLoading = invoicesQuery.isLoading || vouchersQuery.isLoading || allocationsQuery.isLoading || openInvoicesQuery.isLoading;

  const buckets = agingBucketsFor(agingQuery.data?.rows.find((row) => row.supplierId === supplier.id));

  if (isError) {
    return (
      <TabError
        message="تعذّر تحميل حركة حساب المورد."
        onRetry={() => {
          invoicesQuery.refetch();
          vouchersQuery.refetch();
          allocationsQuery.refetch();
          openInvoicesQuery.refetch();
        }}
      />
    );
  }
  if (isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">جارِ تحميل كشف الحساب…</p>;

  const totalDebit = rows.reduce<bigint>((total, row) => total + row.debit, 0n);
  const totalCredit = rows.reduce<bigint>((total, row) => total + row.credit, 0n);
  const closing = totalCredit - totalDebit;

  const invoicedTotal = sumMoney(confirmedInvoices.map((inv) => inv.total));
  const allocatedNet = (allocationsQuery.data ?? []).reduce<bigint>((total, alloc) => {
    if (alloc.status !== "active") return total;
    const voucher = supplierVouchers.find((v) => v.id === alloc.voucherId);
    if (!voucher) return total;
    return voucher.direction === "payment" ? total + parseMoney(alloc.amount) : total - parseMoney(alloc.amount);
  }, 0n);
  const subLedgerOutstanding = sumMoney((openInvoicesQuery.data ?? []).map((inv) => inv.outstanding));
  const matchesSubLedger = absDiff(invoicedTotal - allocatedNet, subLedgerOutstanding) <= MONEY_RECONCILIATION_TOLERANCE;

  const agingTotal = moneyFromNumber(buckets.total);
  const agingKnown = agingQuery.isSuccess;
  const matchesAging = absDiff(closing, agingTotal) <= MONEY_RECONCILIATION_TOLERANCE;

  let running = 0n;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label="رصيد افتتاحي" value={<MoneyValue value={num(supplier.openingBalance)} showUnit={false} />} />
        <MiniStat label="إجمالي المشتريات (دائن)" value={<MoneyValue value={moneyToNumber(totalCredit)} showUnit={false} />} />
        <MiniStat label="إجمالي المسدَّد (مدين)" value={<MoneyValue value={moneyToNumber(totalDebit)} showUnit={false} />} />
        <MiniStat label="الرصيد الختامي (مستحق للمورد)" value={<MoneyValue value={moneyToNumber(closing)} showUnit={false} />} />
      </div>

      <div className="flex flex-col gap-[10px] rounded-lg border border-border bg-surface p-[12px_15px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <StatusPill
            label={matchesSubLedger ? "مطابق لدفتر الفواتير المفتوحة" : "يختلف عن دفتر الفواتير المفتوحة"}
            tone={matchesSubLedger ? "success" : "warning"}
          />
          <span className="text-[12px] text-ink-muted">
            المتبقي على الفواتير المفتوحة <MoneyValue value={moneyToNumber(subLedgerOutstanding)} showUnit={false} className="text-ink" />
            {matchesSubLedger
              ? " — يساوي إجمالي الفواتير المؤكدة ناقص ما خُصِّص عليها من سندات. الرصيد الختامي يضيف إليه الرصيد الافتتاحي ويخصم منه الدفعات غير المخصصة."
              : " — لا يساوي إجمالي الفواتير المؤكدة ناقص ما خُصِّص عليها: قد تكون هناك فاتورة مؤكدة خارج دفتر التخصيص أو فاتورة أُلغيت بعد تخصيص سداد عليها."}
          </span>
        </div>
        {agingKnown ? (
          <div className="flex flex-wrap items-center gap-[10px]">
            <StatusPill
              label={matchesAging ? "مطابق لتقرير أعمار الديون" : "يختلف عن تقرير أعمار الديون"}
              tone={matchesAging ? "success" : "warning"}
            />
            <span className="text-[12px] text-ink-muted">
              رصيد التقرير <MoneyValue value={moneyToNumber(agingTotal)} showUnit={false} className="text-ink" />
              {matchesAging
                ? " — محسوب من إجمالي الفواتير المؤكدة."
                : " — التقرير يحتسب إجمالي كل فاتورة مؤكدة دون خصم ما سُدِّد منها، ولا يشمل الرصيد الافتتاحي."}
            </span>
          </div>
        ) : null}
      </div>

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
              running += row.credit - row.debit;
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

      <div className="rounded-lg border border-border bg-surface p-[16px_18px]">
        <h3 className="font-display text-[13.5px] font-bold text-ink">أعمار فواتير هذا المورد</h3>
        <p className="mt-[4px] max-w-[80ch] text-[11.5px] leading-[1.8] text-ink-faint">
          من تقرير «أعمار ديون الموردين» — إجمالي كل فاتورة مؤكدة موزّعاً على شرائح التأخير، دون خصم أي سداد.
        </p>
        {agingQuery.isError ? (
          <div className="mt-[12px]">
            <TabError message="تعذّر تحميل تقرير أعمار ديون الموردين." onRetry={() => agingQuery.refetch()} />
          </div>
        ) : (
          <div className="mt-[14px] overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th className="p-[8px] text-end font-semibold">جاري</th>
                  <th className="p-[8px] text-end font-semibold">31-60 يوم</th>
                  <th className="p-[8px] text-end font-semibold">61-90 يوم</th>
                  <th className="p-[8px] text-end font-semibold">91-120 يوم</th>
                  <th className="p-[8px] text-end font-semibold">أكثر من 120 يوم</th>
                  <th className="p-[8px] text-end font-semibold">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="p-[8px] text-end text-ink">
                    <MoneyValue value={buckets.current} showUnit={false} />
                  </td>
                  <td className="p-[8px] text-end text-ink">
                    <MoneyValue value={buckets.d31to60} showUnit={false} />
                  </td>
                  <td className="p-[8px] text-end text-ink">
                    <MoneyValue value={buckets.d61to90} showUnit={false} />
                  </td>
                  <td className="p-[8px] text-end text-ink">
                    <MoneyValue value={buckets.d91to120} showUnit={false} />
                  </td>
                  <td className="p-[8px] text-end text-ink">
                    <MoneyValue value={buckets.over120} showUnit={false} />
                  </td>
                  <td className="p-[8px] text-end font-semibold text-ink">
                    <MoneyValue value={buckets.total} showUnit={false} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="max-w-[80ch] text-[11.5px] leading-[1.9] text-ink-faint">
        كل سداد يظهر بتاريخ سنده وبرقم الفاتورة المخصص عليها من دفتر تخصيص السندات. ما لم يُخصَّص من السند على فاتورة بعينه يظهر كدفعة
        تحت حساب المورد بتاريخ السند نفسه. القيود اليومية المُرحَّلة مباشرة على حساب الذمم الدائنة (2100) لا ترتبط بمورد بعينه ولا تظهر في
        هذا الكشف.
      </p>
    </div>
  );
}

/** Absolute difference of two scaled integers — reconciliation stays in `bigint` space. */
function absDiff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

interface SupplierDraft {
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
  openingBalance: number;
  addressCity: string;
  addressDistrict: string;
  addressStreet: string;
  active: boolean;
}

const BLANK_DRAFT: SupplierDraft = {
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
  openingBalance: 0,
  addressCity: "",
  addressDistrict: "",
  addressStreet: "",
  active: true,
};

function draftFromSupplier(supplier: SupplierDTO): SupplierDraft {
  return {
    code: supplier.code,
    nameAr: supplier.nameAr,
    nameEn: supplier.nameEn ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    contactPerson: supplier.contactPerson ?? "",
    taxNumber: supplier.taxNumber ?? "",
    category: supplier.category ?? "",
    notes: supplier.notes ?? "",
    paymentTermsDays: supplier.paymentTermsDays,
    currency: supplier.currency,
    openingBalance: num(supplier.openingBalance),
    addressCity: supplier.addressCity ?? "",
    addressDistrict: supplier.addressDistrict ?? "",
    addressStreet: supplier.addressStreet ?? "",
    active: supplier.active,
  };
}

function SupplierDetail({ supplier, onBack, onEdit }: { supplier: SupplierDTO; onBack: () => void; onEdit: () => void }) {
  const address = [supplier.addressStreet, supplier.addressDistrict, supplier.addressCity].filter(Boolean).join("، ");
  return (
    <DocumentDetail
      title={`${supplier.nameAr} · ${supplier.code}`}
      statusLabel={supplier.active ? "نشط" : "غير نشط"}
      statusTone={supplier.active ? "success" : "neutral"}
      subtitle={supplier.nameEn ?? undefined}
      actions={
        <>
          <Button variant="primary" onClick={onEdit}>
            تعديل
          </Button>
          <Button onClick={onBack}>رجوع لقائمة الموردين</Button>
        </>
      }
      summary={[
        { label: "التصنيف", value: supplier.category ?? "بدون تصنيف" },
        { label: "شروط الدفع", value: <span className="mz-num">{supplier.paymentTermsDays} يوم</span> },
        { label: "العملة", value: supplier.currency },
        { label: "الهاتف", value: supplier.phone ?? "لا يوجد" },
        {
          label: "المستحق للمورد (الرصيد الافتتاحي)",
          value: <MoneyValue value={num(supplier.openingBalance)} />,
        },
        { label: "الرقم الضريبي", value: supplier.taxNumber ?? "لا يوجد" },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              {[
                { label: "البريد الإلكتروني", value: supplier.email ?? "لا يوجد" },
                { label: "جهة الاتصال", value: supplier.contactPerson ?? "لا يوجد" },
                { label: "الرقم الضريبي", value: supplier.taxNumber ?? "لا يوجد" },
                { label: "العنوان", value: address === "" ? "لا يوجد" : address },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{row.label}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{row.value}</div>
                </div>
              ))}
              {supplier.notes ? (
                <div className="col-span-full rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{supplier.notes}</div>
                </div>
              ) : null}
            </div>
          ),
        },
        { key: "invoices", label: "فواتير المشتريات", content: <SupplierInvoicesTab supplierId={supplier.id} /> },
        { key: "statement", label: "كشف حساب المورد", content: <SupplierStatementTab supplier={supplier} /> },
      ]}
    />
  );
}

export function SuppliersScreen() {
  const query = useSuppliers();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();
  const suppliers = query.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplierDraft>(BLANK_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const selected = suppliers.find((s) => s.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    let rows = suppliers;
    if (statusFilter !== "all") rows = rows.filter((s) => (statusFilter === "active" ? s.active : !s.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (s) => s.nameAr.includes(search.trim()) || s.code.toLowerCase().includes(q) || (s.phone ?? "").includes(search.trim()),
      );
    }
    return rows;
  }, [suppliers, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: suppliers.length },
    { key: "active", label: "نشط", count: suppliers.filter((s) => s.active).length },
    { key: "inactive", label: "غير نشط", count: suppliers.filter((s) => !s.active).length },
  ];

  const columns: DocumentListColumn<SupplierDTO>[] = [
    {
      key: "name",
      header: "المورد",
      render: (s) => (
        <div>
          <div className="font-semibold text-ink">{s.nameAr}</div>
          <div className="mz-num text-[11.5px] text-ink-faint">{s.code}</div>
        </div>
      ),
    },
    { key: "phone", header: "الهاتف", render: (s) => s.phone ?? "—" },
    { key: "terms", header: "شروط الدفع", render: (s) => <span className="mz-num">{s.paymentTermsDays} يوم</span> },
    { key: "category", header: "التصنيف", render: (s) => s.category ?? "بدون تصنيف" },
    { key: "openingBalance", header: "المستحق للمورد", align: "end", render: (s) => <MoneyValue value={num(s.openingBalance)} /> },
    {
      key: "status",
      header: "الحالة",
      render: (s) => <StatusPill label={s.active ? "نشط" : "غير نشط"} tone={(s.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setError(null);
    setPanelOpen(true);
  }

  function openEditForm(supplier: SupplierDTO) {
    setEditingId(supplier.id);
    setDraft(draftFromSupplier(supplier));
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
      openingBalance: String(draft.openingBalance || 0),
      addressCity: draft.addressCity.trim() === "" ? null : draft.addressCity.trim(),
      addressDistrict: draft.addressDistrict.trim() === "" ? null : draft.addressDistrict.trim(),
      addressStreet: draft.addressStreet.trim() === "" ? null : draft.addressStreet.trim(),
    };
    try {
      if (editingId) {
        await updateSupplier.mutateAsync({ id: editingId, patch: { ...fields, active: draft.active } });
      } else {
        // "الكود: تلقائي إذا فارغ" — auto-generate a sequential code when left blank.
        const code = draft.code.trim() === "" ? `S${String(suppliers.length + 1).padStart(6, "0")}` : draft.code.trim();
        await createSupplier.mutateAsync({ id: crypto.randomUUID(), code, ...fields });
      }
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ بيانات المورد");
    }
  }

  const formFields = (
    <div className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <TextField label="اسم المورد *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
      <TextField
        label="الكود"
        value={draft.code}
        onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
        placeholder="تلقائي إذا فارغ"
        disabled={editingId !== null}
      />
      <TextField label="الهاتف" type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="01xxxxxxxx" />
      <NumberField
        label="شروط الدفع (أيام)"
        value={draft.paymentTermsDays}
        onChange={(v) => setDraft((d) => ({ ...d, paymentTermsDays: v }))}
        min={0}
      />
      <TextField label="العملة" value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} placeholder="EGP" />
      <TextField label="التصنيف" value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} placeholder="بدون تصنيف" />
      <NumberField
        label="الرصيد الافتتاحي"
        value={draft.openingBalance}
        onChange={(v) => setDraft((d) => ({ ...d, openingBalance: v }))}
        hint="المبلغ المستحق للمورد عند بدء التعامل معه في مزان"
      />
      <TextField label="الاسم بالإنجليزي" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
      <TextField label="البريد الإلكتروني" type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
      <TextField label="الرقم الضريبي" value={draft.taxNumber} onChange={(v) => setDraft((d) => ({ ...d, taxNumber: v }))} placeholder="300xxxxxxxxx" />
      <TextField label="جهة الاتصال" value={draft.contactPerson} onChange={(v) => setDraft((d) => ({ ...d, contactPerson: v }))} />
      <TextField label="المدينة" value={draft.addressCity} onChange={(v) => setDraft((d) => ({ ...d, addressCity: v }))} />
      <TextField label="الحي" value={draft.addressDistrict} onChange={(v) => setDraft((d) => ({ ...d, addressDistrict: v }))} />
      <TextField label="الشارع" value={draft.addressStreet} onChange={(v) => setDraft((d) => ({ ...d, addressStreet: v }))} />
      <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
      {editingId ? <ToggleField label="نشط" checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
      <div className="flex justify-end gap-[9px]">
        <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
        <Button variant="primary" onClick={submit}>
          {editingId ? "حفظ التعديلات" : "إضافة مورد"}
        </Button>
      </div>
    </div>
  );

  if (selected) {
    return (
      <>
        <SupplierDetail supplier={selected} onBack={() => setSelectedId(null)} onEdit={() => openEditForm(selected)} />
        <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل مورد" : "إضافة مورد"} description="بيانات المورد الأساسية">
          {formFields}
        </SidePanel>
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الموردين.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<SupplierDTO>
        eyebrow="Purchases · Suppliers"
        title="الموردون"
        description="السجل المركزي للموردين — بيانات الاتصال، شروط الدفع، والتصنيف والعنوان"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة مورد
          </Button>
        }
        stats={[
          { label: "إجمالي الموردين", value: <span className="mz-num">{suppliers.length}</span> },
          { label: "نشط", value: <span className="mz-num">{suppliers.filter((s) => s.active).length}</span> },
          {
            label: "المستحق للموردين",
            value: <MoneyValue value={suppliers.reduce((sum, s) => sum + num(s.openingBalance), 0)} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as typeof statusFilter)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث باسم المورد أو الكود أو الهاتف…"
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        onRowClick={(s) => setSelectedId(s.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{suppliers.length}</span> مورد
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا يوجد موردون مطابقون</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? "تعديل مورد" : "إضافة مورد"} description="بيانات المورد الأساسية">
        {formFields}
      </SidePanel>
    </>
  );
}

import { useMemo, useState, type ReactNode } from "react";
import { matchesSearch } from "@mezan/domain";
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
import { useAppTranslation, type AppTranslationKey } from "../i18n";

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

const PURCHASE_STATUS_KEY: Record<PurchaseInvoiceStatusDTO, AppTranslationKey> = {
  draft: "suppliers.status.draft",
  confirmed: "suppliers.status.confirmed",
  cancelled: "suppliers.status.cancelled",
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
  const { t } = useAppTranslation();
  return (
    <Card className="p-[18px_20px]">
      <p className="text-[13px] font-semibold text-danger-ink">{message}</p>
      <Button size="sm" className="mt-[10px]" onClick={onRetry}>
        {t("common.retry")}
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
  const { t } = useAppTranslation();
  const query = usePurchaseInvoices();
  const invoices = useMemo(
    () =>
      (query.data ?? [])
        .filter((inv) => inv.supplierId === supplierId)
        .sort((a, b) => (a.date === b.date ? a.number.localeCompare(b.number) : b.date.localeCompare(a.date))),
    [query.data, supplierId],
  );

  if (query.isError) return <TabError message={t("suppliers.invoices.loadFailed")} onRetry={() => query.refetch()} />;
  if (query.isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("suppliers.invoices.loading")}</p>;
  if (invoices.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface p-[22px_24px]">
        <p className="text-[13.5px] font-semibold text-ink">{t("suppliers.invoices.emptyTitle")}</p>
        <p className="mt-[8px] max-w-[70ch] text-[12.5px] leading-[1.9] text-ink-muted">
          {t("suppliers.invoices.emptyBody")}
        </p>
      </div>
    );
  }

  const confirmed = invoices.filter((inv) => inv.status === "confirmed");
  const confirmedTotal = sumMoney(confirmed.map((inv) => inv.total));

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-4">
        <MiniStat label={t("suppliers.invoices.count")} value={<span className="mz-num">{invoices.length}</span>} />
        <MiniStat label={t("suppliers.invoices.confirmed")} value={<span className="mz-num">{confirmed.length}</span>} />
        <MiniStat label={t("suppliers.invoices.confirmedTotal")} value={<MoneyValue value={moneyToNumber(confirmedTotal)} showUnit={false} />} />
        <MiniStat
          label={t("suppliers.invoices.last")}
          value={<span className="mz-num">{invoices[0] ? isoToDisplay(invoices[0].date) : "—"}</span>}
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("suppliers.invoices.col.number")}</th>
              <th className="p-[10px] text-start font-semibold">{t("suppliers.invoices.col.supplierNumber")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.date")}</th>
              <th className="p-[10px] text-start font-semibold">{t("suppliers.invoices.col.due")}</th>
              <th className="p-[10px] text-start font-semibold">{t("common.status")}</th>
              <th className="p-[10px] text-end font-semibold">{t("suppliers.invoices.col.beforeTax")}</th>
              <th className="p-[10px] text-end font-semibold">{t("suppliers.invoices.col.tax")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.total")}</th>
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
                  <StatusPill label={t(PURCHASE_STATUS_KEY[inv.status])} tone={PURCHASE_STATUS_TONE[inv.status]} />
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
  const { t } = useAppTranslation();
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
        label: t("suppliers.statement.opening"),
        note: null,
        reference: t("suppliers.statement.supplierRecord"),
        debit: opening < 0n ? -opening : 0n,
        credit: opening > 0n ? opening : 0n,
      },
    ];

    for (const inv of confirmedInvoices) {
      built.push({
        key: `inv-${inv.id}`,
        date: inv.date,
        label: t("suppliers.statement.purchaseInvoice"),
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
      const label = isPayment ? t("suppliers.statement.paymentOut") : t("suppliers.statement.paymentIn");
      const voucherRef = voucher.docNo ?? voucher.id;
      const mine = allocations.filter((alloc) => alloc.voucherId === voucher.id && alloc.status === "active");
      for (const alloc of mine) {
        const amount = parseMoney(alloc.amount);
        built.push({
          key: `alloc-${alloc.id}`,
          date: voucher.date,
          label,
          note: t("suppliers.statement.allocatedTo", { invoice: invoiceLabels.get(alloc.invoiceId) ?? alloc.invoiceId }),
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
          note: t("suppliers.statement.unallocated"),
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
        message={t("suppliers.statement.loadFailed")}
        onRetry={() => {
          invoicesQuery.refetch();
          vouchersQuery.refetch();
          allocationsQuery.refetch();
          openInvoicesQuery.refetch();
        }}
      />
    );
  }
  if (isLoading) return <p className="p-[18px] text-[12.5px] text-ink-muted">{t("suppliers.statement.loading")}</p>;

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
        <MiniStat label={t("suppliers.statement.opening")} value={<MoneyValue value={num(supplier.openingBalance)} showUnit={false} />} />
        <MiniStat label={t("suppliers.statement.totalCredit")} value={<MoneyValue value={moneyToNumber(totalCredit)} showUnit={false} />} />
        <MiniStat label={t("suppliers.statement.totalDebit")} value={<MoneyValue value={moneyToNumber(totalDebit)} showUnit={false} />} />
        <MiniStat label={t("suppliers.statement.closing")} value={<MoneyValue value={moneyToNumber(closing)} showUnit={false} />} />
      </div>

      <div className="flex flex-col gap-[10px] rounded-lg border border-border bg-surface p-[12px_15px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <StatusPill
            label={matchesSubLedger ? t("suppliers.statement.matchesSubLedger") : t("suppliers.statement.differsFromSubLedger")}
            tone={matchesSubLedger ? "success" : "warning"}
          />
          <span className="text-[12px] text-ink-muted">
            {t("suppliers.statement.outstandingLabel")} <MoneyValue value={moneyToNumber(subLedgerOutstanding)} showUnit={false} className="text-ink" />
            {matchesSubLedger
              ? t("suppliers.statement.subLedgerMatchNote")
              : t("suppliers.statement.subLedgerDiffNote")}
          </span>
        </div>
        {agingKnown ? (
          <div className="flex flex-wrap items-center gap-[10px]">
            <StatusPill
              label={matchesAging ? t("suppliers.statement.matchesAging") : t("suppliers.statement.differsFromAging")}
              tone={matchesAging ? "success" : "warning"}
            />
            <span className="text-[12px] text-ink-muted">
              {t("suppliers.statement.reportBalance")} <MoneyValue value={moneyToNumber(agingTotal)} showUnit={false} className="text-ink" />
              {matchesAging
                ? t("suppliers.statement.agingMatchNote")
                : t("suppliers.statement.agingDiffNote")}
            </span>
          </div>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[10px] text-start font-semibold">{t("common.date")}</th>
              <th className="p-[10px] text-start font-semibold">{t("suppliers.statement.col.movement")}</th>
              <th className="p-[10px] text-start font-semibold">{t("suppliers.statement.col.reference")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.debit")}</th>
              <th className="p-[10px] text-end font-semibold">{t("common.credit")}</th>
              <th className="p-[10px] text-end font-semibold">{t("suppliers.statement.col.balance")}</th>
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
        <h3 className="font-display text-[13.5px] font-bold text-ink">{t("suppliers.aging.heading")}</h3>
        <p className="mt-[4px] max-w-[80ch] text-[11.5px] leading-[1.8] text-ink-faint">
          {t("suppliers.aging.description")}
        </p>
        {agingQuery.isError ? (
          <div className="mt-[12px]">
            <TabError message={t("suppliers.aging.loadFailed")} onRetry={() => agingQuery.refetch()} />
          </div>
        ) : (
          <div className="mt-[14px] overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.current")}</th>
                  <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.d31to60")}</th>
                  <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.d61to90")}</th>
                  <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.d91to120")}</th>
                  <th className="p-[8px] text-end font-semibold">{t("suppliers.aging.over120")}</th>
                  <th className="p-[8px] text-end font-semibold">{t("common.total")}</th>
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
        {t("suppliers.statement.footnote")}
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
  const { t } = useAppTranslation();
  const address = [supplier.addressStreet, supplier.addressDistrict, supplier.addressCity].filter(Boolean).join(t("suppliers.addressSeparator"));
  return (
    <DocumentDetail
      title={`${supplier.nameAr} · ${supplier.code}`}
      statusLabel={supplier.active ? t("common.active") : t("common.inactive")}
      statusTone={supplier.active ? "success" : "neutral"}
      subtitle={supplier.nameEn ?? undefined}
      actions={
        <>
          <Button variant="primary" onClick={onEdit}>
            {t("suppliers.edit")}
          </Button>
          <Button onClick={onBack}>{t("suppliers.backToList")}</Button>
        </>
      }
      summary={[
        { label: t("suppliers.detail.category"), value: supplier.category ?? t("common.uncategorized") },
        { label: t("suppliers.detail.paymentTerms"), value: <span className="mz-num">{t("suppliers.detail.days", { days: supplier.paymentTermsDays })}</span> },
        { label: t("suppliers.detail.currency"), value: supplier.currency },
        { label: t("common.phone"), value: supplier.phone ?? t("common.none") },
        {
          label: t("suppliers.detail.payableOpening"),
          value: <MoneyValue value={num(supplier.openingBalance)} />,
        },
        { label: t("common.taxNumber"), value: supplier.taxNumber ?? t("common.none") },
      ]}
      tabs={[
        {
          key: "overview",
          label: t("common.overview"),
          content: (
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
              {[
                { label: t("common.email"), value: supplier.email ?? t("common.none") },
                { label: t("suppliers.detail.contactPerson"), value: supplier.contactPerson ?? t("common.none") },
                { label: t("common.taxNumber"), value: supplier.taxNumber ?? t("common.none") },
                { label: t("suppliers.detail.address"), value: address === "" ? t("common.none") : address },
              ].map((row) => (
                <div key={row.label} className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{row.label}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{row.value}</div>
                </div>
              ))}
              {supplier.notes ? (
                <div className="col-span-full rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{t("common.notes")}</div>
                  <div className="mt-[5px] text-[13.5px] text-ink">{supplier.notes}</div>
                </div>
              ) : null}
            </div>
          ),
        },
        { key: "invoices", label: t("suppliers.tab.invoices"), content: <SupplierInvoicesTab supplierId={supplier.id} /> },
        { key: "statement", label: t("suppliers.tab.statement"), content: <SupplierStatementTab supplier={supplier} /> },
      ]}
    />
  );
}

export function SuppliersScreen() {
  const { t } = useAppTranslation();
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
        (s) => matchesSearch(search, s.nameAr, s.nameEn, s.code, s.phone),
      );
    }
    return rows;
  }, [suppliers, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: suppliers.length },
    { key: "active", label: t("common.active"), count: suppliers.filter((s) => s.active).length },
    { key: "inactive", label: t("common.inactive"), count: suppliers.filter((s) => !s.active).length },
  ];

  const columns: DocumentListColumn<SupplierDTO>[] = [
    {
      key: "name",
      header: t("suppliers.col.supplier"),
      render: (s) => (
        <div>
          <div className="font-semibold text-ink">{s.nameAr}</div>
          <div className="mz-num text-[11.5px] text-ink-faint">{s.code}</div>
        </div>
      ),
    },
    { key: "phone", header: t("common.phone"), render: (s) => s.phone ?? "—" },
    { key: "terms", header: t("suppliers.detail.paymentTerms"), render: (s) => <span className="mz-num">{t("suppliers.detail.days", { days: s.paymentTermsDays })}</span> },
    { key: "category", header: t("suppliers.detail.category"), render: (s) => s.category ?? t("common.uncategorized") },
    { key: "openingBalance", header: t("suppliers.col.payable"), align: "end", render: (s) => <MoneyValue value={num(s.openingBalance)} /> },
    {
      key: "status",
      header: t("common.status"),
      render: (s) => <StatusPill label={s.active ? t("common.active") : t("common.inactive")} tone={(s.active ? "success" : "neutral") as PillTone} />,
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
      setError(t("suppliers.error.nameRequired"));
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
      setError(err instanceof Error ? err.message : t("suppliers.error.saveFailed"));
    }
  }

  const formFields = (
    <div className="flex flex-col gap-[14px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <TextField label={t("suppliers.field.name")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
      <TextField
        label={t("suppliers.field.code")}
        value={draft.code}
        onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
        placeholder={t("suppliers.field.codePlaceholder")}
        disabled={editingId !== null}
      />
      <TextField label={t("common.phone")} type="tel" value={draft.phone} onChange={(v) => setDraft((d) => ({ ...d, phone: v }))} placeholder="01xxxxxxxx" />
      <NumberField
        label={t("suppliers.field.paymentTerms")}
        value={draft.paymentTermsDays}
        onChange={(v) => setDraft((d) => ({ ...d, paymentTermsDays: v }))}
        min={0}
      />
      <TextField label={t("suppliers.field.currency")} value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v }))} placeholder="EGP" />
      <TextField label={t("suppliers.field.category")} value={draft.category} onChange={(v) => setDraft((d) => ({ ...d, category: v }))} placeholder={t("common.uncategorized")} />
      <NumberField
        label={t("suppliers.field.openingBalance")}
        value={draft.openingBalance}
        onChange={(v) => setDraft((d) => ({ ...d, openingBalance: v }))}
        hint={t("suppliers.field.openingBalanceHint")}
      />
      <TextField label={t("suppliers.field.nameEn")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
      <TextField label={t("common.email")} type="email" value={draft.email} onChange={(v) => setDraft((d) => ({ ...d, email: v }))} />
      <TextField label={t("suppliers.field.taxNumber")} value={draft.taxNumber} onChange={(v) => setDraft((d) => ({ ...d, taxNumber: v }))} placeholder="300xxxxxxxxx" />
      <TextField label={t("suppliers.field.contactPerson")} value={draft.contactPerson} onChange={(v) => setDraft((d) => ({ ...d, contactPerson: v }))} />
      <TextField label={t("suppliers.field.city")} value={draft.addressCity} onChange={(v) => setDraft((d) => ({ ...d, addressCity: v }))} />
      <TextField label={t("suppliers.field.district")} value={draft.addressDistrict} onChange={(v) => setDraft((d) => ({ ...d, addressDistrict: v }))} />
      <TextField label={t("suppliers.field.street")} value={draft.addressStreet} onChange={(v) => setDraft((d) => ({ ...d, addressStreet: v }))} />
      <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
      {editingId ? <ToggleField label={t("common.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} /> : null}
      <div className="flex justify-end gap-[9px]">
        <Button onClick={() => setPanelOpen(false)}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={submit}>
          {editingId ? t("suppliers.saveEdits") : t("suppliers.addSupplier")}
        </Button>
      </div>
    </div>
  );

  if (selected) {
    return (
      <>
        <SupplierDetail supplier={selected} onBack={() => setSelectedId(null)} onEdit={() => openEditForm(selected)} />
        <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? t("suppliers.editSupplier") : t("suppliers.addSupplier")} description={t("suppliers.panel.description")}>
          {formFields}
        </SidePanel>
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("suppliers.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<SupplierDTO>
        eyebrow={t("eyebrow.purchases.suppliers")}
        title={t("suppliers.title")}
        description={t("suppliers.description")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("suppliers.addSupplier")}
          </Button>
        }
        stats={[
          { label: t("suppliers.stat.total"), value: <span className="mz-num">{suppliers.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{suppliers.filter((s) => s.active).length}</span> },
          {
            label: t("suppliers.stat.payable"),
            value: <MoneyValue value={suppliers.reduce((sum, s) => sum + num(s.openingBalance), 0)} showUnit={false} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as typeof statusFilter)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("suppliers.searchPlaceholder")}
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.id}
        onRowClick={(s) => setSelectedId(s.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{suppliers.length}</span> {t("suppliers.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("suppliers.empty")}</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={editingId ? t("suppliers.editSupplier") : t("suppliers.addSupplier")} description={t("suppliers.panel.description")}>
        {formFields}
      </SidePanel>
    </>
  );
}

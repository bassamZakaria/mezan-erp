import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  IconButton,
  EntityPicker,
  MoneyInput,
  QtyInput,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type EntityPickerOption,
} from "@mezan/ui";
import {
  Money,
  Qty,
  computeInvoiceTotals,
  SALES_INVOICE_STATUS_LABELS_AR,
  type SalesInvoiceLine,
  type SalesInvoiceDiscount,
  type SalesInvoiceDiscountType,
} from "@mezan/domain";
import type { SalesInvoiceStatusDTO } from "@mezan/contracts";
import {
  useAccounts,
  useConfirmSalesInvoice,
  useCreateSalesInvoice,
  useCustomers,
  useItems,
  useJournalEntry,
  useRecordSalesInvoicePayment,
  useSalesInvoices,
  useWarehouses,
  type SalesInvoiceDTO,
} from "../data/hooks";
import { useUnitLabel } from "../lib/item-labels";
import { SelectField, NumberField } from "../settings/form-controls";
import { useScreenIntent } from "../navigation";

/** فواتير المبيعات (Sales Invoices) — docs/catalog/01-sales.md. List + detail (with the
 * "تأثيرات هذه الفاتورة" effects panel) + a create/confirm SidePanel form with live
 * totals, wired to the real `/sales-invoices` API (numbering + GL + stock engines). */

/** GL accounts a manually-created invoice falls back to when an item has none configured — leaves of the standard COA (packages/domain/src/accounts/coa-template.ts). */
const AR_ACCOUNT_ID = "1105";
const TAX_ACCOUNT_ID = "2200";
const REVENUE_ACCOUNT_ID = "4100";
const COGS_ACCOUNT_ID = "5100";
const INVENTORY_ACCOUNT_ID = "1200";
const DEFAULT_BRANCH_ID = "MAIN";

const STATUS_TONE: Record<SalesInvoiceStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  partially_paid: "warning",
  paid: "success",
  cancelled: "danger",
  reversed: "danger",
};

const LIST_STATUSES: SalesInvoiceStatusDTO[] = ["draft", "confirmed", "partially_paid", "paid", "cancelled"];

function toMajor(v: string): number {
  return Number(v);
}

function isOverdue(inv: { status: SalesInvoiceStatusDTO; dueDate: string }, today: string): boolean {
  return (inv.status === "confirmed" || inv.status === "partially_paid") && inv.dueDate < today;
}

/* ------------------------------------------------------------------ */
/* Create form                                                         */
/* ------------------------------------------------------------------ */

interface InvoiceLineDraft {
  key: string;
  itemId: string;
  qty: number;
  unitPrice: number | null;
  discountPercent: number;
}

let lineSeq = 0;
function blankLine(): InvoiceLineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, itemId: "", qty: 1, unitPrice: null, discountPercent: 0 };
}

function CreateInvoicePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const customersQuery = useCustomers();
  const itemsQuery = useItems();
  const warehousesQuery = useWarehouses();
  const createInvoice = useCreateSalesInvoice();
  const confirmInvoice = useConfirmSalesInvoice();
  const unitLabel = useUnitLabel();

  const customers = customersQuery.data ?? [];
  const items = itemsQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const today = new Date().toISOString().slice(0, 10);
  const [customer, setCustomer] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [warehouseId, setWarehouseId] = useState("");
  const [discountType, setDiscountType] = useState<SalesInvoiceDiscountType>("amount");
  const [discountValue, setDiscountValue] = useState(0);
  const [lines, setLines] = useState<InvoiceLineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setCustomer(null);
    setDate(today);
    setDueDate(today);
    setWarehouseId(warehouses[0]?.id ?? "");
    setDiscountType("amount");
    setDiscountValue(0);
    setLines([blankLine()]);
    setError(null);
  }

  useEffect(() => {
    if (open) resetForm();
  }, [open, warehouses]);

  const customerOptions = useMemo<EntityPickerOption[]>(
    () => customers.filter((c) => c.active).map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [customers],
  );
  const itemOptions = useMemo<EntityPickerOption[]>(
    () => items.filter((i) => i.status === "active").map((i) => ({ id: i.id, label: i.nameAr, sublabel: `${i.code} · ${i.salePrice ?? "0"} ج.م` })),
    [items],
  );

  const customerData = customer ? (customers.find((c) => c.id === customer.id) ?? null) : null;

  const domainLines = useMemo<SalesInvoiceLine[]>(() => {
    const out: SalesInvoiceLine[] = [];
    for (const l of lines) {
      const item = items.find((i) => i.id === l.itemId);
      if (!item) continue;
      const isStock = item.type === "stock";
      out.push({
        lineId: l.key,
        itemId: item.id,
        itemNameAr: item.nameAr,
        isStock,
        qty: Qty.fromMajor(String(l.qty || 0)),
        unitPrice: Money.fromMajor(String(l.unitPrice ?? 0)),
        discountPercent: l.discountPercent || 0,
        taxRatePercent: item.taxRatePercent,
        revenueAccountId: item.revenueAccountId ?? REVENUE_ACCOUNT_ID,
        cogsAccountId: isStock ? (item.cogsAccountId ?? COGS_ACCOUNT_ID) : null,
        inventoryAccountId: isStock ? (item.inventoryAccountId ?? INVENTORY_ACCOUNT_ID) : null,
        unitCost: null,
      });
    }
    return out;
  }, [lines, items]);

  const discount: SalesInvoiceDiscount = useMemo(
    () =>
      discountType === "percent"
        ? { type: "percent", percent: discountValue || 0 }
        : { type: "amount", amount: Money.fromMajor(String(discountValue || 0)) },
    [discountType, discountValue],
  );

  // A pure, local totals preview — the server recomputes (and is authoritative on) the same totals on create.
  const totals = useMemo(
    () => computeInvoiceTotals(domainLines, discount, { taxExempt: customerData?.taxExempt ?? false }),
    [domainLines, discount, customerData],
  );
  const totalsByLineId = useMemo(() => new Map(totals.lines.map((l) => [l.lineId, l])), [totals]);

  const canSubmit = customer !== null && domainLines.length > 0 && totals.grandTotal.scaled > 0n && !busy;

  function updateLine(index: number, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handleSave(shouldConfirm: boolean) {
    if (!customer || !customerData) {
      setError("العميل مطلوب.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createInvoice.mutateAsync({
        date,
        dueDate,
        customerId: customer.id,
        customerNameAr: customerData.nameAr,
        customerTaxExempt: customerData.taxExempt,
        warehouseId,
        branchId: DEFAULT_BRANCH_ID,
        currency: customerData.currency,
        discount: discount.type === "percent" ? { type: "percent", percent: discount.percent } : { type: "amount", amount: discount.amount.toString() },
        arAccountId: AR_ACCOUNT_ID,
        taxAccountId: TAX_ACCOUNT_ID,
        lines: domainLines.map((l) => ({
          lineId: l.lineId,
          itemId: l.itemId,
          itemNameAr: l.itemNameAr,
          isStock: l.isStock,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
          discountPercent: l.discountPercent,
          taxRatePercent: l.taxRatePercent,
          revenueAccountId: l.revenueAccountId,
          cogsAccountId: l.cogsAccountId,
          inventoryAccountId: l.inventoryAccountId,
        })),
      });
      if (shouldConfirm) await confirmInvoice.mutateAsync(created.id);
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر حفظ الفاتورة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SidePanel open={open} onClose={onClose} title="فاتورة مبيعات جديدة" description="بيانات الفاتورة والبنود">
      <div className="flex flex-col gap-[16px]">
        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}

        <EntityPicker id="invoice-customer-picker" label="العميل *" value={customer} onChange={setCustomer} options={customerOptions} placeholder="اختر عميلاً..." />

        <div className="grid grid-cols-2 gap-[10px]">
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">التاريخ *</span>
            <input
              type="text"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mz-num w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">تاريخ الاستحقاق *</span>
            <input
              type="text"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mz-num w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </label>
        </div>

        <SelectField
          label="المستودع"
          value={warehouseId}
          onChange={setWarehouseId}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />

        <div className="flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-[13.5px] font-bold text-ink">بنود الفاتورة</h3>
            <Button size="sm" onClick={addLine}>
              إضافة بند
            </Button>
          </div>
          {lines.map((line, i) => {
            const item = items.find((it) => it.id === line.itemId);
            const selectedOption = item ? { id: item.id, label: item.nameAr, sublabel: item.code } : null;
            const lineTotals = totalsByLineId.get(line.key);
            return (
              <div key={line.key} className="flex flex-col gap-[10px] rounded-lg border border-border p-[12px]">
                <div className="flex items-start gap-[8px]">
                  <div className="flex-1">
                    <EntityPicker
                      id={`invoice-line-item-${line.key}`}
                      label={`الصنف — سطر ${i + 1}`}
                      value={selectedOption}
                      onChange={(opt) => {
                        const picked = opt ? items.find((it) => it.id === opt.id) : null;
                        updateLine(i, { itemId: opt?.id ?? "", unitPrice: picked ? Number(picked.salePrice ?? "0") : null });
                      }}
                      options={itemOptions}
                      placeholder="اختر صنفاً..."
                    />
                  </div>
                  <IconButton
                    aria-label={`حذف السطر ${i + 1}`}
                    disabled={lines.length <= 1}
                    className="mt-[26px]"
                    onClick={() => removeLine(i)}
                  >
                    ✕
                  </IconButton>
                </div>
                {item ? (
                  <>
                    <div className="grid grid-cols-2 gap-[10px]">
                      <label className="flex flex-col gap-[6px]">
                        <span className="text-xs font-semibold text-ink-muted">الكمية</span>
                        <QtyInput
                          aria-label={`الكمية للسطر ${i + 1}`}
                          value={line.qty}
                          onChange={(v) => updateLine(i, { qty: v })}
                          min={0}
                          step={1}
                          unit={unitLabel(item.baseUnitCode)}
                        />
                      </label>
                      <label className="flex flex-col gap-[6px]">
                        <span className="text-xs font-semibold text-ink-muted">السعر</span>
                        <MoneyInput aria-label={`السعر للسطر ${i + 1}`} value={line.unitPrice} onChange={(v) => updateLine(i, { unitPrice: v })} />
                      </label>
                    </div>
                    <NumberField
                      label="خصم %"
                      value={line.discountPercent}
                      onChange={(v) => updateLine(i, { discountPercent: v })}
                      min={0}
                      max={100}
                    />
                    {lineTotals ? (
                      <div className="text-[11.5px] text-ink-muted">
                        الإجمالي: <MoneyDisplay value={toMajor(lineTotals.total.toString())} />
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-[10px]">
          <SelectField
            label="نوع الخصم"
            value={discountType}
            onChange={(v) => setDiscountType(v as SalesInvoiceDiscountType)}
            options={[
              { value: "amount", label: "مبلغ" },
              { value: "percent", label: "نسبة %" },
            ]}
          />
          <NumberField
            label={discountType === "percent" ? "نسبة الخصم %" : "قيمة الخصم"}
            value={discountValue}
            onChange={setDiscountValue}
            min={0}
            max={discountType === "percent" ? 100 : undefined}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-[14px_16px]">
          <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">الإجماليات</h3>
          <dl className="flex flex-col gap-[7px] text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">المجموع الفرعي</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.subtotal.toString())} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">الخصم</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.invoiceDiscountTotal.toString())} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">الضريبة</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.taxTotal.toString())} />
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-[8px] font-bold">
              <dt className="text-ink">الإجمالي الكلي</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.grandTotal.toString())} />
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex justify-end gap-[9px]">
          <Button onClick={onClose}>إلغاء</Button>
          <Button disabled={!canSubmit} onClick={() => handleSave(false)}>
            حفظ كمسودة
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => handleSave(true)}>
            تأكيد الفاتورة
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

function InvoiceDetailView({
  invoice,
  today,
  onBack,
}: {
  invoice: SalesInvoiceDTO;
  today: string;
  onBack: () => void;
}) {
  const accountsQuery = useAccounts();
  const warehousesQuery = useWarehouses();
  const journalEntryQuery = useJournalEntry(invoice.journalEntryId);
  const recordPayment = useRecordSalesInvoicePayment();

  const accounts = accountsQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const remaining = toMajor(invoice.remainingBalance);
  const overdue = isOverdue(invoice, today);
  const canPay = invoice.status === "confirmed" || invoice.status === "partially_paid";

  // The API returns only the invoice-level totals aggregate — recompute the same
  // pure per-line breakdown (tax/total per line) the create form previews with,
  // now over the persisted lines, so the "لبنود الفاتورة" table can show it.
  const lineTotals = useMemo(() => {
    const domainLines: SalesInvoiceLine[] = invoice.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      isStock: l.isStock,
      qty: Qty.fromMajor(l.qty),
      unitPrice: Money.fromMajor(l.unitPrice),
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId,
      inventoryAccountId: l.inventoryAccountId,
      unitCost: l.unitCost ? Money.fromMajor(l.unitCost) : null,
    }));
    const discount: SalesInvoiceDiscount =
      invoice.discount.type === "percent" ? { type: "percent", percent: invoice.discount.percent } : { type: "amount", amount: Money.fromMajor(invoice.discount.amount) };
    const totals = computeInvoiceTotals(domainLines, discount, { taxExempt: invoice.customerTaxExempt });
    return new Map(totals.lines.map((l) => [l.lineId, l]));
  }, [invoice]);

  const accountLabel = (id: string) => {
    const a = accounts.find((acc) => acc.id === id);
    return a ? `${a.code} — ${a.nameAr}` : id;
  };

  async function handleRecordPayment() {
    if (!paymentAmount || paymentAmount <= 0) {
      setPaymentError("قيمة الدفعة يجب أن تكون أكبر من صفر.");
      return;
    }
    setPayBusy(true);
    setPaymentError(null);
    try {
      await recordPayment.mutateAsync({ id: invoice.id, amount: String(paymentAmount) });
      setPaymentAmount(null);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : "تعذر تسجيل الدفعة.");
    } finally {
      setPayBusy(false);
    }
  }

  const effects = [
    invoice.status === "draft"
      ? "فاتورة مسودة — لم تُرحّل بعد. التأكيد يُصدر رقم الفاتورة، يصرف المخزون، ويرحّل القيد المحاسبي."
      : "تم صرف الأصناف المخزنية من المستودع وترحيل القيد المحاسبي (مدين العملاء + تكلفة البضاعة / دائن الإيرادات + الضريبة + المخزون).",
    `الرصيد المتبقي على العميل: ${invoice.remainingBalance}`,
  ];

  return (
    <DocumentDetail
      title={invoice.docNo ?? "فاتورة مبيعات"}
      statusLabel={SALES_INVOICE_STATUS_LABELS_AR[invoice.status]}
      statusTone={STATUS_TONE[invoice.status]}
      subtitle={overdue ? <span className="text-danger-ink">متأخرة السداد</span> : undefined}
      actions={<Button onClick={onBack}>رجوع</Button>}
      summary={[
        { label: "التاريخ", value: <span className="mz-num">{invoice.date}</span> },
        { label: "العميل", value: invoice.customerNameAr },
        { label: "تاريخ الاستحقاق", value: <span className="mz-num">{invoice.dueDate}</span>, valueTone: overdue ? "danger" : "default" },
        { label: "المستودع", value: warehouses.find((w) => w.id === invoice.warehouseId)?.name ?? invoice.warehouseId },
        { label: "الإجمالي", value: <MoneyDisplay value={toMajor(invoice.totals.grandTotal)} /> },
        { label: "الرصيد المتبقي", value: <MoneyDisplay value={remaining} />, valueTone: remaining > 0 ? "danger" : "success" },
      ]}
      effectsTitle="تأثيرات هذه الفاتورة"
      effects={effects}
      tabs={[
        {
          key: "lines",
          label: "بنود الفاتورة",
          content: (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الصنف</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الكمية</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">السعر</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الخصم %</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الضريبة</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((l) => {
                      const lt = lineTotals.get(l.lineId);
                      return (
                        <tr key={l.lineId} className="border-b border-border last:border-b-0">
                          <td className="px-[15px] py-[11px] text-ink">{l.itemNameAr}</td>
                          <td className="mz-num px-[15px] py-[11px] text-end">{l.qty}</td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={toMajor(l.unitPrice)} /></td>
                          <td className="mz-num px-[15px] py-[11px] text-end">{l.discountPercent}</td>
                          <td className="px-[15px] py-[11px] text-end">{lt ? <MoneyDisplay value={toMajor(lt.tax.toString())} /> : "—"}</td>
                          <td className="px-[15px] py-[11px] text-end">{lt ? <MoneyDisplay value={toMajor(lt.total.toString())} /> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-2 font-bold">
                      <td className="px-[15px] py-[11px]" colSpan={5}>الإجمالي الكلي</td>
                      <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={toMajor(invoice.totals.grandTotal)} /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          ),
        },
        {
          key: "gl",
          label: "القيود المحاسبية",
          content: (
            <Card className="p-[16px_18px]">
              {invoice.journalEntryId ? (
                journalEntryQuery.data ? (
                  <>
                    <div className="mb-[12px] text-[13px] text-ink-muted">
                      رقم القيد: <span className="mz-num font-semibold text-ink">{journalEntryQuery.data.entryNo ?? invoice.docNo}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] border-collapse text-[13px]">
                        <thead>
                          <tr>
                            <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الحساب</th>
                            <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">مدين</th>
                            <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">دائن</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journalEntryQuery.data.lines.map((l, i) => (
                            <tr key={i} className="border-b border-border last:border-b-0">
                              <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId)}</td>
                              <td className="px-[15px] py-[11px] text-end">{Number(l.debit) !== 0 ? <MoneyDisplay value={Number(l.debit)} /> : "—"}</td>
                              <td className="px-[15px] py-[11px] text-end">{Number(l.credit) !== 0 ? <MoneyDisplay value={Number(l.credit)} /> : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="p-[20px] text-center text-[12.5px] text-ink-muted">جارٍ تحميل القيد المحاسبي…</div>
                )
              ) : (
                <div className="p-[20px] text-center text-[12.5px] text-ink-muted">لم يتم ترحيل قيد بعد — الفاتورة ما زالت مسودة.</div>
              )}
            </Card>
          ),
        },
        {
          key: "payments",
          label: "المدفوعات",
          content: (
            <div className="flex flex-col gap-[14px]">
              <Card className="p-[16px_18px]">
                <dl className="grid grid-cols-2 gap-[14px] text-[13px] sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">الإجمالي الكلي</dt>
                    <dd className="mt-[4px]"><MoneyDisplay value={toMajor(invoice.totals.grandTotal)} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">المحصل</dt>
                    <dd className="mt-[4px]"><MoneyDisplay value={toMajor(invoice.amountPaid)} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">المتبقي</dt>
                    <dd className="mt-[4px]"><MoneyDisplay value={remaining} /></dd>
                  </div>
                </dl>
              </Card>
              {canPay ? (
                <Card className="p-[16px_18px]">
                  <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">تحصيل دفعة</h3>
                  {paymentError ? (
                    <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                      {paymentError}
                    </div>
                  ) : null}
                  <div className="flex items-end gap-[10px]">
                    <div className="flex-1">
                      <span className="mb-[6px] block text-xs font-semibold text-ink-muted">قيمة الدفعة</span>
                      <MoneyInput aria-label="قيمة الدفعة" value={paymentAmount} onChange={setPaymentAmount} />
                    </div>
                    <Button variant="primary" disabled={payBusy} onClick={handleRecordPayment}>
                      تحصيل دفعة
                    </Button>
                  </div>
                </Card>
              ) : (
                <div className="p-[16px] text-center text-[12.5px] text-ink-muted">لا يمكن تسجيل دفعة في حالة الفاتورة الحالية.</div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* List (main) view                                                    */
/* ------------------------------------------------------------------ */

export function SalesInvoicesScreen() {
  const query = useSalesInvoices();
  const invoices = query.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SalesInvoiceStatusDTO>("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  useScreenIntent(() => setPanelOpen(true));

  const today = new Date().toISOString().slice(0, 10);
  const selected = selectedId ? (invoices.find((inv) => inv.id === selectedId) ?? null) : null;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: invoices.length };
    for (const s of LIST_STATUSES) c[s] = 0;
    for (const inv of invoices) {
      if (c[inv.status] !== undefined) c[inv.status] = (c[inv.status] ?? 0) + 1;
    }
    return c;
  }, [invoices]);

  const kpi = useMemo(() => {
    let sales = 0;
    let collected = 0;
    let remaining = 0;
    for (const inv of invoices) {
      if (inv.status === "draft" || inv.status === "cancelled") continue;
      sales += toMajor(inv.totals.grandTotal);
      collected += toMajor(inv.amountPaid);
      remaining += toMajor(inv.remainingBalance);
    }
    return { sales, collected, remaining };
  }, [invoices]);

  const filtered = useMemo(() => {
    let rows = invoices;
    if (statusFilter !== "all") rows = rows.filter((inv) => inv.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim();
      rows = rows.filter((inv) => (inv.docNo ?? "").toLowerCase().includes(q.toLowerCase()) || inv.customerNameAr.includes(q));
    }
    return rows;
  }, [invoices, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all ?? 0 },
    ...LIST_STATUSES.map((s) => ({ key: s, label: SALES_INVOICE_STATUS_LABELS_AR[s], count: counts[s] ?? 0 })),
  ];

  const columns: DocumentListColumn<SalesInvoiceDTO>[] = [
    {
      key: "docNo",
      header: "رقم الفاتورة",
      sortable: true,
      render: (inv) => (
        <div>
          <div className="mz-num font-semibold text-ink">{inv.docNo ?? "مسودة"}</div>
          <div className="text-[11.5px] text-ink-faint">
            {inv.customerNameAr} · <span className="mz-num">{inv.date}</span>
          </div>
        </div>
      ),
    },
    {
      key: "dueDate",
      header: "تاريخ الاستحقاق",
      render: (inv) => (
        <div className="flex items-center gap-[8px]">
          <span className="mz-num text-ink-muted">{inv.dueDate}</span>
          {isOverdue(inv, today) ? <StatusPill label="متأخر" tone="danger" /> : null}
        </div>
      ),
    },
    {
      key: "remaining",
      header: "الرصيد المتبقي",
      align: "end",
      render: (inv) => <MoneyDisplay value={toMajor(inv.remainingBalance)} />,
      total: (rows) => <MoneyDisplay value={rows.reduce((sum, inv) => sum + toMajor(inv.remainingBalance), 0)} />,
    },
    {
      key: "status",
      header: "الحالة",
      render: (inv) => <StatusPill label={SALES_INVOICE_STATUS_LABELS_AR[inv.status]} tone={STATUS_TONE[inv.status]} />,
    },
  ];

  return (
    <>
      {selected ? (
        <InvoiceDetailView invoice={selected} today={today} onBack={() => setSelectedId(null)} />
      ) : (
        <div className="w-full">
          {query.isError ? (
            <Card className="mb-[18px] p-[18px_20px]">
              <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل فواتير المبيعات.</p>
              <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
                إعادة المحاولة
              </Button>
            </Card>
          ) : null}
          <DocumentList<SalesInvoiceDTO>
            eyebrow="Sales · Invoices"
            title="فواتير المبيعات"
            description="فواتير المبيعات — مسودة ← مؤكد ← مدفوع جزئياً/مدفوع، مرحّلة على SalesInvoiceService الحقيقية (ترقيم + قيد محاسبي + صرف مخزون)"
            actions={
              <Button variant="primary" onClick={() => setPanelOpen(true)}>
                فاتورة جديدة
              </Button>
            }
            stats={[
              { label: "إجمالي الفواتير", value: <span className="mz-num">{invoices.length}</span> },
              { label: "إجمالي المبيعات", value: <MoneyDisplay value={kpi.sales} /> },
              { label: "إجمالي المحصل", value: <MoneyDisplay value={kpi.collected} /> },
              { label: "إجمالي المتبقي", value: <MoneyDisplay value={kpi.remaining} />, valueTone: kpi.remaining > 0 ? "danger" : "default" },
            ]}
            statusChips={statusChips}
            activeStatusKey={statusFilter}
            onStatusChange={(key) => setStatusFilter(key as "all" | SalesInvoiceStatusDTO)}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="بحث برقم الفاتورة أو اسم العميل…"
            columns={columns}
            rows={filtered}
            rowKey={(inv) => inv.id}
            onRowClick={(inv) => setSelectedId(inv.id)}
            page={1}
            pageCount={1}
            pageSummary={
              <>
                عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{invoices.length}</span> فاتورة
              </>
            }
            emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فواتير مطابقة</div>}
          />
        </div>
      )}

      <CreateInvoicePanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}

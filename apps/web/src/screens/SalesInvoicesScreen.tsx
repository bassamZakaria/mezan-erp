import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  DocumentDetail,
  Money as MoneyDisplay,
  StatusPill,
  SidePanel,
  Card,
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
  extend,
  computeInvoiceTotals,
  buildSalesInvoiceGlPosting,
  isOverdue,
  SALES_INVOICE_STATUS_LABELS_AR,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesInvoiceDiscount,
  type SalesInvoiceDiscountType,
  type SalesInvoiceStatus,
  type CreateSalesInvoiceLine,
} from "@mezan/domain";
import { useSalesInvoicesStore } from "../store/useSalesInvoicesStore";
import {
  AR_ACCOUNT_ID,
  TAX_ACCOUNT_ID,
  REVENUE_ACCOUNT_ID,
  COGS_ACCOUNT_ID,
  INVENTORY_ACCOUNT_ID,
  DEFAULT_WAREHOUSE_ID,
  DEFAULT_BRANCH_ID,
} from "../store/sales-invoice-store";
import { unitLabel } from "../items-sample-data";
import { demoUser } from "../sample-data";
import { SelectField, NumberField } from "../settings/form-controls";

/** فواتير المبيعات (Sales Invoices) — docs/catalog/01-sales.md. List + detail (with the
 * "تأثيرات هذه الفاتورة" effects panel) + a create/confirm SidePanel form with live
 * totals, wired to the REAL `SalesInvoiceService` (numbering + GL + stock engines). */

const TODAY = "2026-08-22";

const STATUS_TONE: Record<SalesInvoiceStatus, PillTone> = {
  draft: "neutral",
  pending: "warning",
  confirmed: "success",
  partially_paid: "warning",
  paid: "success",
  cancelled: "danger",
  reversed: "danger",
};

const LIST_STATUSES: SalesInvoiceStatus[] = ["draft", "confirmed", "partially_paid", "paid", "cancelled"];

function toMajor(m: Money): number {
  return Number(m.toString());
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
  store,
  open,
  onClose,
}: {
  store: ReturnType<typeof useSalesInvoicesStore>;
  open: boolean;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState("2026-08-22");
  const [dueDate, setDueDate] = useState("2026-09-21");
  const [warehouseId, setWarehouseId] = useState(DEFAULT_WAREHOUSE_ID);
  const [discountType, setDiscountType] = useState<SalesInvoiceDiscountType>("amount");
  const [discountValue, setDiscountValue] = useState(0);
  const [lines, setLines] = useState<InvoiceLineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setCustomer(null);
    setDate("2026-08-22");
    setDueDate("2026-09-21");
    setWarehouseId(DEFAULT_WAREHOUSE_ID);
    setDiscountType("amount");
    setDiscountValue(0);
    setLines([blankLine()]);
    setError(null);
  }

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  const customerOptions = useMemo<EntityPickerOption[]>(
    () => store.customers.filter((c) => c.active).map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [store.customers],
  );
  const itemOptions = useMemo<EntityPickerOption[]>(
    () =>
      store.items
        .filter((i) => i.status === "active")
        .map((i) => ({ id: i.id, label: i.nameAr, sublabel: `${i.code} · ${i.salePrice ?? "0"} ج.م` })),
    [store.items],
  );

  const customerData = customer ? (store.customers.find((c) => c.id === customer.id) ?? null) : null;

  const domainLines = useMemo<SalesInvoiceLine[]>(() => {
    const out: SalesInvoiceLine[] = [];
    for (const l of lines) {
      const item = store.items.find((i) => i.id === l.itemId);
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
  }, [lines, store.items]);

  const discount: SalesInvoiceDiscount = useMemo(
    () =>
      discountType === "percent"
        ? { type: "percent", percent: discountValue || 0 }
        : { type: "amount", amount: Money.fromMajor(String(discountValue || 0)) },
    [discountType, discountValue],
  );

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

  function buildCommandLines(): CreateSalesInvoiceLine[] {
    return domainLines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      isStock: l.isStock,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId,
      inventoryAccountId: l.inventoryAccountId,
    }));
  }

  async function handleSave(confirm: boolean) {
    if (!customer || !customerData) {
      setError("العميل مطلوب.");
      return;
    }
    setBusy(true);
    setError(null);
    const id = crypto.randomUUID();
    const cmd = {
      id,
      date,
      dueDate,
      customerId: customer.id,
      customerNameAr: customerData.nameAr,
      customerTaxExempt: customerData.taxExempt,
      warehouseId,
      branchId: DEFAULT_BRANCH_ID,
      currency: customerData.currency,
      discount,
      arAccountId: AR_ACCOUNT_ID,
      taxAccountId: TAX_ACCOUNT_ID,
      lines: buildCommandLines(),
    };
    const result = confirm ? await store.createAndConfirm(cmd) : await store.createDraft(cmd);
    setBusy(false);
    if (result.ok) {
      resetForm();
      onClose();
    } else {
      setError(result.error ?? "تعذر حفظ الفاتورة.");
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
          options={store.warehouses.map((w) => ({ value: w.id, label: w.name }))}
        />

        <div className="flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-[13.5px] font-bold text-ink">بنود الفاتورة</h3>
            <Button size="sm" onClick={addLine}>
              إضافة بند
            </Button>
          </div>
          {lines.map((line, i) => {
            const item = store.items.find((it) => it.id === line.itemId);
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
                        const picked = opt ? store.items.find((it) => it.id === opt.id) : null;
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
                        الإجمالي: <MoneyDisplay value={toMajor(lineTotals.total)} />
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
                <MoneyDisplay value={toMajor(totals.subtotal)} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">الخصم</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.invoiceDiscountTotal)} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">الضريبة</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.taxTotal)} />
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-[8px] font-bold">
              <dt className="text-ink">الإجمالي الكلي</dt>
              <dd>
                <MoneyDisplay value={toMajor(totals.grandTotal)} />
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
  store,
  invoice,
  onBack,
}: {
  store: ReturnType<typeof useSalesInvoicesStore>;
  invoice: SalesInvoice;
  onBack: () => void;
}) {
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const totals = store.service.totalsOf(invoice);
  const remaining = Money.fromScaled(totals.grandTotal.scaled - invoice.amountPaid.scaled);
  const effects = store.service.effectsOf(invoice);
  const overdue = isOverdue(invoice, TODAY);
  const canPay = invoice.status === "confirmed" || invoice.status === "partially_paid";

  const accountLabel = (id: string) => {
    const a = store.accounts.find((acc) => acc.id === id);
    return a ? `${a.code} — ${a.nameAr}` : id;
  };

  const cogsLines = invoice.lines
    .filter((l): l is SalesInvoiceLine & { cogsAccountId: string; inventoryAccountId: string } => l.isStock && !!l.cogsAccountId && !!l.inventoryAccountId)
    .map((l) => ({ cogsAccountId: l.cogsAccountId, inventoryAccountId: l.inventoryAccountId, cost: extend(l.qty, l.unitCost ?? Money.zero()) }));
  const posting = invoice.journalEntryId ? buildSalesInvoiceGlPosting(invoice, totals, cogsLines) : null;

  async function handleRecordPayment() {
    if (!paymentAmount || paymentAmount <= 0) {
      setPaymentError("قيمة الدفعة يجب أن تكون أكبر من صفر.");
      return;
    }
    setPayBusy(true);
    setPaymentError(null);
    const result = await store.recordPayment(invoice.id, Money.fromMajor(String(paymentAmount)));
    setPayBusy(false);
    if (result.ok) setPaymentAmount(null);
    else setPaymentError(result.error ?? "تعذر تسجيل الدفعة.");
  }

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
        { label: "المستودع", value: store.warehouses.find((w) => w.id === invoice.warehouseId)?.name ?? invoice.warehouseId },
        { label: "الإجمالي", value: <MoneyDisplay value={toMajor(totals.grandTotal)} /> },
        { label: "الرصيد المتبقي", value: <MoneyDisplay value={toMajor(remaining)} />, valueTone: remaining.scaled > 0n ? "danger" : "success" },
      ]}
      effectsTitle="تأثيرات هذه الفاتورة"
      effects={effects.effects.map((e) => e.description)}
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
                    {invoice.lines.map((l, i) => {
                      const lt = totals.lines[i];
                      return (
                        <tr key={l.lineId} className="border-b border-border last:border-b-0">
                          <td className="px-[15px] py-[11px] text-ink">{l.itemNameAr}</td>
                          <td className="mz-num px-[15px] py-[11px] text-end">{l.qty.toString()}</td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={toMajor(l.unitPrice)} /></td>
                          <td className="mz-num px-[15px] py-[11px] text-end">{l.discountPercent}</td>
                          <td className="px-[15px] py-[11px] text-end">{lt ? <MoneyDisplay value={toMajor(lt.tax)} /> : "—"}</td>
                          <td className="px-[15px] py-[11px] text-end">{lt ? <MoneyDisplay value={toMajor(lt.total)} /> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-surface-2 font-bold">
                      <td className="px-[15px] py-[11px]" colSpan={5}>الإجمالي الكلي</td>
                      <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={toMajor(totals.grandTotal)} /></td>
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
              {posting ? (
                <>
                  <div className="mb-[12px] text-[13px] text-ink-muted">
                    رقم القيد: <span className="mz-num font-semibold text-ink">{invoice.journalEntryId}</span>
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
                        {posting.lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId)}</td>
                            <td className="px-[15px] py-[11px] text-end">{l.debit.scaled !== 0n ? <MoneyDisplay value={toMajor(l.debit)} /> : "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{l.credit.scaled !== 0n ? <MoneyDisplay value={toMajor(l.credit)} /> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
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
                    <dd className="mt-[4px]"><MoneyDisplay value={toMajor(totals.grandTotal)} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">المحصل</dt>
                    <dd className="mt-[4px]"><MoneyDisplay value={toMajor(invoice.amountPaid)} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">المتبقي</dt>
                    <dd className="mt-[4px]"><MoneyDisplay value={toMajor(remaining)} /></dd>
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
  const store = useSalesInvoicesStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SalesInvoiceStatus>("all");
  const [search, setSearch] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);

  const selected = selectedId ? (store.invoices.find((inv) => inv.id === selectedId) ?? null) : null;

  function remainingOf(inv: SalesInvoice): Money {
    const grandTotal = store.service.totalsOf(inv).grandTotal;
    return Money.fromScaled(grandTotal.scaled - inv.amountPaid.scaled);
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: store.invoices.length };
    for (const s of LIST_STATUSES) c[s] = 0;
    for (const inv of store.invoices) {
      if (c[inv.status] !== undefined) c[inv.status] = (c[inv.status] ?? 0) + 1;
    }
    return c;
  }, [store.invoices]);

  const kpi = useMemo(() => {
    let sales = 0n;
    let collected = 0n;
    let remaining = 0n;
    for (const inv of store.invoices) {
      if (inv.status === "draft" || inv.status === "cancelled") continue;
      const grandTotal = store.service.totalsOf(inv).grandTotal.scaled;
      sales += grandTotal;
      collected += inv.amountPaid.scaled;
      remaining += grandTotal - inv.amountPaid.scaled;
    }
    return { sales: Money.fromScaled(sales), collected: Money.fromScaled(collected), remaining: Money.fromScaled(remaining) };
  }, [store.invoices, store.service]);

  const filtered = useMemo(() => {
    let rows = store.invoices;
    if (statusFilter !== "all") rows = rows.filter((inv) => inv.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim();
      rows = rows.filter((inv) => (inv.docNo ?? "").toLowerCase().includes(q.toLowerCase()) || inv.customerNameAr.includes(q));
    }
    return rows;
  }, [store.invoices, statusFilter, search]);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: counts.all ?? 0 },
    ...LIST_STATUSES.map((s) => ({ key: s, label: SALES_INVOICE_STATUS_LABELS_AR[s], count: counts[s] ?? 0 })),
  ];

  const columns: DocumentListColumn<SalesInvoice>[] = [
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
          {isOverdue(inv, TODAY) ? <StatusPill label="متأخر" tone="danger" /> : null}
        </div>
      ),
    },
    {
      key: "remaining",
      header: "الرصيد المتبقي",
      align: "end",
      render: (inv) => <MoneyDisplay value={toMajor(remainingOf(inv))} />,
    },
    {
      key: "status",
      header: "الحالة",
      render: (inv) => <StatusPill label={SALES_INVOICE_STATUS_LABELS_AR[inv.status]} tone={STATUS_TONE[inv.status]} />,
    },
    {
      key: "by",
      header: "بواسطة",
      render: () => demoUser.name,
    },
  ];

  return (
    <>
      {selected ? (
        <InvoiceDetailView store={store} invoice={selected} onBack={() => setSelectedId(null)} />
      ) : (
        <div className="w-full">
          <DocumentList<SalesInvoice>
            eyebrow="Sales · Invoices"
            title="فواتير المبيعات"
            description="فواتير المبيعات — مسودة ← مؤكد ← مدفوع جزئياً/مدفوع، مرحّلة على SalesInvoiceService الحقيقية (ترقيم + قيد محاسبي + صرف مخزون)"
            actions={
              <Button variant="primary" onClick={() => setPanelOpen(true)}>
                فاتورة جديدة
              </Button>
            }
            stats={[
              { label: "إجمالي الفواتير", value: <span className="mz-num">{store.invoices.length}</span> },
              { label: "إجمالي المبيعات", value: <MoneyDisplay value={toMajor(kpi.sales)} /> },
              { label: "إجمالي المحصل", value: <MoneyDisplay value={toMajor(kpi.collected)} /> },
              { label: "إجمالي المتبقي", value: <MoneyDisplay value={toMajor(kpi.remaining)} />, valueTone: kpi.remaining.scaled > 0n ? "danger" : "default" },
            ]}
            statusChips={statusChips}
            activeStatusKey={statusFilter}
            onStatusChange={(key) => setStatusFilter(key as "all" | SalesInvoiceStatus)}
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
                عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{store.invoices.length}</span> فاتورة
              </>
            }
            emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فواتير مطابقة</div>}
          />
        </div>
      )}

      <CreateInvoicePanel store={store} open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}

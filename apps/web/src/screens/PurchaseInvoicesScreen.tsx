import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  Money as MoneyValue,
  StatusPill,
  SidePanel,
  Chip,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type EntityPickerOption,
  Qty as QtyDisplay,
} from "@mezan/ui";
import type {
  GoodsReceiptDTO,
  PurchaseInvoiceDTO,
  PurchaseInvoiceLineDTO,
  PurchaseInvoiceListQueryDTO,
  PurchaseInvoiceStatusDTO,
} from "@mezan/contracts";
import {
  useConfirmPurchaseInvoice,
  useCreatePurchaseInvoice,
  useGoodsReceipts,
  useItems,
  usePurchaseInvoices,
  usePurchaseInvoiceCounts,
  usePurchaseInvoiceStats,
  useSuppliers,
  useUsers,
  useBranches,
  useWarehouses,
} from "../data/hooks";
import { majorOf } from "../lib/money";
import { useDebounced } from "../lib/use-debounced";
import { useWorkingLocation } from "../data/hub-hooks";
import { SelectField, TextField, NumberField } from "../settings/form-controls";
import { useScreenIntent, useSubPage } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { itemTypeIsPurchasable } from "@mezan/domain";

/** Document states plus the payment states derived from the allocation sub-ledger. */
type PurchaseInvoiceFilterKey = PurchaseInvoiceStatusDTO | "all" | "overdue" | "due_soon" | "partially_paid" | "paid";

const STATUS_KEY: Record<PurchaseInvoiceStatusDTO, AppTranslationKey> = {
  draft: "purchaseInvoices.status.draft",
  confirmed: "purchaseInvoices.status.confirmed",
  cancelled: "purchaseInvoices.status.cancelled",
};
const STATUS_TONE: Record<PurchaseInvoiceStatusDTO, PillTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

const num = (v: string) => Number(v);
const lineBase = (l: PurchaseInvoiceLineDTO) => Number(l.qty) * Number(l.unitCost);
const lineTax = (l: PurchaseInvoiceLineDTO) => (lineBase(l) * l.taxRatePercent) / 100;

interface DraftLine {
  itemId: string;
  kind: "inventory" | "expense";
  qty: number;
  unitCost: number;
  taxRatePercent: number;
  description: string;
}

interface PreviewLine {
  itemId: string | null;
  qty: number;
  unitCost: number;
  taxRatePercent: number;
}

function InvoiceDetail({
  invoice,
  supplierName,
  itemName,
  onBack,
  onConfirm,
}: {
  invoice: PurchaseInvoiceDTO;
  supplierName: (id: string) => string;
  itemName: (id: string | null) => string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <DocumentDetail
      title={t("purchaseInvoices.detailTitle", { number: invoice.number })}
      statusLabel={t(STATUS_KEY[invoice.status])}
      statusTone={STATUS_TONE[invoice.status]}
      subtitle={`${supplierName(invoice.supplierId)} · ${invoice.date.split("-").reverse().join("/")}`}
      actions={
        <>
          {invoice.status === "draft" ? (
            <Button variant="primary" onClick={onConfirm}>
              {t("purchaseInvoices.confirm")}
            </Button>
          ) : null}
          <Button onClick={onBack}>{t("purchaseInvoices.backToList")}</Button>
        </>
      }
      summary={[
        { label: t("common.supplier"), value: supplierName(invoice.supplierId) },
        { label: t("common.date"), value: invoice.date.split("-").reverse().join("/") },
        { label: t("purchaseInvoices.detail.dueDate"), value: invoice.dueDate?.split("-").reverse().join("/") ?? "—" },
        { label: t("purchaseInvoices.detail.supplierInvoiceNo"), value: invoice.supplierInvoiceNumber ?? "—" },
        { label: t("purchaseInvoices.detail.source"), value: invoice.receiptId ? t("purchaseInvoices.source.fromReceipt") : t("purchaseInvoices.source.manual") },
        { label: t("purchaseInvoices.detail.grandTotal"), value: <MoneyValue value={num(invoice.total)} /> },
      ]}
      effects={[
        invoice.receiptId
          ? t("purchaseInvoices.effect.alreadyStocked")
          : t("purchaseInvoices.effect.stockIn"),
        t("purchaseInvoices.effect.payable"),
        t("purchaseInvoices.effect.noPayment"),
      ]}
      tabs={[
        {
          key: "lines",
          label: t("purchaseInvoices.tab.lines", { count: invoice.lines.length }),
          content: (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-start">{t("common.type")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.qty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.unitCost")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.taxPct")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[10px]">{l.kind === "expense" ? (l.description ?? t("purchaseInvoices.expense")) : itemName(l.itemId)}</td>
                      <td className="px-[12px] py-[10px]">{l.kind === "inventory" ? t("purchaseInvoices.kind.inventory") : t("purchaseInvoices.kind.expense")}</td>
                      <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.qty} /></td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                      <td className="mz-num px-[12px] py-[10px] text-end">{l.taxRatePercent}</td>
                      <td className="px-[12px] py-[10px] text-end"><MoneyValue value={lineBase(l) + lineTax(l)} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-[12px] py-[10px]" colSpan={5}>{t("purchaseInvoices.totalsRow")}</td>
                    <td className="px-[12px] py-[10px] text-end">
                      <div><MoneyValue value={num(invoice.subtotal)} showUnit={false} /></div>
                      <div className="text-ink-muted"><MoneyValue value={num(invoice.tax)} showUnit={false} /></div>
                      <div><MoneyValue value={num(invoice.total)} showUnit={false} /></div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ),
        },
      ]}
    />
  );
}

export function PurchaseInvoicesScreen() {
  const { t } = useAppTranslation();
  const workingLocation = useWorkingLocation();
  const receiptsQuery = useGoodsReceipts();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createInvoice = useCreatePurchaseInvoice();
  const confirmInvoice = useConfirmPurchaseInvoice();

  const receipts = receiptsQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const supplierName = useMemo(() => {
    const map = new Map(suppliers.map((s) => [s.id, s.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [suppliers]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : "—");
  }, [items]);

  const supplierOptions: EntityPickerOption[] = suppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }));
  // A finished good is produced, not bought; a recipe is neither.
  const itemOptions: EntityPickerOption[] = items.filter((i) => itemTypeIsPurchasable(i.type)).map((i) => ({ id: i.id, label: i.nameAr }));
  const confirmedReceipts: GoodsReceiptDTO[] = receipts.filter((r) => r.status === "confirmed" && !r.invoiced);
  const receiptOptions: EntityPickerOption[] = confirmedReceipts.map((r) => ({
    id: r.id,
    label: `${r.number} · ${supplierName(r.supplierId)}`,
    sublabel: r.date,
  }));

  const users = useUsers().data ?? [];
  const filterBranches = useBranches().data ?? [];
  const filterWarehouses = useWarehouses().data ?? [];
  const [branchFilter, setBranchFilter] = useState("");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const userName = (id: string) => users.find((u) => u.id === id)?.fullName ?? id;

  const [statusFilter, setStatusFilter] = useState<PurchaseInvoiceFilterKey>("all");
  const [search, setSearch] = useState("");

  /**
   * One filter object drives the rows, the chip counts and the KPI strip
   * (R1.1). They used to be three separate derivations — the KPI memo ran over
   * every invoice the server had sent while the table was narrowed on the
   * client, so choosing a supplier or a date range never moved the totals.
   */
  const debouncedSearch = useDebounced(search);
  const listFilter: PurchaseInvoiceListQueryDTO = useMemo(
    () => ({
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
      ...(supplierFilter ? { supplierId: supplierFilter } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(branchFilter ? { branchId: branchFilter } : {}),
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    }),
    [statusFilter, supplierFilter, fromDate, toDate, branchFilter, warehouseFilter, debouncedSearch],
  );
  const query = usePurchaseInvoices(listFilter);
  const counts = usePurchaseInvoiceCounts(listFilter).data ?? {};
  const stats = usePurchaseInvoiceStats(listFilter).data ?? null;
  const invoices = query.data ?? [];
  // `#/…/<screen>` · `…/new` · `…/<docNo|id>` — a create form and a document are places, not overlays.
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  const prefilledSupplierId = firstSegment === "new" ? (subPage.segments[1] ?? null) : null;
  useScreenIntent((intent) => {
    const supplierId = intent.prefill?.supplierId;
    openCreate(...(supplierId ? [supplierId] : []));
  });
  const [method, setMethod] = useState<"manual" | "from-receipt">("manual");
  /**
   * Arriving from «فاتورة مشتريات جديدة» on a supplier's page, the supplier is
   * already known and rides in the URL. Derived, not synchronised: `undefined`
   * means the user has not touched the picker.
   */
  const [supplierChoice, setSupplierChoice] = useState<EntityPickerOption | null | undefined>(undefined);
  const supplier =
    supplierChoice !== undefined ? supplierChoice : (supplierOptions.find((option) => option.id === prefilledSupplierId) ?? null);
  const setSupplier = setSupplierChoice;
  const [pickedReceipt, setPickedReceipt] = useState<EntityPickerOption | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }]);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = selectedId === null ? null : (invoices.find((inv) => inv.id === selectedId || inv.number === selectedId) ?? null);

  // create-from-receipt preview only — the server auto-fills the real lines from the confirmed receipt when `lines` is omitted.
  const receiptLines: PreviewLine[] = useMemo(() => {
    const receipt = confirmedReceipts.find((r) => r.id === pickedReceipt?.id);
    if (!receipt) return [];
    return receipt.lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unitCost: Number(l.unitCost), taxRatePercent: 0 }));
  }, [pickedReceipt, confirmedReceipts]);

  /**
   * The list had a document-state dimension only (draft / confirmed /
   * cancelled) and no payment one at all, so there was no way to ask "what do
   * we still owe, and what is late?" — the question the screen exists for
   * (R4.1). Payment state is derived from the allocation sub-ledger, which is
   * the only place a supplier payment is recorded.
   */
  const payment = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const settled = (inv: PurchaseInvoiceDTO) => num(inv.remainingBalance) <= 0;
    const live = (inv: PurchaseInvoiceDTO) => inv.status === "confirmed";
    return {
      overdue: (inv: PurchaseInvoiceDTO) => live(inv) && !settled(inv) && inv.dueDate !== null && inv.dueDate < today,
      dueSoon: (inv: PurchaseInvoiceDTO) => {
        if (!live(inv) || settled(inv) || inv.dueDate === null) return false;
        const horizon = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
        return inv.dueDate >= today && inv.dueDate <= horizon;
      },
      partiallyPaid: (inv: PurchaseInvoiceDTO) => live(inv) && num(inv.amountPaid) > 0 && !settled(inv),
      paid: (inv: PurchaseInvoiceDTO) => live(inv) && settled(inv),
    };
  }, []);

  const filtered = useMemo(() => [...invoices].sort((a, b) => b.number.localeCompare(a.number)), [invoices]);

  const money = {
    purchases: majorOf(stats?.purchases),
    paid: majorOf(stats?.paid),
    unpaid: majorOf(stats?.unpaid),
  };

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "overdue", label: t("purchaseInvoices.status.overdue"), count: counts.overdue ?? 0 },
    { key: "due_soon", label: t("purchaseInvoices.status.dueSoon"), count: counts.due_soon ?? 0 },
    ...(Object.keys(STATUS_KEY) as PurchaseInvoiceStatusDTO[]).map((s) => ({
      key: s,
      label: t(STATUS_KEY[s]),
      count: counts[s] ?? 0,
    })),
    { key: "partially_paid", label: t("purchaseInvoices.status.partiallyPaid"), count: counts.partially_paid ?? 0 },
    { key: "paid", label: t("purchaseInvoices.status.paid"), count: counts.paid ?? 0 },
  ];

  const columns: DocumentListColumn<PurchaseInvoiceDTO>[] = [
    { key: "number", header: t("purchaseInvoices.col.number"), render: (inv) => <span className="mz-num font-semibold text-ink">{inv.number}</span> },
    { key: "supplier", header: t("common.supplier"), render: (inv) => supplierName(inv.supplierId) },
    { key: "date", header: t("common.date"), render: (inv) => <span className="mz-num">{inv.date.split("-").reverse().join("/")}</span> },
    { key: "total", header: t("common.total"), align: "end", render: (inv) => <MoneyValue value={num(inv.total)} /> },
    {
      key: "dueDate",
      header: t("salesInvoices.col.dueDate"),
      render: (inv) => <span className="mz-num">{inv.dueDate ? inv.dueDate.split("-").reverse().join("/") : "—"}</span>,
    },
    { key: "status", header: t("common.status"), render: (inv) => <StatusPill label={t(STATUS_KEY[inv.status])} tone={STATUS_TONE[inv.status]} /> },
    { key: "createdBy", header: t("common.createdBy"), render: (inv) => <span className="text-ink-muted">{userName(inv.createdBy)}</span> },
  ];

  function openCreate(supplierId?: string) {
    setMethod("manual");
    // `undefined` = untouched, so a supplier carried in from the supplier's page applies.
    setSupplierChoice(undefined);
    setPickedReceipt(null);
    setDate(new Date().toISOString().slice(0, 10));
    setSupplierInvoiceNumber("");
    setLines([{ itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }]);
    setFormError(null);
    subPage.open(...(supplierId ? ["new", supplierId] : ["new"]));
  }

  async function confirmSelected(id: string) {
    try {
      await confirmInvoice.mutateAsync(id);
    } catch {
      // failure surfaces via the mutation's own error state on retry; nothing further to do here.
    }
  }

  const manualSubtotal = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
  const canSave =
    method === "from-receipt"
      ? pickedReceipt !== null && receiptLines.length > 0
      : supplier !== null && lines.some((l) => l.qty > 0 && (l.kind === "expense" || l.itemId !== ""));

  async function save() {
    setFormError(null);
    if (!workingLocation.branchId || !workingLocation.warehouseId) {
      setFormError(t("purchaseInvoices.error.noScope"));
      return;
    }
    try {
      if (method === "from-receipt") {
        const receipt = confirmedReceipts.find((r) => r.id === pickedReceipt?.id);
        if (!receipt || receiptLines.length === 0) return;
        await createInvoice.mutateAsync({
          id: crypto.randomUUID(),
          supplierId: receipt.supplierId,
          date,
          branchId: workingLocation.branchId ?? "",
          warehouseId: workingLocation.warehouseId ?? "",
          supplierInvoiceNumber: supplierInvoiceNumber.trim() === "" ? null : supplierInvoiceNumber.trim(),
          receiptId: receipt.id,
        });
      } else {
        if (!supplier) return;
        const usable = lines.filter((l) => l.qty > 0 && (l.kind === "expense" || l.itemId !== ""));
        if (usable.length === 0) return;
        await createInvoice.mutateAsync({
          id: crypto.randomUUID(),
          supplierId: supplier.id,
          date,
          branchId: workingLocation.branchId ?? "",
          warehouseId: workingLocation.warehouseId ?? "",
          supplierInvoiceNumber: supplierInvoiceNumber.trim() === "" ? null : supplierInvoiceNumber.trim(),
          lines: usable.map((l) => ({
            itemId: l.kind === "expense" ? null : l.itemId,
            description: l.description.trim() === "" ? null : l.description.trim(),
            kind: l.kind,
            qty: String(l.qty),
            unitCost: String(l.unitCost || 0),
            taxRatePercent: l.taxRatePercent,
          })),
        });
      }
      subPage.close();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("purchaseInvoices.error.saveFailed"));
    }
  }

  const createPage = (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.purchases.invoices")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("purchaseInvoices.panel.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("purchaseInvoices.panel.description")}</p>
        </div>
        <Button variant="default" onClick={subPage.close}>
          {t("quotes.backToList")}
        </Button>
      </div>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        <div className="flex flex-col gap-[6px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("purchaseInvoices.methodHeading")}</span>
          <div className="flex gap-[8px]">
            <Chip type="button" active={method === "manual"} onClick={() => setMethod("manual")}>{t("purchaseInvoices.method.manual")}</Chip>
            <Chip type="button" active={method === "from-receipt"} onClick={() => setMethod("from-receipt")}>{t("purchaseInvoices.method.fromReceipt")}</Chip>
          </div>
        </div>

        {method === "from-receipt" ? (
          <>
            <EntityPicker label={t("purchaseInvoices.field.receipt")} value={pickedReceipt} onChange={setPickedReceipt} options={receiptOptions} placeholder={t("purchaseInvoices.field.receiptPlaceholder")} emptyMessage={t("purchaseInvoices.field.receiptEmpty")} />
            {receiptLines.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-[12px]">
                <div className="mb-[8px] text-[12.5px] font-semibold text-ink">{t("purchaseInvoices.linesAuto")}</div>
                <table className="w-full border-collapse text-[12.5px]">
                  <tbody>
                    {receiptLines.map((l, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0">
                        <td className="py-[7px]">{itemName(l.itemId)}</td>
                        <td className="py-[7px] text-end"><QtyDisplay value={l.qty} /></td>
                        <td className="py-[7px] text-end"><MoneyValue value={l.unitCost} showUnit={false} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <EntityPicker label={t("purchaseInvoices.field.supplier")} value={supplier} onChange={setSupplier} options={supplierOptions} placeholder={t("purchaseInvoices.field.supplierPlaceholder")} />
            {lines.map((line, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface p-[12px]">
                <div className="mb-[8px] flex gap-[8px]">
                  <Chip type="button" active={line.kind === "inventory"} onClick={() => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, kind: "inventory" } : l)))}>{t("purchaseInvoices.kind.inventory")}</Chip>
                  <Chip type="button" active={line.kind === "expense"} onClick={() => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, kind: "expense", taxRatePercent: 0 } : l)))}>{t("purchaseInvoices.kind.expense")}</Chip>
                </div>
                {line.kind === "inventory" ? (
                  <EntityPicker
                    label={t("common.item")}
                    value={itemOptions.find((o) => o.id === line.itemId) ?? null}
                    onChange={(opt) => {
                      const item = items.find((it) => it.id === opt?.id);
                      setLines((prev) =>
                        prev.map((l, j) =>
                          j === i
                            ? {
                                ...l,
                                itemId: opt?.id ?? "",
                                unitCost: item?.costPrice ? Number(item.costPrice) : l.unitCost,
                                taxRatePercent: item?.taxRatePercent ?? l.taxRatePercent,
                              }
                            : l,
                        ),
                      );
                    }}
                    options={itemOptions}
                    placeholder={t("purchaseInvoices.field.itemPlaceholder")}
                  />
                ) : (
                  <TextField label={t("purchaseInvoices.field.expenseDescription")} value={line.description} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, description: v } : l)))} placeholder={t("purchaseInvoices.field.expensePlaceholder")} />
                )}
                <div className="mt-[10px] grid grid-cols-3 gap-[8px]">
                  <NumberField label={t("common.qty")} value={line.qty} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, qty: v } : l)))} />
                  <NumberField label={t("purchaseInvoices.field.cost")} value={line.unitCost} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitCost: v } : l)))} />
                  <NumberField label={t("purchaseInvoices.col.taxPct")} value={line.taxRatePercent} min={0} onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, taxRatePercent: v } : l)))} />
                </div>
                {lines.length > 1 ? (
                  <div className="mt-[8px] flex justify-end">
                    <Button onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>{t("purchaseInvoices.deleteLine")}</Button>
                  </div>
                ) : null}
              </div>
            ))}
            <Button onClick={() => setLines((prev) => [...prev, { itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }])}>{t("purchaseInvoices.addLine")}</Button>
            <div className="flex items-center justify-between border-t border-border pt-[10px]">
              <span className="text-[12.5px] text-ink-muted">{t("purchaseInvoices.subtotalBeforeTax")}</span>
              <MoneyValue value={manualSubtotal} />
            </div>
          </>
        )}

        <TextField label={t("purchaseInvoices.field.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label={t("purchaseInvoices.detail.supplierInvoiceNo")} value={supplierInvoiceNumber} onChange={setSupplierInvoiceNumber} />
        <div className="flex justify-end gap-[9px]">
          <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={save} disabled={!canSave}>{t("purchaseInvoices.saveDraft")}</Button>
        </div>
      </div>
    </div>
  );

  if (firstSegment === "new") return createPage;

  if (selected) {
    return (
      <>
        <InvoiceDetail invoice={selected} supplierName={supplierName} itemName={itemName} onBack={() => subPage.close()} onConfirm={() => confirmSelected(selected.id)} />
      </>
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("purchaseInvoices.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<PurchaseInvoiceDTO>
        title={t("purchaseInvoices.title")}
        description={t("purchaseInvoices.description")}
        actions={
          <Button variant="primary" onClick={() => openCreate()}>
            {t("purchaseInvoices.new")}
          </Button>
        }
        stats={[
          // Money, not document counts: what was bought, what has been paid and
          // what is still owed, so the strip answers the cash question (R4.1).
          { label: t("purchaseInvoices.stat.purchases"), value: <MoneyValue value={money.purchases} showUnit={false} /> },
          { label: t("purchaseInvoices.stat.paidToSuppliers"), value: <MoneyValue value={money.paid} showUnit={false} /> },
          { label: t("purchaseInvoices.stat.unpaidBalance"), value: <MoneyValue value={money.unpaid} showUnit={false} />, valueTone: money.unpaid > 0 ? "danger" : "default" },
          { label: t("purchaseInvoices.stat.total"), value: <span className="mz-num">{invoices.length}</span> },
        ]}
        attentionBanners={[
          {
            key: "overdue",
            label: t("purchaseInvoices.banner.overdue", { count: counts.overdue ?? 0 }),
            count: counts.overdue ?? 0,
            tone: "danger",
            onApply: () => setStatusFilter("overdue"),
          },
          {
            key: "due_soon",
            label: t("purchaseInvoices.banner.dueSoon", { count: counts.due_soon ?? 0 }),
            count: counts.due_soon ?? 0,
            tone: "warning",
            onApply: () => setStatusFilter("due_soon"),
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as PurchaseInvoiceStatusDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("purchaseInvoices.searchPlaceholder")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <SelectField
              label={t("common.branch")}
              value={branchFilter}
              onChange={setBranchFilter}
              options={[{ value: "", label: t("common.allBranches") }, ...filterBranches.map((b) => ({ value: b.id, label: b.name }))]}
            />
            <SelectField
              label={t("common.warehouse")}
              value={warehouseFilter}
              onChange={setWarehouseFilter}
              options={[{ value: "", label: t("common.allWarehouses") }, ...filterWarehouses.map((w) => ({ value: w.id, label: w.name }))]}
            />
            <SelectField
              label={t("common.supplier")}
              value={supplierFilter}
              onChange={setSupplierFilter}
              options={[{ value: "", label: t("common.allSuppliers") }, ...suppliers.map((sup) => ({ value: sup.id, label: sup.nameAr }))]}
            />
            <TextField label={t("common.fromDate")} value={fromDate} onChange={setFromDate} type="date" />
            <TextField label={t("common.toDate")} value={toDate} onChange={setToDate} type="date" />
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(inv) => inv.id}
        onRowClick={(inv) => subPage.open(inv.number ?? inv.id)}
        page={1}
        pageCount={1}
        pageSummary={<>{t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{invoices.length}</span> {t("purchaseInvoices.showingSuffix")}</>}
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("purchaseInvoices.empty")}</div>}
      />
    </>
  );
}

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  DocumentDetail,
  EmptyState,
  Money as MoneyValue,
  RowMenu,
  StatusPill,
  SidePanel,
  Chip,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type EntityPickerOption,
  type RowMenuItem,
  Qty as QtyDisplay,
} from "@mezan/ui";
import type {
  GoodsReceiptDTO,
  LandedCostDistributionMethodDTO,
  LandedCostTypeDTO,
  PurchaseInvoiceDTO,
  PurchaseInvoiceLineDTO,
  PurchaseInvoiceLineFulfilmentDTO,
  PurchaseInvoiceListQueryDTO,
  PurchaseInvoicePaymentDTO,
  PurchaseInvoiceStatusDTO,
} from "@mezan/contracts";
import {
  useConfirmPurchaseInvoice,
  useCreatePurchaseInvoice,
  useGoodsReceipts,
  useItems,
  useLandedCosts,
  usePayPurchaseInvoice,
  usePurchaseInvoices,
  usePurchaseInvoiceCounts,
  usePurchaseInvoiceFulfilment,
  usePurchaseInvoiceStats,
  useSuppliers,
  useTreasuryAccounts,
  useUsers,
  useBranches,
  useWarehouses,
  useAllowedCurrencies,
} from "../data/hooks";
import { majorOf } from "../lib/money";
import { useDebounced } from "../lib/use-debounced";
import { useWorkingLocation } from "../data/hub-hooks";
import { SelectField, TextField, NumberField } from "../settings/form-controls";
import { PurchaseInvoicePrintPage } from "../print/documents";
import { useNavigation, useScreenIntent, useSubPage } from "../navigation";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { itemTypeIsPurchasable ,
  findCurrency} from "@mezan/domain";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

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

const LANDED_COST_TYPE_KEY: Record<LandedCostTypeDTO, AppTranslationKey> = {
  SHIPPING: "landedCosts.type.SHIPPING",
  CUSTOMS: "landedCosts.type.CUSTOMS",
  INSURANCE: "landedCosts.type.INSURANCE",
  CLEARANCE: "landedCosts.type.CLEARANCE",
  OTHER: "landedCosts.type.OTHER",
};

const LANDED_COST_BASIS_KEY: Record<LandedCostDistributionMethodDTO, AppTranslationKey> = {
  BY_VALUE: "landedCosts.method.BY_VALUE",
  BY_QUANTITY: "landedCosts.method.BY_QUANTITY",
  BY_WEIGHT: "landedCosts.method.BY_WEIGHT",
};

/** The three things a purchase-invoice line can be (R4.2) — each routes its debit to a different account. */
const LINE_KINDS = ["inventory", "expense", "freight"] as const satisfies readonly PurchaseInvoiceLineDTO["kind"][];

const LINE_KIND_KEY: Record<PurchaseInvoiceLineDTO["kind"], AppTranslationKey> = {
  inventory: "purchaseInvoices.kind.inventory",
  expense: "purchaseInvoices.kind.expense",
  freight: "purchaseInvoices.kind.freight",
};

const num = (v: string) => Number(v);
const lineBase = (l: PurchaseInvoiceLineDTO) => Number(l.qty) * Number(l.unitCost);
const lineTax = (l: PurchaseInvoiceLineDTO) => (lineBase(l) * l.taxRatePercent) / 100;

interface DraftLine {
  itemId: string;
  kind: PurchaseInvoiceLineDTO["kind"];
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
  onPrint,
}: {
  invoice: PurchaseInvoiceDTO;
  supplierName: (id: string) => string;
  itemName: (id: string | null) => string;
  onBack: () => void;
  onConfirm: () => void;
  onPrint: () => void;
}) {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const fulfilmentQuery = usePurchaseInvoiceFulfilment(invoice.id);
  const landedCostsQuery = useLandedCosts();
  const treasuryAccounts = useTreasuryAccounts().data ?? [];
  const payInvoice = usePayPurchaseInvoice();

  const [payAmount, setPayAmount] = useState<number | null>(null);
  const [payTreasuryId, setPayTreasuryId] = useState("");
  const [payMethod, setPayMethod] = useState<PurchaseInvoicePaymentDTO["paymentMethod"]>("cash");
  const [payError, setPayError] = useState<string | null>(null);
  const [payNote, setPayNote] = useState<string | null>(null);

  const paid = num(invoice.amountPaid);
  const remaining = num(invoice.remainingBalance);
  const canPay = invoice.status === "confirmed" && remaining > 0;

  const fulfilment = useMemo(() => {
    const map = new Map<number, PurchaseInvoiceLineFulfilmentDTO>();
    for (const row of fulfilmentQuery.data?.lines ?? []) map.set(row.lineIndex, row);
    return map;
  }, [fulfilmentQuery.data]);

  /**
   * التكاليف الإضافية that landed on THIS document. A landed-cost line names the
   * document whose goods it revalued, which for a «من إيصال استلام» invoice is
   * the receipt, not the invoice — so both ids have to be matched or the tab
   * would read empty on exactly the invoices that carry one.
   */
  const landedCosts = useMemo(() => {
    const sourceIds = new Set([invoice.id, ...(invoice.receiptId ? [invoice.receiptId] : [])]);
    return (landedCostsQuery.data ?? [])
      .map((doc) => ({ doc, lines: doc.lines.filter((l) => sourceIds.has(l.sourceInvoiceId)) }))
      .filter((row) => row.lines.length > 0);
  }, [landedCostsQuery.data, invoice.id, invoice.receiptId]);

  const landedTotal = landedCosts.reduce(
    (sum, row) => sum + row.lines.reduce((s, l) => s + num(l.allocatedAmount), 0),
    0,
  );

  async function submitPayment() {
    setPayError(null);
    setPayNote(null);
    if (payAmount === null || payAmount <= 0) {
      setPayError(t("purchaseInvoices.pay.errorPositive"));
      return;
    }
    if (payTreasuryId === "") {
      setPayError(t("purchaseInvoices.pay.errorTreasury"));
      return;
    }
    try {
      const result = await payInvoice.mutateAsync({
        id: invoice.id,
        amount: String(payAmount),
        treasuryAccountId: payTreasuryId,
        paymentMethod: payMethod,
      });
      setPayAmount(null);
      setPayNote(t("purchaseInvoices.pay.done", { voucher: result.voucherNo ?? result.voucherId }));
    } catch (err) {
      setPayError(err instanceof Error ? err.message : t("purchaseInvoices.pay.errorFailed"));
    }
  }

  const kindLabel = (kind: PurchaseInvoiceLineDTO["kind"]) =>
    kind === "inventory"
      ? t("purchaseInvoices.kind.inventory")
      : kind === "freight"
        ? t("purchaseInvoices.kind.freight")
        : t("purchaseInvoices.kind.expense");

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
          <Button onClick={onPrint}>{t("print.action.print")}</Button>
        </>
      }
      summary={[
        { label: t("common.supplier"), value: supplierName(invoice.supplierId) },
        { label: t("common.date"), value: invoice.date.split("-").reverse().join("/") },
        { label: t("purchaseInvoices.detail.dueDate"), value: invoice.dueDate?.split("-").reverse().join("/") ?? "—" },
        { label: t("purchaseInvoices.detail.supplierInvoiceNo"), value: invoice.supplierInvoiceNumber ?? "—" },
        { label: t("purchaseInvoices.detail.source"), value: invoice.receiptId ? t("purchaseInvoices.source.fromReceipt") : t("purchaseInvoices.source.manual") },
        { label: t("purchaseInvoices.detail.grandTotal"), value: <MoneyValue value={num(invoice.total)} /> },
        { label: t("purchaseInvoices.pay.paid"), value: <MoneyValue value={paid} /> },
        { label: t("purchaseInvoices.pay.remaining"), value: <MoneyValue value={remaining} />, valueTone: remaining > 0 ? "danger" : "default" },
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
              <table className="w-full min-w-[860px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase text-ink-muted">
                    <th className="px-[12px] py-[9px] text-start">{t("common.item")}</th>
                    <th className="px-[12px] py-[9px] text-start">{t("common.type")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.qty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.receivedQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.consumedQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.remainingQty")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.unitCost")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("purchaseInvoices.col.taxPct")}</th>
                    <th className="px-[12px] py-[9px] text-end">{t("common.total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((l, i) => {
                    const row = fulfilment.get(i);
                    const stockLine = l.kind === "inventory";
                    return (
                      <tr key={i} className="border-b border-border last:border-b-0">
                        <td className="px-[12px] py-[10px]">{l.kind === "inventory" ? itemName(l.itemId) : (l.description ?? kindLabel(l.kind))}</td>
                        <td className="px-[12px] py-[10px]">{kindLabel(l.kind)}</td>
                        <td className="px-[12px] py-[10px] text-end"><QtyDisplay value={l.qty} /></td>
                        <td className="px-[12px] py-[10px] text-end">{stockLine && row ? <QtyDisplay value={row.receivedQty} /> : "—"}</td>
                        <td className="px-[12px] py-[10px] text-end">{stockLine && row ? <QtyDisplay value={row.consumedQty} /> : "—"}</td>
                        <td className="px-[12px] py-[10px] text-end">{stockLine && row ? <QtyDisplay value={row.remainingQty} /> : "—"}</td>
                        <td className="px-[12px] py-[10px] text-end"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                        <td className="mz-num px-[12px] py-[10px] text-end">{l.taxRatePercent}</td>
                        <td className="px-[12px] py-[10px] text-end"><MoneyValue value={lineBase(l) + lineTax(l)} showUnit={false} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-[12px] py-[10px]" colSpan={8}>{t("purchaseInvoices.totalsRow")}</td>
                    <td className="px-[12px] py-[10px] text-end">
                      <div><MoneyValue value={num(invoice.subtotal)} showUnit={false} /></div>
                      <div className="text-ink-muted"><MoneyValue value={num(invoice.tax)} showUnit={false} /></div>
                      <div><MoneyValue value={num(invoice.total)} showUnit={false} /></div>
                    </td>
                  </tr>
                </tfoot>
              </table>
              <p className="mt-[10px] max-w-[80ch] text-[11.5px] leading-[1.9] text-ink-muted">
                {t("purchaseInvoices.fulfilmentNote")}
              </p>
            </div>
          ),
        },
        {
          key: "landed-costs",
          label: t("purchaseInvoices.tab.landedCosts", { count: landedCosts.length }),
          content: landedCosts.length === 0 ? (
            <div className="rounded-lg border border-border bg-surface p-[22px_24px]">
              <p className="text-[13.5px] font-semibold text-ink">{t("purchaseInvoices.landed.emptyTitle")}</p>
              <p className="mt-[8px] max-w-[70ch] text-[12.5px] leading-[1.9] text-ink-muted">{t("purchaseInvoices.landed.emptyBody")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-[14px]">
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-[13px_15px]">
                <span className="text-[12.5px] text-ink-muted">{t("purchaseInvoices.landed.totalAllocated")}</span>
                <MoneyValue value={landedTotal} />
              </div>
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="p-[10px] text-start font-semibold">{t("purchaseInvoices.landed.col.document")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("common.item")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("purchaseInvoices.landed.col.costTypes")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("purchaseInvoices.landed.col.basis")}</th>
                      <th className="p-[10px] text-end font-semibold">{t("purchaseInvoices.landed.col.allocated")}</th>
                      <th className="p-[10px] text-end font-semibold">{t("purchaseInvoices.landed.col.oldUnitCost")}</th>
                      <th className="p-[10px] text-end font-semibold">{t("purchaseInvoices.landed.col.newUnitCost")}</th>
                      <th className="p-[10px] text-start font-semibold">{t("common.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {landedCosts.flatMap((row) =>
                      row.lines.map((l, i) => (
                        <tr key={`${row.doc.id}:${i}`} className="border-b border-border last:border-b-0">
                          <td className="mz-num p-[10px] font-semibold text-ink">{row.doc.docNo ?? row.doc.id}</td>
                          <td className="p-[10px]">{itemName(l.itemId)}</td>
                          <td className="p-[10px] text-ink-muted">
                            {l.costItems.map((ci) => t(LANDED_COST_TYPE_KEY[ci.costType])).join(" · ")}
                          </td>
                          <td className="p-[10px] text-ink-muted">{t(LANDED_COST_BASIS_KEY[l.distributionMethod])}</td>
                          <td className="p-[10px] text-end font-semibold text-ink"><MoneyValue value={num(l.allocatedAmount)} showUnit={false} /></td>
                          <td className="p-[10px] text-end text-ink-muted"><MoneyValue value={num(l.unitCost)} showUnit={false} /></td>
                          <td className="p-[10px] text-end text-ink"><MoneyValue value={num(l.newUnitCost)} showUnit={false} /></td>
                          <td className="p-[10px]">
                            <StatusPill
                              label={row.doc.status === "confirmed" ? t("purchaseInvoices.status.confirmed") : t("purchaseInvoices.status.draft")}
                              tone={row.doc.status === "confirmed" ? "success" : "neutral"}
                            />
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="max-w-[80ch] text-[11.5px] leading-[1.9] text-ink-muted">{t("purchaseInvoices.landed.note")}</p>
            </div>
          ),
        },
        {
          key: "attachments",
          label: t("attachments.tab"),
          content: <AttachmentsTab entityType="purchase-invoice" entityId={invoice.id} />,
        },
        {
          key: "payments",
          label: t("purchaseInvoices.tab.payments"),
          content: (
            <div className="flex flex-col gap-[14px]">
              <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{t("purchaseInvoices.detail.grandTotal")}</div>
                  <div className="mt-[5px] text-[14.5px] font-bold text-ink"><MoneyValue value={num(invoice.total)} showUnit={false} /></div>
                </div>
                <div className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{t("purchaseInvoices.pay.paid")}</div>
                  <div className="mt-[5px] text-[14.5px] font-bold text-ink"><MoneyValue value={paid} showUnit={false} /></div>
                </div>
                <div className="rounded-lg border border-border bg-surface p-[13px_15px]">
                  <div className="text-[11px] font-semibold text-ink-faint">{t("purchaseInvoices.pay.remaining")}</div>
                  <div className="mt-[5px] text-[14.5px] font-bold text-ink"><MoneyValue value={remaining} showUnit={false} /></div>
                </div>
              </div>
              {canPay ? (
                <Card className="p-[16px_18px]">
                  <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">{t("purchaseInvoices.pay.heading")}</h3>
                  {payError ? (
                    <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                      {payError}
                    </div>
                  ) : null}
                  {payNote ? (
                    <div role="status" className="mb-[10px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
                      {payNote}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-[10px]">
                    <NumberField
                      label={t("purchaseInvoices.pay.amount")}
                      value={payAmount ?? 0}
                      min={0}
                      onChange={(v) => setPayAmount(v)}
                    />
                    <SelectField
                      label={t("purchaseInvoices.pay.treasury")}
                      value={payTreasuryId}
                      onChange={setPayTreasuryId}
                      options={[
                        { value: "", label: t("purchaseInvoices.pay.treasuryPlaceholder") },
                        ...treasuryAccounts.map((a) => ({ value: a.id, label: nameOf(a) })),
                      ]}
                    />
                    <SelectField
                      label={t("purchaseInvoices.pay.method")}
                      value={payMethod ?? "cash"}
                      onChange={(v) => setPayMethod(v as PurchaseInvoicePaymentDTO["paymentMethod"])}
                      options={[
                        { value: "cash", label: t("vouchers.method.cash") },
                        { value: "bank", label: t("vouchers.method.bank") },
                        { value: "cheque", label: t("vouchers.method.cheque") },
                        { value: "card", label: t("vouchers.method.card") },
                        { value: "wallet", label: t("vouchers.method.wallet") },
                      ]}
                    />
                    <p className="text-[11.5px] leading-[1.9] text-ink-muted">{t("purchaseInvoices.pay.hint")}</p>
                    <div className="flex justify-end">
                      <Button variant="primary" disabled={payInvoice.isPending} onClick={submitPayment}>
                        {t("purchaseInvoices.pay.submit")}
                      </Button>
                    </div>
                  </div>
                </Card>
              ) : (
                <div className="p-[16px] text-center text-[12.5px] text-ink-muted">
                  {invoice.status === "confirmed" ? t("purchaseInvoices.pay.settled") : t("purchaseInvoices.pay.blocked")}
                </div>
              )}
            </div>
          ),
        },
      ]}
    />
  );
}

export function PurchaseInvoicesScreen() {
  const { t, locale } = useAppTranslation();
  const workingLocation = useWorkingLocation();
  const receiptsQuery = useGoodsReceipts();
  const suppliersQuery = useSuppliers();
  const itemsQuery = useItems();
  const createInvoice = useCreatePurchaseInvoice();
  const confirmInvoice = useConfirmPurchaseInvoice();

  const receipts = receiptsQuery.data ?? [];
  const suppliers = suppliersQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;

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
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [supplierFilter, setSupplierFilter] = useUrlParam("supplier");
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const userName = (id: string) => users.find((u) => u.id === id)?.nameAr ?? id;

  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    PurchaseInvoiceFilterKey,
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const { navigate } = useNavigation();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  /**
   * One filter object drives the rows, the chip counts and the KPI strip
   * (R1.1). They used to be three separate derivations — the KPI memo ran over
   * every invoice the server had sent while the table was narrowed on the
   * client, so choosing a supplier or a date range never moved the totals.
   */
  const debouncedSearch = useDebounced(search);
  const listFilter: Partial<PurchaseInvoiceListQueryDTO> = useMemo(
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
  // Only the ROWS query carries the page (Q-9); the chips and the KPI strip
  // still speak for the whole filtered set. The server applies the newest-first
  // order the screen used to apply after fetching every invoice.
  const query = usePurchaseInvoices({ ...listFilter, page, pageSize });
  const counts = usePurchaseInvoiceCounts(listFilter).data ?? {};
  const stats = usePurchaseInvoiceStats(listFilter).data ?? null;
  const invoices = query.data ?? EMPTY;
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
   * The creation method is a STEP, not a field (R2.1): the reference asks how
   * you want to build the document and only then shows the form. Two forms
   * behind one heading is how a user fills the manual lines and then converts
   * a receipt over the top of them.
   */
  const [methodChosen, setMethodChosen] = useState(false);
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
  const [date, setDate] = useState(todayIso());
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const allowedCurrencies = useAllowedCurrencies().data;
  const baseCurrency = allowedCurrencies?.base ?? "EGP";
  const [currency, setCurrency] = useState(baseCurrency);
  // The route has always accepted a currency and no screen ever sent one, so
  // every purchase invoice was booked in the base currency whatever the
  // supplier billed (D24's purchase-side UI half).
  const currencyOptions = useMemo(() => {
    const codes = allowedCurrencies?.multiCurrencyEnabled
      ? [baseCurrency, ...(allowedCurrencies.allowed ?? []).filter((c) => c !== baseCurrency)]
      : [baseCurrency];
    return codes.map((code) => {
      const definition = findCurrency(code);
      return definition ? { value: code, label: `${code} — ${locale === "en" ? definition.nameEn : definition.nameAr}` } : { value: code, label: code };
    });
  }, [allowedCurrencies, baseCurrency, locale]);
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
    const today = todayIso();
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

  const filtered = invoices;
  const totalRows = counts.all ?? filtered.length;
  /** Only the collapsed filter bar's own controls — the chips and the search box stay visible. */
  const activeFilterCount = [branchFilter, warehouseFilter, supplierFilter, fromDate, toDate].filter((v) => v !== "").length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered;

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
    setMethodChosen(false);
    // `undefined` = untouched, so a supplier carried in from the supplier's page applies.
    setSupplierChoice(undefined);
    setPickedReceipt(null);
    setDate(todayIso());
    setSupplierInvoiceNumber("");
    setLines([{ itemId: "", kind: "inventory", qty: 1, unitCost: 0, taxRatePercent: 14, description: "" }]);
    setFormError(null);
    subPage.open(...(supplierId ? ["new", supplierId] : ["new"]));
  }

  async function confirmSelected(id: string, expectedVersion?: number) {
    setFormError(null);
    try {
      await confirmInvoice.mutateAsync({ id, expectedVersion });
    } catch (err) {
      // N-9: a refusal because another till already moved this invoice names that
      // till's operator. Swallowing it left the button doing nothing at all.
      setFormError(err instanceof Error ? err.message : t("purchaseInvoices.error.saveFailed"));
    }
  }

  const manualSubtotal = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
  const canSave =
    method === "from-receipt"
      ? pickedReceipt !== null && receiptLines.length > 0
      : supplier !== null && lines.some((l) => l.qty > 0 && (l.kind !== "inventory" || l.itemId !== ""));

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
          currency,
          receiptId: receipt.id,
        });
      } else {
        if (!supplier) return;
        const usable = lines.filter((l) => l.qty > 0 && (l.kind !== "inventory" || l.itemId !== ""));
        if (usable.length === 0) return;
        await createInvoice.mutateAsync({
          id: crypto.randomUUID(),
          supplierId: supplier.id,
          date,
          branchId: workingLocation.branchId ?? "",
          warehouseId: workingLocation.warehouseId ?? "",
          supplierInvoiceNumber: supplierInvoiceNumber.trim() === "" ? null : supplierInvoiceNumber.trim(),
          currency,
          lines: usable.map((l) => ({
            itemId: l.kind === "inventory" ? l.itemId : null,
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
      </div>
      <div className="flex flex-col gap-[14px]">
        {formError ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {formError}
          </div>
        ) : null}
        {!methodChosen ? (
          <div className="rounded-lg border border-border p-[14px_16px]">
            <h3 className="mb-[4px] font-display text-[13.5px] font-bold text-ink">{t("purchaseInvoices.methodHeading")}</h3>
            <p className="mb-[10px] text-[12.5px] text-ink-muted">{t("purchaseInvoices.method.stepHint")}</p>
            <div className="grid gap-[10px] sm:grid-cols-2">
              {(["manual", "from-receipt"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethod(value)}
                  aria-pressed={method === value}
                  className={
                    method === value
                      ? "rounded-lg border border-brand bg-brand-soft p-[12px] text-start"
                      : "rounded-lg border border-border p-[12px] text-start hover:border-brand"
                  }
                >
                  <span className="block font-display text-[13px] font-bold text-ink">
                    {value === "manual" ? t("purchaseInvoices.method.manual") : t("purchaseInvoices.method.fromReceipt")}
                  </span>
                  <span className="block text-[12px] text-ink-muted">
                    {value === "manual" ? t("purchaseInvoices.method.manualHint") : t("purchaseInvoices.method.fromReceiptHint")}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-[12px] flex justify-end">
              <Button variant="primary" onClick={() => setMethodChosen(true)}>
                {t("purchaseInvoices.method.continue")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-lg border border-border p-[10px_16px]">
            <span className="text-[12.5px] text-ink-muted">
              {t("purchaseInvoices.method.chosen")}:{" "}
              <span className="font-semibold text-ink">
                {method === "manual" ? t("purchaseInvoices.method.manual") : t("purchaseInvoices.method.fromReceipt")}
              </span>
            </span>
            <Button size="sm" onClick={() => setMethodChosen(false)}>
              {t("purchaseInvoices.method.change")}
            </Button>
          </div>
        )}

        {!methodChosen ? null : method === "from-receipt" ? (
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
                <div className="mb-[8px] flex flex-wrap gap-[8px]" role="radiogroup">
                  {LINE_KINDS.map((kind) => (
                    <Chip
                      key={kind}
                      type="button"
                      active={line.kind === kind}
                      onClick={() =>
                        setLines((prev) =>
                          prev.map((l, j) =>
                            j === i ? { ...l, kind, ...(kind === "inventory" ? {} : { itemId: "", taxRatePercent: 0 }) } : l,
                          ),
                        )
                      }
                    >
                      {t(LINE_KIND_KEY[kind])}
                    </Chip>
                  ))}
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
                  <TextField
                    label={line.kind === "freight" ? t("purchaseInvoices.field.freightDescription") : t("purchaseInvoices.field.expenseDescription")}
                    value={line.description}
                    onChange={(v) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, description: v } : l)))}
                    placeholder={line.kind === "freight" ? t("purchaseInvoices.field.freightPlaceholder") : t("purchaseInvoices.field.expensePlaceholder")}
                  />
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

        {methodChosen ? (
          <>
            <TextField label={t("purchaseInvoices.field.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <TextField label={t("purchaseInvoices.detail.supplierInvoiceNo")} value={supplierInvoiceNumber} onChange={setSupplierInvoiceNumber} />
            <SelectField label={t("salesInvoices.field.currency")} value={currency} onChange={setCurrency} options={currencyOptions} />
            <div className="flex justify-end gap-[9px]">
              <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={save} disabled={!canSave}>{t("purchaseInvoices.saveDraft")}</Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );

  if (firstSegment === "new") return createPage;

  // `#/buy/purchase-invoices/<number>/print` — a destination, not an overlay (P-6).
  if (selected && subPage.segments[1] === "print") return <PurchaseInvoicePrintPage invoice={selected} />;

  if (selected) {
    return (
      <>
        <InvoiceDetail
          invoice={selected}
          supplierName={supplierName}
          itemName={itemName}
          onBack={() => subPage.close()}
          onConfirm={() => confirmSelected(selected.id, selected.version)}
          onPrint={() => subPage.open(selected.number ?? selected.id, "print")}
        />
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
        searchValue={searchText}
        onSearchChange={setSearchText}
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
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(inv) => inv.id}
        onRowClick={(inv) => subPage.open(inv.number ?? inv.id)}
        rowAction={(inv) => {
          // Derived from THIS row's state (R1.3): only a draft can be confirmed,
          // and only a confirmed invoice with a balance can be paid or costed.
          const owing = num(inv.remainingBalance) > 0 && inv.status === "confirmed";
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(inv.number ?? inv.id) },
            { key: "print", label: t("print.action.print"), onSelect: () => subPage.open(inv.number ?? inv.id, "print") },
            ...(inv.status === "draft"
              ? [{ key: "confirm", label: t("purchaseInvoices.confirm"), onSelect: () => void confirmSelected(inv.id) }]
              : []),
            ...(inv.status === "confirmed"
              ? [
                  {
                    key: "landed",
                    label: t("purchaseInvoices.row.newLandedCost"),
                    onSelect: () => navigate("landed-costs", { kind: "create", prefill: { invoiceId: inv.id } }),
                  },
                  {
                    key: "return",
                    label: t("purchaseInvoices.row.newReturn"),
                    onSelect: () => navigate("purchase-returns", { kind: "create", prefill: { invoiceId: inv.id } }),
                  },
                ]
              : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              {owing ? (
                <Button size="sm" variant="default" onClick={() => subPage.open(inv.number ?? inv.id)}>
                  {t("purchaseInvoices.pay.submit")}
                </Button>
              ) : null}
              <RowMenu items={menuItems} label={t("purchaseInvoices.row.actionsFor", { doc: inv.number ?? inv.id })} />
            </div>
          );
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{totalRows}</span> {t("purchaseInvoices.showingSuffix")}</>}
        emptyState={
          <EmptyState
            title={t("purchaseInvoices.empty")}
            description={t("purchaseInvoices.emptyHint")}
            action={{ label: t("purchaseInvoices.new"), onClick: () => openCreate() }}
          />
        }
      />
    </>
  );
}

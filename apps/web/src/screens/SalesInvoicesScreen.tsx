import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlreadySavedNotice, useAlreadySavedNotice, useDocumentId } from "../lib/document-id";
import { useQueryClient } from "@tanstack/react-query";
import { APPROVAL_STANDING_KEY, ReapprovalNotice } from "../shell/ReapprovalNotice";
import { errorMessage } from "../lib/error-message";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  type DocumentListColumn,
  type DocumentListSort,
  type DocumentListStatusChip,
  EmptyState,
  EntityPicker,
  type EntityPickerOption,
  IconButton,
  modKeyLabel,
  Money as MoneyDisplay,
  MoneyInput,
  type PillTone,
  Qty as QtyDisplay,
  QtyInput,
  RowMenu,
  type RowMenuItem,
  Select,
  SidePanel,
  StatusPill,
  TextInput,
  useFormat,
  ConfirmDialog,
} from "@mezan/ui";
import {
  Money,
  Qty,
  computeInvoiceTotals,
  resolveUnitFactor,
  toBaseQty,
  SALES_INVOICE_STATUS_LABELS_AR,
  ETA_RECEIPT_PAYMENT_METHODS,
  type EtaReceiptPaymentMethod,
  type SalesInvoiceLine,
  type SalesInvoiceDiscount,
  type SalesInvoiceDiscountType,
  type SalesInvoiceLineDiscountType, itemTypeIsSellable, findCurrency, convertToBase, extend, SALES_INVOICE_ACTIVE_STATUSES,} from "@mezan/domain";
import { IdempotencyRefusal, PricingGuardDiscountTypeDTO, PricingGuardDocTypeDTO, type PricingGuardEvaluateRequestDTO } from "@mezan/contracts";
import { usePricingGuardPreview } from "./enh/pricing-guard/pricing-guard-hooks";
import { PricingGuardLineStatus, PricingGuardSummary } from "./enh/pricing-guard/PricingGuardLineStatus";
import type { ProjectDTO, SalesInvoiceListQueryDTO, SalesInvoiceStatusDTO, TaxRateDTO } from "@mezan/contracts";
import { SalesInvoicePrintPage } from "../print/SalesInvoicePrintPage";
import {
  useAccounts,
  useBranches,
  useConfirmSalesInvoice,
  SalesTaxRecalculationPendingError,
  useCreateSalesInvoice,
  useCustomers,
  useEmployees,
  useItems,
  useProjects,
  useTenantSettings,
  useTaxRates,
  useItemAvailability,
  useConvertSalesQuoteToInvoice,
  useEtaSubmissions,
  useJournalEntry,
  usePriceLists,
  useSalesQuotes,
  useRecordSalesInvoicePayment,
  useInstallmentPlans,
  useSalesInvoice,
  useSalesInvoices,
  useSalesInvoiceCounts,
  useSalesInvoiceStats,
  useVouchers,
  useSalesReturns,
  useWarehouses,
  type SalesInvoiceDTO,
  useTreasuryAccounts,
  useAllowedCurrencies,
  ApiError,
  ClassifiableDocument,
} from "../data/hooks";
import { useWorkingLocation } from "../data/hub-hooks";
import { useAuditLog } from "../data/platform-hooks";
import { useEntityName } from "../lib/entity-names";
import { useUnitLabel } from "../lib/item-labels";
import { majorOf, sumMajor } from "../lib/money";
import { useDebounced } from "../lib/use-debounced";
import { SelectField, NumberField, TextAreaField, TextField } from "../settings/form-controls";
import { useNavigation, useScreenIntent, useSubPage } from "../navigation";
import { AttachmentsTab } from "../attachments/AttachmentsTab";
import { salesInvoiceStatusLabel } from "../domain-labels";
import { documentStatusLabel } from "../doc-status";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { ClassifyLineTaxAction } from "./ClassifyLineTaxAction";
import { NameJournalLineTaxAction } from "./NameJournalLineTaxAction";
import { DraftLineEditAction } from "./DraftLineEditAction";
import { ConfirmRecalculationNotice, confirmAcknowledgementOf, twoDecimals } from "./ConfirmRecalculationNotice";
import { VoidReasonNotice, VoidSalesInvoiceAction } from "./VoidSalesInvoiceAction";
import { UnnamedTaxNotice } from "./UnnamedTaxNotice";
import { DERIVED_TAX, TaxRateField, appliedTaxPercent, chosenTaxRateId, lineTaxPayload, postedTaxRateLabel, type TaxChoice } from "./tax-rate-field";
import { addDaysIso, todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

interface RowRerate {
  readonly row: Pick<SalesInvoiceDTO, "id" | "docNo" | "version" | "totals">;
  readonly message: string;
  readonly recalculated: string;
}

/** فواتير المبيعات (Sales Invoices) — docs/archive/catalog/01-sales.md. List + detail (with the
 * "تأثيرات هذه الفاتورة" effects panel) + a create/confirm sub-page form with live
 * totals, wired to the real `/sales-invoices` API (numbering + GL + stock engines). */

/** GL accounts a manually-created invoice falls back to when an item has none configured — leaves of the standard COA (packages/domain/src/accounts/coa-template.ts). */
const AR_ACCOUNT_ID = "1105";
const TAX_ACCOUNT_ID = "2200";
const REVENUE_ACCOUNT_ID = "4100";
const COGS_ACCOUNT_ID = "5100";
const INVENTORY_ACCOUNT_ID = "1200";

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

/**
 * B3 — a back-office confirm has no till to state the tender, so the receipt
 * fell back to «أخرى» even for a plain cash sale. `receiptPaymentMethod` on
 * confirm lets the person doing the confirming state it; left unset, the
 * backend still derives it honestly (till tender, then the collection
 * voucher, then «أخرى»).
 */
const RECEIPT_PAYMENT_METHOD_LABEL_KEY: Record<EtaReceiptPaymentMethod, AppTranslationKey> = {
  cash: "salesInvoices.receiptPaymentMethod.cash",
  card: "salesInvoices.receiptPaymentMethod.card",
  wallet: "salesInvoices.receiptPaymentMethod.wallet",
  transfer: "salesInvoices.receiptPaymentMethod.transfer",
  voucher: "salesInvoices.receiptPaymentMethod.voucher",
  gift_card: "salesInvoices.receiptPaymentMethod.giftCard",
  points: "salesInvoices.receiptPaymentMethod.points",
  other: "salesInvoices.receiptPaymentMethod.other",
};

/** Projects still open for new spend/income — a finished or cancelled project cannot take new lines. */
const OPEN_PROJECT_STATUSES = new Set<ProjectDTO["status"]>(["planned", "active", "on_hold"]);

/**
 * The label an amount ON THIS DOCUMENT should carry. A foreign-currency invoice
 * holds its own figures — the converted base amount lives in the ledger, not on
 * the form — so printing them under the tenant's base label made a USD document
 * read as pounds (D52).
 */
function currencyLabelFor(code: string | null | undefined, locale: string): string | undefined {
  if (!code) return undefined;
  const definition = findCurrency(code);
  if (!definition) return code;
  return locale === "en" ? definition.code : definition.symbol;
}

function toMajor(v: string): number {
  return Number(v);
}

/** The list's own status axis: the stored statuses plus the derived مفتوحة / متأخرة. */
type InvoiceFilterKey = "all" | "open" | "overdue" | SalesInvoiceStatusDTO;

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
  /** The unit the qty is entered in; "" until an item is picked (then its base unit). */
  unitCode: string;
  unitPrice: number | null;
  discountType: SalesInvoiceLineDiscountType;
  discountPercent: number;
  discountAmount: number;
  tax: TaxChoice;
}

const NO_TAX_RATES: readonly TaxRateDTO[] = [];

let lineSeq = 0;
function blankLine(): InvoiceLineDraft {
  lineSeq += 1;
  return {
    key: `l${lineSeq}`,
    itemId: "",
    qty: 1,
    unitCode: "",
    unitPrice: null,
    discountType: "percent",
    discountPercent: 0,
    discountAmount: 0,
    tax: DERIVED_TAX,
  };
}

/** Base units per one `unitCode` on this item — 1 for the base unit itself. */
function factorFor(item: ItemUnitSetup | null | undefined, unitCode: string): number {
  if (!item) return 1;
  try {
    return resolveUnitFactor({ baseUnitCode: item.baseUnitCode, alternateUnits: item.alternateUnits }, unitCode);
  } catch {
    return 1;
  }
}

interface ItemUnitSetup {
  readonly baseUnitCode: string;
  readonly alternateUnits: readonly { readonly code: string; readonly name: string; readonly factor: number }[];
}

/**
 * فاتورة مبيعات جديدة — a sub-PAGE at `#/sales/sales-invoices/new`, not a side
 * panel: a create form is a place you can be, link to and come back to with the
 * browser's Back button.
 */
/**
 * Live availability for one invoice line. The other-warehouse figures are shown
 * only when the server sends them, which it does only when the tenant's عرض
 * المخزون في المستودعات الأخرى is on — the screen never decides that itself.
 */
function LineAvailability({
  itemId,
  warehouseId,
  warehouses,
  /** What this line will actually take out, in BASE units — a carton line asks for pieces. */
  requiredBaseQty,
  baseUnitLabel,
}: {
  itemId: string;
  warehouseId: string;
  warehouses: readonly { id: string; name: string }[];
  requiredBaseQty: number;
  baseUnitLabel: string;
}) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const availability = useItemAvailability(itemId, warehouseId);
  if (!availability.data) {
    return <div className="text-[11.5px] text-ink-faint">{t("salesInvoices.line.availabilityLoading")}</div>;
  }

  const onHand = Number(availability.data.onHand);
  const others = availability.data.otherWarehouses;
  const nameOf = (id: string) => warehouses.find((w) => w.id === id)?.name ?? id;
  // Three states, not two: enough, some but not enough for THIS line, and none.
  // A line that reads "available 40" while asking for 60 pieces is the one the
  // storekeeper finds out about at picking time.
  const tone: PillTone = onHand <= 0 ? "danger" : requiredBaseQty > onHand ? "warning" : "success";
  const label =
    onHand <= 0
      ? t("salesInvoices.lineOutOfStock")
      : requiredBaseQty > onHand
        ? t("salesInvoices.line.shortBy", { qty: `${format.qty(requiredBaseQty - onHand)} ${baseUnitLabel}` })
        : t("salesInvoices.line.inStock");

  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[3px] text-[11.5px]">
      <StatusPill label={label} tone={tone} />
      <span className="text-ink-muted">
        {t("salesInvoices.line.availabilityTitle")} <span className="mz-num">{format.qty(onHand)}</span> {baseUnitLabel}
      </span>
      {others.length > 0 ? (
        <span className="text-ink-muted">
          {t("salesInvoices.lineOtherWarehouses")}:{" "}
          {others.map((w) => `${nameOf(w.warehouseId)} ${format.qty(Number(w.onHand))}`).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * "تأثيرات هذا المستند" — the three cards the reference shows before you commit
 * a document: what leaves the warehouse, what the journal entry does, and what
 * happens to the customer's balance. The third card carries the "no automatic
 * collection" statement, which is the single most common misreading of a
 * confirmed invoice: confirming books a receivable, it does not take money.
 *
 * The stock figure is stated in BASE units, because that is what the ledger
 * moves — a line entered as 5 cartons says 60 pieces here.
 */
function InvoiceEffectCards({
  stockBaseQty,
  baseUnitLabel,
  warehouseName,
  customerName,
  grandTotal,
  taxableTotal,
  taxTotal,
}: {
  stockBaseQty: number;
  baseUnitLabel: string;
  warehouseName: string;
  customerName: string | null;
  grandTotal: number;
  taxableTotal: number;
  taxTotal: number;
}) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const money = (v: number) => `${format.money(v)} ${format.currencyLabel}`;

  const cards = [
    {
      key: "stock",
      title: t("salesInvoices.effects.stockTitle"),
      body:
        stockBaseQty > 0
          ? t("salesInvoices.effects.stockBody", {
              qty: `${format.qty(stockBaseQty)} ${baseUnitLabel}`,
              warehouse: warehouseName,
            })
          : t("salesInvoices.effects.stockNone"),
      note: null as string | null,
    },
    {
      key: "gl",
      title: t("salesInvoices.effects.glTitle"),
      body: t("salesInvoices.effects.glBody", {
        total: money(grandTotal),
        net: money(taxableTotal),
        tax: taxTotal !== 0 ? t("salesInvoices.effects.glTaxPart", { tax: money(taxTotal) }) : "",
      }),
      note: null as string | null,
    },
    {
      key: "balance",
      title: t("salesInvoices.effects.balanceTitle"),
      body: t("salesInvoices.effects.balanceBody", {
        customer: customerName ?? t("salesInvoices.effects.pendingCustomer"),
        total: money(grandTotal),
      }),
      note: t("salesInvoices.effects.noAutoCollection"),
    },
  ];

  return (
    <section className="rounded-lg border border-border bg-surface-2 p-[14px_16px]">
      <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">{t("salesInvoices.effects.title")}</h3>
      <div className="grid gap-[10px] sm:grid-cols-3">
        {cards.map((card) => (
          <div key={card.key} className="rounded-lg border border-border bg-surface p-[12px]">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted">{card.title}</div>
            <p className="mt-[6px] text-[12.5px] text-ink">{card.body}</p>
            {card.note ? <p className="mt-[6px] text-[12px] font-semibold text-warning-ink">{card.note}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function CreateInvoicePage({
  onClose,
  onAlreadyCreated,
  initialCustomerId,
}: {
  onClose: () => void;
  onAlreadyCreated: (invoiceId: string) => void;
  initialCustomerId?: string | null;
}) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const customersQuery = useCustomers();
  const employeesQuery = useEmployees();
  const projectsQuery = useProjects();
  const itemsQuery = useItems();
  const warehousesQuery = useWarehouses();
  const branchesQuery = useBranches();
  const priceListsQuery = usePriceLists();
  const quotesQuery = useSalesQuotes();
  const convertQuote = useConvertSalesQuoteToInvoice();
  const createInvoice = useCreateSalesInvoice();
  const confirmInvoice = useConfirmSalesInvoice();
  const invoiceId = useDocumentId((savedId) => {
    resetForm();
    onAlreadyCreated(savedId);
  });
  const unitLabel = useUnitLabel();
  const workingLocation = useWorkingLocation();
  const nameOf = useEntityName();

  const customers = customersQuery.data ?? EMPTY;
  const employees = employeesQuery.data ?? EMPTY;
  const projects = projectsQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;
  const warehouses = warehousesQuery.data ?? EMPTY;
  const branches = branchesQuery.data ?? EMPTY;
  const priceLists = priceListsQuery.data ?? EMPTY;

  const today = todayIso();
  /**
   * Arriving from a customer's page («إنشاء فاتورة») the customer is already
   * known and rides in the URL, so the form opens bound to it instead of
   * asking the user to search for the record they just came from. Derived, not
   * synchronised: `undefined` means "the user has not touched the picker", so
   * the prefill shows as soon as the customer list resolves and stops applying
   * the moment they choose — including choosing nothing.
   */
  const [customerChoice, setCustomerChoice] = useState<EntityPickerOption | null | undefined>(undefined);
  const customerOptions = useMemo<EntityPickerOption[]>(
    () => customers.filter((c) => c.active).map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [customers],
  );
  const customer =
    customerChoice !== undefined ? customerChoice : (customerOptions.find((option) => option.id === initialCustomerId) ?? null);
  const setCustomer = setCustomerChoice;

  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState(today);
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [currency, setCurrency] = useState("EGP");
  const docCurrencyLabel = currencyLabelFor(currency, locale);
  const allowedCurrencies = useAllowedCurrencies().data;
  const currencyOptions = useMemo(() => {
    const base = allowedCurrencies?.base ?? "EGP";
    const codes = allowedCurrencies?.multiCurrencyEnabled
      ? [base, ...(allowedCurrencies.allowed ?? []).filter((c) => c !== base)]
      : [base];
    return codes.map((code) => {
      const definition = findCurrency(code);
      if (!definition) return { value: code, label: code };
      return { value: code, label: `${code} — ${locale === "en" ? definition.nameEn : definition.nameAr}` };
    });
  }, [allowedCurrencies, locale]);
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  /** Whether the user edited the due date by hand — an untouched one keeps tracking the customer's terms. */
  const [dueDateTouched, setDueDateTouched] = useState(false);
  /** "إنشاء فاتورة جديدة" vs "إنشاء من عرض سعر" — the reference's own two creation methods. */
  const [method, setMethod] = useState<"manual" | "fromQuote">("manual");
  /**
   * The creation method is a STEP, not a field: the reference asks how you want
   * to build the document and only then shows the form (R2.1). Two forms behind
   * one heading is how a user fills the manual lines and then converts a quote
   * over the top of them.
   */
  const [methodChosen, setMethodChosen] = useState(false);
  const [sourceQuoteId, setSourceQuoteId] = useState("");
  const [salesperson, setSalesperson] = useState<EntityPickerOption | null>(null);
  const [project, setProject] = useState<EntityPickerOption | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [discountType, setDiscountType] = useState<SalesInvoiceDiscountType>("amount");
  const [discountValue, setDiscountValue] = useState(0);
  const [lines, setLines] = useState<InvoiceLineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** B3 — stated only for a consumer sale confirmed with no till; "" leaves the backend's own derivation. */
  const [receiptPaymentMethod, setReceiptPaymentMethod] = useState<EtaReceiptPaymentMethod | "">("");

  function resetForm() {
    // `undefined` = untouched, so a customer carried in from «إنشاء فاتورة»
    // re-applies. `null` would mean "the user deliberately chose nobody".
    setCustomerChoice(undefined);
    setDate(today);
    setDueDate(today);
    setWarehouseId(workingLocation.warehouseId ?? warehouses[0]?.id ?? "");
    setBranchId(workingLocation.branchId ?? branches.find((b) => b.isMain)?.id ?? "");
    setCurrency("EGP");
    setNotes("");
    setInternalNotes("");
    setDueDateTouched(false);
    setSalesperson(null);
    setProject(null);
    setCouponCode("");
    setDiscountType("amount");
    setDiscountValue(0);
    setLines([blankLine()]);
    setMethodChosen(false);
    setReceiptPaymentMethod("");
    setError(null);
  }

  // Seed the location defaults once their lists arrive — only into fields the
  // user has not set. This used to call `resetForm()`, which wiped every line
  // and note the user had already typed whenever either query resolved or
  // refetched.
  useEffect(() => {
    setWarehouseId((current) => current || workingLocation.warehouseId || warehouses[0]?.id || "");
    setBranchId((current) => current || workingLocation.branchId || branches.find((b) => b.isMain)?.id || "");
  }, [warehouses, branches, workingLocation.warehouseId, workingLocation.branchId]);

  const customerRecord = customer ? (customers.find((c) => c.id === customer.id) ?? null) : null;

  // تاريخ الاستحقاق follows the customer's payment terms — the reference computes
  // it the moment a customer is chosen and lets the user override it.
  useEffect(() => {
    if (dueDateTouched || !customerRecord) return;
    setDueDate(addDaysIso(date, customerRecord.paymentTermsDays ?? 0));
  }, [customerRecord, date, dueDateTouched]);

  const acceptedQuotes = (quotesQuery.data ?? []).filter((q) => q.status === "accepted");

  async function convertSelectedQuote() {
    const quote = acceptedQuotes.find((q) => q.id === sourceQuoteId);
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      await convertQuote.mutateAsync({
        id: quote.id,
        body: {
          dueDate,
          warehouseId,
          arAccountId: AR_ACCOUNT_ID,
          taxAccountId: TAX_ACCOUNT_ID,
          lines: quote.lines.map((l) => {
            const item = items.find((i) => i.id === l.itemId);
            const isStock = item?.type === "stock";
            return {
              lineId: l.lineId,
              isStock,
              revenueAccountId: item?.revenueAccountId ?? REVENUE_ACCOUNT_ID,
              cogsAccountId: isStock ? (item?.cogsAccountId ?? COGS_ACCOUNT_ID) : null,
              inventoryAccountId: isStock ? (item?.inventoryAccountId ?? INVENTORY_ACCOUNT_ID) : null,
            };
          }),
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("salesInvoices.error.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  const priceList = useMemo(() => {
    if (customerRecord?.priceListId) return priceLists.find((p) => p.id === customerRecord.priceListId) ?? null;
    return priceLists.find((p) => p.isBase && p.active) ?? null;
  }, [customerRecord, priceLists]);

  /**
   * The price a line should open at: the customer's price list, else the item's
   * own sale price. The invoice form used to read `item.salePrice` directly, so
   * a customer on a wholesale list was quoted their list price but INVOICED at
   * the retail one — the two documents disagreed on the same goods.
   */
  const priceFor = useCallback(
    (item: { id: string; salePrice?: string | null }): number => {
      const listed = priceList?.lines.find((l) => l.itemId === item.id);
      return Number(listed?.price ?? item.salePrice ?? "0");
    },
    [priceList],
  );

  const salespersonOptions = useMemo<EntityPickerOption[]>(
    () =>
      employees
        .filter((e) => e.status === "active")
        .map((e) => ({
          id: e.id,
          label: [e.firstNameAr, e.lastNameAr].filter(Boolean).join(" ") || `${e.firstName} ${e.lastName}`,
          sublabel: e.code,
        })),
    [employees],
  );
  const projectOptions = useMemo<EntityPickerOption[]>(
    () =>
      projects
        .filter((p) => OPEN_PROJECT_STATUSES.has(p.status))
        .map((p) => ({ id: p.id, label: `${p.code} — ${nameOf(p)}` })),
    [projects, nameOf],
  );
  const itemOptions = useMemo<EntityPickerOption[]>(
    // The sublabel quotes the price THIS customer gets, not the base one: on a
    // wholesale customer the picker advertised 180.00 and the line then opened
    // at 168.00, so the two disagreed in front of the user.
    () =>
      items
        // A raw material, a consumable or a recipe is not something you sell.
        .filter((i) => i.status === "active" && itemTypeIsSellable(i.type))
        .map((i) => ({ id: i.id, label: i.nameAr, sublabel: `${i.code} · ${format.money(priceFor(i))} ${format.currencyLabel}` })),
    [items, priceFor, format],
  );

  const tenantSettings = useTenantSettings();
  const taxRates = useTaxRates().data ?? NO_TAX_RATES;
  const customerData = customer ? (customers.find((c) => c.id === customer.id) ?? null) : null;
  // A customer with no tax registration number is a consumer sale — an
  // e-receipt, not an e-invoice — and confirming it here has no till to name
  // the tender (B3).
  const isConsumerReceiptSale = customerData !== null && !customerData.taxNumber;

  const domainLines = useMemo<SalesInvoiceLine[]>(() => {
    const out: SalesInvoiceLine[] = [];
    for (const l of lines) {
      const item = items.find((i) => i.id === l.itemId);
      if (!item) continue;
      const isStock = item.type === "stock";
      const unitCode = l.unitCode || item.baseUnitCode;
      const unitFactor = factorFor(item, unitCode);
      const qty = Qty.fromMajor(String(l.qty || 0));
      out.push({
        lineId: l.key,
        itemId: item.id,
        itemNameAr: item.nameAr,
        isStock,
        qty,
        unitCode,
        unitFactor,
        baseQty: toBaseQty(qty, unitFactor),
        unitPrice: Money.fromMajor(String(l.unitPrice ?? 0)),
        discountType: l.discountType,
        discountPercent: l.discountType === "percent" ? l.discountPercent || 0 : 0,
        discountAmount: Money.fromMajor(String(l.discountType === "amount" ? l.discountAmount || 0 : 0)),
        taxRatePercent: appliedTaxPercent(l.tax, taxRates, item.taxRatePercent),
        taxRateId: chosenTaxRateId(l.tax, taxRates, item.taxRatePercent),
        revenueAccountId: item.revenueAccountId ?? REVENUE_ACCOUNT_ID,
        cogsAccountId: isStock ? (item.cogsAccountId ?? COGS_ACCOUNT_ID) : null,
        inventoryAccountId: isStock ? (item.inventoryAccountId ?? INVENTORY_ACCOUNT_ID) : null,
        costCenterId: null,
        unitCost: null,
      });
    }
    return out;
  }, [lines, items, taxRates]);

  const discount: SalesInvoiceDiscount = useMemo(
    () =>
      discountType === "percent"
        ? { type: "percent", percent: discountValue || 0 }
        : { type: "amount", amount: Money.fromMajor(String(discountValue || 0)) },
    [discountType, discountValue],
  );

  // The tenant's VAT basis, so the preview computes tax the same way the server
  // will stamp it on the draft (settings §"الضريبة" → `taxCalculation`).
  const taxInclusive = tenantSettings.data?.taxCalculation === "INCLUSIVE";

  // A pure, local totals preview — the server recomputes (and is authoritative on) the same totals on create.
  const totals = useMemo(
    () =>
      computeInvoiceTotals(domainLines, discount, {
        taxExempt: customerData?.taxExempt ?? false,
        taxInclusive: taxInclusive,
      }),
    [domainLines, discount, customerData, taxInclusive],
  );
  const totalsByLineId = useMemo(() => new Map(totals.lines.map((l) => [l.lineId, l])), [totals]);

  const priceGuardBranchId = branchId || workingLocation.branchId || "";
  const priceGuardRequest = useMemo<PricingGuardEvaluateRequestDTO | null>(() => {
    if (!customer || priceGuardBranchId === "" || domainLines.length === 0) return null;
    return {
      docType: PricingGuardDocTypeDTO.SalesInvoice,
      date,
      customerId: customer.id,
      branchId: priceGuardBranchId,
      warehouseId: warehouseId || null,
      currency,
      taxInclusive,
      discount:
        discount.type === "percent"
          ? { type: PricingGuardDiscountTypeDTO.Percent, percent: discount.percent }
          : { type: PricingGuardDiscountTypeDTO.Amount, amount: discount.amount.toString() },
      lines: domainLines.map((l) => ({
        lineId: l.lineId,
        itemId: l.itemId,
        qty: l.qty.toString(),
        unitFactor: l.unitFactor,
        unitPrice: l.unitPrice.toString(),
        discountType: l.discountType === "amount" ? PricingGuardDiscountTypeDTO.Amount : PricingGuardDiscountTypeDTO.Percent,
        discountPercent: l.discountPercent,
        discountAmount: l.discountAmount.toString(),
        taxRatePercent: l.taxRatePercent,
      })),
    };
  }, [customer, priceGuardBranchId, domainLines, date, warehouseId, currency, taxInclusive, discount]);
  const priceGuard = usePricingGuardPreview(priceGuardRequest);
  const priceGuardByLine = useMemo(() => new Map((priceGuard?.lines ?? []).map((l) => [l.lineId, l])), [priceGuard]);

  const canSubmit = customer !== null && domainLines.length > 0 && totals.grandTotal.scaled > 0n && !busy;

  /** What confirming will actually take out of the warehouse, in base units (R2.8). */
  const stockBaseQty = useMemo(
    () => Number(Qty.sum(domainLines.filter((l) => l.isStock).map((l) => l.baseQty)).toString()),
    [domainLines],
  );
  const stockBaseUnitLabel = useMemo(() => {
    const first = domainLines.find((l) => l.isStock);
    const item = first ? items.find((i) => i.id === first.itemId) : null;
    return item ? unitLabel(item.baseUnitCode) : "";
  }, [domainLines, items, unitLabel]);

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
      setError(t("salesInvoices.error.customerRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createInvoice.mutateAsync({
        id: invoiceId.current(),
        date,
        dueDate,
        customerId: customer.id,
        customerNameAr: customerData.nameAr,
        customerTaxExempt: customerData.taxExempt,
        warehouseId,
        branchId: branchId || workingLocation.branchId || "",
        salespersonId: salesperson?.id ?? null,
        salespersonNameAr: salesperson?.label ?? null,
        projectId: project?.id ?? null,
        couponCode: couponCode.trim() === "" ? null : couponCode.trim(),
        currency,
        notes: notes.trim() === "" ? null : notes.trim(),
        internalNotes: internalNotes.trim() === "" ? null : internalNotes.trim(),
        discount: discount.type === "percent" ? { type: "percent", percent: discount.percent } : { type: "amount", amount: discount.amount.toString() },
        arAccountId: AR_ACCOUNT_ID,
        taxAccountId: TAX_ACCOUNT_ID,
        lines: domainLines.map((l) => ({
          ...lineTaxPayload(lines.find((draft) => draft.key === l.lineId)?.tax ?? DERIVED_TAX, taxRates, l.taxRatePercent),
          lineId: l.lineId,
          itemId: l.itemId,
          itemNameAr: l.itemNameAr,
          isStock: l.isStock,
          qty: l.qty.toString(),
          unitCode: l.unitCode,
          unitFactor: l.unitFactor,
          unitPrice: l.unitPrice.toString(),
          discountType: l.discountType,
          discountPercent: l.discountPercent,
          discountAmount: l.discountAmount.toString(),
          revenueAccountId: l.revenueAccountId,
          cogsAccountId: l.cogsAccountId,
          inventoryAccountId: l.inventoryAccountId,
        })),
      });
      if (shouldConfirm) {
        await confirmInvoice.mutateAsync(
          isConsumerReceiptSale && receiptPaymentMethod !== ""
            ? { id: created.id, receiptPaymentMethod }
            : created.id,
        );
      }
      invoiceId.renew();
      resetForm();
      onClose();
    } catch (err) {
      if (invoiceId.recover(err)) return;
      setError(err instanceof Error ? err.message : t("salesInvoices.error.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.sales.invoices")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("salesInvoices.panel.title")}</h1>
          <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("salesInvoices.panel.description")}</p>
        </div>
      </div>
      <div className="flex flex-col gap-[16px]">
        {!methodChosen ? (
        <div className="rounded-lg border border-border p-[14px_16px]">
          <h3 className="mb-[4px] font-display text-[13.5px] font-bold text-ink">{t("salesInvoices.method.title")}</h3>
          <p className="mb-[10px] text-[12.5px] text-ink-muted">{t("salesInvoices.method.stepHint")}</p>
          <div className="grid gap-[10px] sm:grid-cols-2">
            {(["manual", "fromQuote"] as const).map((value) => (
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
                  {value === "manual" ? t("salesInvoices.method.manual") : t("salesInvoices.method.fromQuote")}
                </span>
                <span className="block text-[12px] text-ink-muted">
                  {value === "manual" ? t("salesInvoices.method.manualHint") : t("salesInvoices.method.fromQuoteHint")}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-[12px] flex justify-end">
            <Button variant="primary" onClick={() => setMethodChosen(true)}>
              {t("salesInvoices.method.continue")}
            </Button>
          </div>
        </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-[10px] rounded-lg border border-border p-[10px_16px]">
            <span className="text-[12.5px] text-ink-muted">
              {t("salesInvoices.method.chosen")}:{" "}
              <span className="font-semibold text-ink">
                {method === "manual" ? t("salesInvoices.method.manual") : t("salesInvoices.method.fromQuote")}
              </span>
            </span>
            <Button size="sm" onClick={() => setMethodChosen(false)}>
              {t("salesInvoices.method.change")}
            </Button>
          </div>
        )}

        {methodChosen && method === "fromQuote" ? (
          <div className="flex flex-col gap-[10px] rounded-lg border border-border p-[14px_16px]">
            {acceptedQuotes.length === 0 ? (
              <p className="text-[12.5px] text-ink-muted">{t("salesInvoices.method.noAcceptedQuotes")}</p>
            ) : (
              <>
                <SelectField
                  label={t("salesInvoices.method.chooseQuote")}
                  value={sourceQuoteId}
                  onChange={setSourceQuoteId}
                  options={[
                    { value: "", label: t("salesInvoices.method.chooseQuote") },
                    ...acceptedQuotes.map((q) => ({ value: q.id, label: `${q.docNo ?? q.id} — ${q.customerNameAr}` })),
                  ]}
                />
                <SelectField
                  label={t("salesInvoices.field.warehouse")}
                  value={warehouseId}
                  onChange={setWarehouseId}
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                />
                <Button variant="primary" disabled={sourceQuoteId === "" || warehouseId === "" || busy} onClick={convertSelectedQuote}>
                  {t("salesInvoices.method.convert")}
                </Button>
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}

        {methodChosen && method === "manual" ? (
        <>
        <EntityPicker id="invoice-customer-picker" label={t("salesInvoices.field.customer")} value={customer} onChange={setCustomer} options={customerOptions} placeholder={t("salesInvoices.field.customerPlaceholder")} />

        <div className="grid grid-cols-2 gap-[10px]">
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">{t("salesInvoices.field.date")}</span>
            <TextInput numeric type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12.5px] font-semibold text-ink">{t("salesInvoices.field.dueDate")}</span>
            <TextInput
              numeric
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDateTouched(true);
                setDueDate(e.target.value);
              }}
            />
            <span className="text-xs text-ink-muted">{t("salesInvoices.field.dueDateHint")}</span>
          </label>
        </div>

        <div className="grid gap-[10px] sm:grid-cols-2">
          <SelectField
            label={t("salesInvoices.field.branch")}
            value={branchId}
            onChange={setBranchId}
            options={[
              { value: "", label: t("salesInvoices.field.chooseBranch") },
              ...branches.filter((b) => b.active).map((b) => ({ value: b.id, label: `${b.name} · ${b.code}` })),
            ]}
          />
          <SelectField
            label={t("salesInvoices.field.warehouse")}
            value={warehouseId}
            onChange={setWarehouseId}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
          />
          {/* The tenant decides which currencies exist, not the screen: the
              list comes from /settings/currencies, so switching multi-currency
              off collapses this to the base currency without a UI change. */}
          <SelectField
            label={t("salesInvoices.field.currency")}
            value={currency}
            onChange={setCurrency}
            options={currencyOptions}
          />
        </div>

        <EntityPicker
          id="invoice-salesperson-picker"
          label={t("salesInvoices.field.salesperson")}
          value={salesperson}
          onChange={setSalesperson}
          options={salespersonOptions}
          placeholder={t("salesInvoices.field.salespersonPlaceholder")}
        />

        <EntityPicker
          id="invoice-project-picker"
          label={t("common.project")}
          value={project}
          onChange={setProject}
          options={projectOptions}
          placeholder={t("common.noProject")}
        />

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12.5px] font-semibold text-ink">{t("salesInvoices.field.coupon")}</span>
          <TextInput
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value)}
            placeholder={t("salesInvoices.field.couponPlaceholder")}
          />
          <span className="text-xs text-ink-muted">{t("salesInvoices.field.couponHint")}</span>
        </label>

        <div className="flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-[13.5px] font-bold text-ink">{t("salesInvoices.linesHeading")}</h3>
            <Button size="sm" onClick={addLine}>
              {t("salesInvoices.addLine")}
            </Button>
          </div>
          {lines.map((line, i) => {
            const item = items.find((it) => it.id === line.itemId);
            const selectedOption = item ? { id: item.id, label: item.nameAr, sublabel: item.code } : null;
            const lineTotals = totalsByLineId.get(line.key);
            const enteredUnit = item ? line.unitCode || item.baseUnitCode : "";
            const lineFactor = factorFor(item, enteredUnit);
            const lineBaseQty = item ? Number(toBaseQty(Qty.fromMajor(String(line.qty || 0)), lineFactor).toString()) : 0;
            return (
              <div key={line.key} className="flex flex-col gap-[10px] rounded-lg border border-border p-[12px]">
                <div className="flex items-start gap-[8px]">
                  <div className="flex-1">
                    <EntityPicker
                      id={`invoice-line-item-${line.key}`}
                      label={t("salesInvoices.field.lineItem", { number: i + 1 })}
                      value={selectedOption}
                      onChange={(opt) => {
                        const picked = opt ? items.find((it) => it.id === opt.id) : null;
                        // The unit belongs to the item, so it resets with it —
                        // keeping "كرتونة" across a change of item would price
                        // the new one in a unit it does not define.
                        updateLine(i, {
                          itemId: opt?.id ?? "",
                          unitCode: picked?.baseUnitCode ?? "",
                          unitPrice: picked ? priceFor(picked) : null,
                          tax: DERIVED_TAX,
                        });
                      }}
                      options={itemOptions}
                      placeholder={t("salesInvoices.field.itemPlaceholder")}
                    />
                  </div>
                  <IconButton
                    aria-label={t("salesInvoices.removeLine", { number: i + 1 })}
                    disabled={lines.length <= 1}
                    className="mt-[26px]"
                    onClick={() => removeLine(i)}
                  >
                    ✕
                  </IconButton>
                </div>
                {item ? (
                  <>
                    <div className="grid gap-[10px] sm:grid-cols-3">
                      <label className="flex flex-col gap-[6px]">
                        <span className="text-xs font-semibold text-ink-muted">{t("salesInvoices.field.qty")}</span>
                        <QtyInput
                          aria-label={t("salesInvoices.field.lineQty", { number: i + 1 })}
                          value={line.qty}
                          onChange={(v) => updateLine(i, { qty: v })}
                          min={0}
                          step={1}
                          unit={unitLabel(enteredUnit)}
                        />
                      </label>
                      <SelectField
                        label={t("salesInvoices.field.unit")}
                        value={enteredUnit}
                        onChange={(v) => updateLine(i, { unitCode: v })}
                        options={[
                          { value: item.baseUnitCode, label: `${unitLabel(item.baseUnitCode)} · ${t("salesInvoices.field.baseUnit")}` },
                          ...item.alternateUnits.map((u) => ({
                            value: u.code,
                            label: `${u.name} · ×${u.factor}`,
                          })),
                        ]}
                      />
                      <label className="flex flex-col gap-[6px]">
                        <span className="text-xs font-semibold text-ink-muted">{t("salesInvoices.field.price")}</span>
                        <MoneyInput aria-label={t("salesInvoices.field.linePrice", { number: i + 1 })} value={line.unitPrice} onChange={(v) => updateLine(i, { unitPrice: v })} />
                      </label>
                    </div>
                    {lineFactor !== 1 ? (
                      <div className="text-[11.5px] text-ink-muted">
                        <span className="mz-num">
                          {t("salesInvoices.line.conversion", {
                            qty: format.qty(line.qty || 0),
                            unit: unitLabel(enteredUnit),
                            baseQty: format.qty(lineBaseQty),
                            baseUnit: unitLabel(item.baseUnitCode),
                          })}
                        </span>
                        {item.type === "stock" ? ` · ${t("salesInvoices.line.movesStock")}` : ""}
                      </div>
                    ) : null}
                    <div className="grid gap-[10px] sm:grid-cols-3">
                      <TaxRateField
                        label={t("taxRateField.label")}
                        choice={line.tax}
                        onChange={(tax) => updateLine(i, { tax })}
                        taxRates={taxRates}
                        fallbackPercent={item.taxRatePercent}
                      />
                      <SelectField
                        label={t("salesInvoices.field.lineDiscountType")}
                        value={line.discountType}
                        onChange={(v) => updateLine(i, { discountType: v as SalesInvoiceLineDiscountType })}
                        options={[
                          { value: "percent", label: t("salesInvoices.lineDiscount.percent") },
                          { value: "amount", label: t("salesInvoices.lineDiscount.amount") },
                        ]}
                      />
                      {line.discountType === "percent" ? (
                        <NumberField
                          label={t("salesInvoices.field.discountPct")}
                          value={line.discountPercent}
                          onChange={(v) => updateLine(i, { discountPercent: v })}
                          min={0}
                          max={100}
                        />
                      ) : (
                        <label className="flex flex-col gap-[6px]">
                          <span className="text-xs font-semibold text-ink-muted">{t("salesInvoices.field.lineDiscountValue")}</span>
                          <MoneyInput
                            aria-label={t("salesInvoices.field.lineDiscountValue")}
                            value={line.discountAmount}
                            onChange={(v) => updateLine(i, { discountAmount: v ?? 0 })}
                          />
                        </label>
                      )}
                    </div>
                    {lineTotals ? (
                      <div className="flex flex-wrap gap-x-[14px] text-[11.5px] text-ink-muted">
                        {lineTotals.lineDiscount.scaled !== 0n ? (
                          <span>
                            {t("salesInvoices.lineDiscountApplied")} −<MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(lineTotals.lineDiscount.toString())} />
                          </span>
                        ) : null}
                        <span>
                          {t("salesInvoices.lineTotal")} <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(lineTotals.total.toString())} />
                        </span>
                      </div>
                    ) : null}
                    <PricingGuardLineStatus line={priceGuardByLine.get(line.key)} costVisible={priceGuard?.costVisible ?? false} />
                    {item.type === "stock" ? (
                      <LineAvailability
                        itemId={item.id}
                        warehouseId={warehouseId}
                        warehouses={warehouses}
                        requiredBaseQty={lineBaseQty}
                        baseUnitLabel={unitLabel(item.baseUnitCode)}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-[10px]">
          <SelectField
            label={t("salesInvoices.field.discountType")}
            value={discountType}
            onChange={(v) => setDiscountType(v as SalesInvoiceDiscountType)}
            options={[
              { value: "amount", label: t("salesInvoices.discount.amount") },
              { value: "percent", label: t("salesInvoices.discount.percent") },
            ]}
          />
          <NumberField
            label={discountType === "percent" ? t("salesInvoices.field.discountPercent") : t("salesInvoices.field.discountValue")}
            value={discountValue}
            onChange={setDiscountValue}
            min={0}
            max={discountType === "percent" ? 100 : undefined}
          />
        </div>

        <div className="grid gap-[10px] sm:grid-cols-2">
          <TextAreaField label={t("salesInvoices.field.notes")} value={notes} onChange={setNotes} />
          <TextAreaField
            label={t("salesInvoices.field.internalNotes")}
            hint={t("salesInvoices.field.internalNotesHint")}
            value={internalNotes}
            onChange={setInternalNotes}
          />
        </div>

        <div className="rounded-lg border border-border bg-surface-2 p-[14px_16px]">
          <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">{t("salesInvoices.summary.title")}</h3>
          <dl className="flex flex-col gap-[7px] text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">{t("salesInvoices.summary.priceList")}</dt>
              <dd className="font-semibold text-ink">{priceList?.nameAr ?? t("salesInvoices.summary.noPriceList")}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">{taxInclusive ? t("salesInvoices.subtotalInclusive") : t("salesInvoices.subtotal")}</dt>
              <dd>
                <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(totals.subtotal.toString())} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">{t("salesInvoices.discount")}</dt>
              <dd>
                <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(totals.invoiceDiscountTotal.toString())} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-muted">{taxInclusive ? t("salesInvoices.taxIncluded") : t("salesInvoices.tax")}</dt>
              <dd>
                <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(totals.taxTotal.toString())} />
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-[8px] font-bold">
              <dt className="text-ink">{t("salesInvoices.grandTotal")}</dt>
              <dd>
                <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(totals.grandTotal.toString())} />
              </dd>
            </div>
          </dl>
        </div>

        <InvoiceEffectCards
          stockBaseQty={stockBaseQty}
          baseUnitLabel={stockBaseUnitLabel}
          warehouseName={warehouses.find((w) => w.id === warehouseId)?.name ?? warehouseId}
          customerName={customer?.label ?? null}
          grandTotal={toMajor(totals.grandTotal.toString())}
          taxableTotal={toMajor(totals.taxableTotal.toString())}
          taxTotal={toMajor(totals.taxTotal.toString())}
        />

        {isConsumerReceiptSale ? (
          <SelectField
            label={t("salesInvoices.field.receiptPaymentMethod")}
            hint={t("salesInvoices.field.receiptPaymentMethodHint")}
            value={receiptPaymentMethod}
            onChange={(v) => setReceiptPaymentMethod(v as EtaReceiptPaymentMethod | "")}
            options={[
              { value: "", label: t("salesInvoices.receiptPaymentMethod.auto") },
              ...ETA_RECEIPT_PAYMENT_METHODS.map((m) => ({ value: m, label: t(RECEIPT_PAYMENT_METHOD_LABEL_KEY[m]) })),
            ]}
          />
        ) : null}

        <PricingGuardSummary evaluation={priceGuard} />

        <div className="flex justify-end gap-[9px]">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={!canSubmit} onClick={() => handleSave(false)}>
            {t("salesInvoices.saveDraft")}
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => handleSave(true)}>
            {t("salesInvoices.confirm")}
          </Button>
        </div>
        </>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

/**
 * A document's figures without leaving the list (R2.9), and the two ways this
 * product can actually share one (R2.10).
 *
 * "Share" is print and copy-to-clipboard, not a link: the app runs offline on a
 * shop's own machine, so there is no address anyone else could open. Copying a
 * plain-text summary is what a shopkeeper does with it — into a message to the
 * customer.
 */
function InvoicePreviewPanel({
  invoice,
  onClose,
  onOpenFull,
  onPrint,
}: {
  invoice: SalesInvoiceDTO | null;
  onClose: () => void;
  onOpenFull: (invoice: SalesInvoiceDTO) => void;
  onPrint: (invoice: SalesInvoiceDTO) => void;
}) {
  const { t, locale } = useAppTranslation();
  const format = useFormat();
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  if (!invoice) return null;

  const label = currencyLabelFor(invoice.currency, locale) ?? format.currencyLabel;
  const money = (wire: string) => `${format.money(toMajor(wire))} ${label}`;
  const baseMoney = (wire: string) => `${format.money(toMajor(wire))} ${invoice.fxRate ? format.currencyLabel : label}`;

  // Plain text on purpose: it has to survive being pasted into a chat app.
  const summary = [
    `${invoice.docNo ?? invoice.id} · ${invoice.date}`,
    invoice.customerNameAr,
    ...invoice.lines.map((l) => `${l.itemNameAr} × ${l.qty} = ${money(String(Number(l.unitPrice) * Number(l.qty)))}`),
    `${t("common.total")}: ${money(invoice.totals.grandTotal)}`,
    ...(invoice.fxRate ? [`${t("salesInvoices.detail.baseTotal")}: ${baseMoney(invoice.baseGrandTotal ?? invoice.totals.grandTotal)}`] : []),
    `${t("salesInvoices.detail.remaining")}: ${baseMoney(invoice.remainingBalance)}`,
  ].join("\n");

  return (
    <SidePanel open={invoice !== null} onClose={onClose} title={t("salesInvoices.preview.title", { doc: invoice.docNo ?? invoice.id })}>
      <div className="flex flex-col gap-[14px]">
        <dl className="grid grid-cols-2 gap-[10px] text-[12.5px]">
          <div><dt className="text-ink-muted">{t("common.customer")}</dt><dd className="text-ink">{invoice.customerNameAr}</dd></div>
          <div><dt className="text-ink-muted">{t("common.date")}</dt><dd className="mz-num text-ink">{invoice.date}</dd></div>
          <div><dt className="text-ink-muted">{t("common.status")}</dt><dd className="text-ink">{salesInvoiceStatusLabel(invoice.status, t)}</dd></div>
          <div><dt className="text-ink-muted">{t("common.total")}</dt><dd className="mz-num font-semibold text-ink">{money(invoice.totals.grandTotal)}</dd></div>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
              <tr>
                <th className="px-[10px] py-[7px] text-start">{t("common.item")}</th>
                <th className="px-[10px] py-[7px] text-end">{t("common.qty")}</th>
                <th className="px-[10px] py-[7px] text-end">{t("common.total")}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.lineId} className="border-t border-border">
                  <td className="px-[10px] py-[8px] text-ink">{l.itemNameAr}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end">{l.qty}</td>
                  <td className="mz-num px-[10px] py-[8px] text-end">{money(String(Number(l.unitPrice) * Number(l.qty)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {copied ? (
          <p className={`text-[12.5px] font-semibold ${copied === "ok" ? "text-success-ink" : "text-danger-ink"}`}>
            {copied === "ok" ? t("salesInvoices.share.copied") : t("salesInvoices.share.copyFailed")}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-[8px]">
          <Button variant="primary" onClick={() => onOpenFull(invoice)}>{t("salesInvoices.preview.openFull")}</Button>
          {/* NOT `window.print()`. This panel shows customer, date, status and
              total — no seller tax number, no VAT breakdown, no ETA identifier
              — so printing it produced a document that is not a tax invoice.
              «طباعة» opens the template engine's own page instead. */}
          <Button onClick={() => onPrint(invoice)}>{t("salesInvoices.share.print")}</Button>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(summary);
                setCopied("ok");
              } catch {
                // A denied clipboard must say so rather than look like it worked.
                setCopied("failed");
              }
            }}
          >
            {t("salesInvoices.share.copy")}
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}

function InvoiceDetailView({
  invoice,
  today,
  onPrint,
}: {
  invoice: SalesInvoiceDTO;
  today: string;
  onPrint: () => void;
}) {
  const { t, locale } = useAppTranslation();
  const detailConfirm = useConfirmSalesInvoice();
  const queryClient = useQueryClient();
  const [detailConfirmError, setDetailConfirmError] = useState<string | null>(null);
  const [taxRecalculatedNotice, setTaxRecalculatedNotice] = useState<string | null>(null);
  /** B3 — stated only for a consumer sale confirmed with no till; "" leaves the backend's own derivation. */
  const [detailReceiptPaymentMethod, setDetailReceiptPaymentMethod] = useState<EtaReceiptPaymentMethod | "">("");
  const detailCustomersQuery = useCustomers();
  const detailTaxRates = useTaxRates().data ?? NO_TAX_RATES;
  const detailCustomer = (detailCustomersQuery.data ?? []).find((c) => c.id === invoice.customerId) ?? null;
  const isConsumerReceiptSale = detailCustomer !== null && !detailCustomer.taxNumber;
  const format = useFormat();
  const docCurrencyLabel = currencyLabelFor(invoice.currency, locale);
  const settledInBase = Boolean(invoice.fxRate);
  const settlementLabel = settledInBase ? format.currencyLabel : docCurrencyLabel;
  // Cost, profit and the journal are base-currency figures whatever the invoice's own currency.
  const baseLabel = format.currencyLabel;
  const settlementTotal = toMajor(invoice.baseGrandTotal ?? invoice.totals.grandTotal);
  const accountsQuery = useAccounts();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const projectsQuery = useProjects();
  const nameOf = useEntityName();
  const unitLabel = useUnitLabel();
  const journalEntryQuery = useJournalEntry(invoice.journalEntryId);
  const recordPayment = useRecordSalesInvoicePayment();
  const branchesQuery = useBranches();
  const returnsQuery = useSalesReturns();
  const installmentPlansQuery = useInstallmentPlans();
  const { navigate } = useNavigation();
  const etaQuery = useEtaSubmissions();
  const auditQuery = useAuditLog({ entityType: "SALES_INVOICE", limit: 100 });

  const accounts = accountsQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;
  const branches = branchesQuery.data ?? EMPTY;
  const projects = projectsQuery.data ?? EMPTY;
  const project = invoice.projectId ? (projects.find((p) => p.id === invoice.projectId) ?? null) : null;

  /** Returns raised against THIS invoice — the reference shows them on the invoice itself. */
  const invoiceReturns = (returnsQuery.data ?? []).filter((r) => r.lines.some((l: { sourceInvoiceId: string }) => l.sourceInvoiceId === invoice.id));
  // الأقساط — plans scheduling THIS invoice's balance (R3.4).
  const invoicePlans = (installmentPlansQuery.data ?? []).filter((plan) => plan.lines.some((l) => l.sourceInvoiceId === invoice.id));
  const etaRows = (etaQuery.data ?? []).filter((e: { internalId: string }) => e.internalId === invoice.docNo || e.internalId === invoice.id);
  const auditRows = (auditQuery.data?.events ?? []).filter((e: { details: unknown }) => {
    const d = e.details as Record<string, unknown> | null;
    return d ? d.id === invoice.id || d.docNo === invoice.docNo : false;
  });

  /**
   * تكلفة/ربح/هامش — the reference reports margin on the invoice, and every
   * figure it needs is already on the wire: each line carries the `unitCost`
   * the confirm consumed.
   */

  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  // A collection lands in a treasury account or it is not a collection: the
  // route creates a real voucher and this is where its money goes (D1).
  const treasuryQuery = useTreasuryAccounts();
  const treasuryOptions = (treasuryQuery.data ?? [])
    .filter((a) => a.status === "active")
    .map((a) => ({ value: a.id, label: `${a.name} (${a.code})` }));
  const [paymentTreasuryId, setPaymentTreasuryId] = useState("");
  // «تحصيل دفعة» opened with no treasury selected and no default, so the first
  // attempt at every collection was refused on submit with nothing said
  // beforehand (D93). Same seeding the refund flow on returns already does.
  useEffect(() => {
    if (paymentTreasuryId !== "") return;
    const accounts = treasuryQuery.data ?? [];
    const first = accounts.find((a) => a.status === "active") ?? accounts[0];
    if (first) setPaymentTreasuryId(first.id);
  }, [treasuryQuery.data, paymentTreasuryId]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank" | "cheque" | "card" | "wallet">("cash");
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
      unitCode: l.unitCode ?? "",
      unitFactor: l.unitFactor ?? 1,
      baseQty: Qty.fromMajor(l.baseQty ?? l.qty),
      unitPrice: Money.fromMajor(l.unitPrice),
      discountType: l.discountType ?? "percent",
      discountPercent: l.discountPercent,
      discountAmount: Money.fromMajor(l.discountAmount ?? "0"),
      taxRatePercent: l.taxRatePercent,
      taxRateId: l.taxRateId ?? null,
      revenueAccountId: l.revenueAccountId,
      cogsAccountId: l.cogsAccountId,
      inventoryAccountId: l.inventoryAccountId,
      costCenterId: null,
      unitCost: l.unitCost ? Money.fromMajor(l.unitCost) : null,
    }));
    const discount: SalesInvoiceDiscount =
      invoice.discount.type === "percent" ? { type: "percent", percent: invoice.discount.percent } : { type: "amount", amount: Money.fromMajor(invoice.discount.amount) };
    const totals = computeInvoiceTotals(domainLines, discount, {
      taxExempt: invoice.customerTaxExempt,
      taxInclusive: invoice.taxInclusive === true,
      promotionLineDiscounts: invoice.appliedPromotion?.lineDiscounts.map((d: { lineId: string; itemId: string; amount: string }) => ({
        lineId: d.lineId,
        itemId: d.itemId,
        amount: Money.fromMajor(d.amount),
      })),
    });
    return new Map(totals.lines.map((l) => [l.lineId, l]));
  }, [invoice]);

  /**
   * Cost is captured in BASE (it is what 1200 and COGS moved by), so profit is
   * the line's taxable base in base currency less it (D218): subtracting a base
   * cost from a CHF price labelled as CHF was neither figure.
   */
  const lineBaseNet = (lineId: string): Money | null => {
    const lt = lineTotals.get(lineId);
    if (!lt) return null;
    return invoice.fxRate ? convertToBase(lt.taxableBase, invoice.fxRate) : lt.taxableBase;
  };
  const lineCost = (l: { unitCost?: string | null; qty: string }): Money | null =>
    l.unitCost ? extend(Qty.fromMajor(l.qty), Money.fromMajor(l.unitCost)) : null;
  const margin = (() => {
    let cost = Money.zero();
    let net = Money.zero();
    for (const l of invoice.lines) {
      cost = cost.add(lineCost(l) ?? Money.zero());
      net = net.add(lineBaseNet(l.lineId) ?? Money.zero());
    }
    const profit = Money.fromScaled(net.scaled - cost.scaled);
    return {
      cost: toMajor(cost.toString()),
      profit: toMajor(profit.toString()),
      marginPct: net.scaled === 0n ? 0 : (toMajor(profit.toString()) / toMajor(net.toString())) * 100,
    };
  })();

  const accountLabel = (id: string) => {
    const a = accounts.find((acc) => acc.id === id);
    return a ? `${a.code} — ${a.nameAr}` : id;
  };

  async function handleRecordPayment() {
    if (!paymentAmount || paymentAmount <= 0) {
      setPaymentError(t("salesInvoices.error.paymentPositive"));
      return;
    }
    setPayBusy(true);
    setPaymentError(null);
    try {
      if (!paymentTreasuryId) {
        setPaymentError(t("salesInvoices.error.treasuryRequired"));
        return;
      }
      await recordPayment.mutateAsync({
        id: invoice.id,
        amount: String(paymentAmount),
        treasuryAccountId: paymentTreasuryId,
        paymentMethod: paymentMethod,
      });
      setPaymentAmount(null);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : t("salesInvoices.error.paymentFailed"));
    } finally {
      setPayBusy(false);
    }
  }

  const effects = [
    invoice.status === "draft"
      ? t("salesInvoices.effect.draft")
      : t("salesInvoices.effect.confirmed"),
    t("salesInvoices.effect.balance", { balance: `${format.money(toMajor(invoice.remainingBalance))} ${format.currencyLabel}` }),
  ];

  // Base units — what actually left (or will leave) the warehouse. A line
  // written in cartons reports pieces here, like the ledger does.
  const stockBaseQty = invoice.lines
    .filter((l) => l.isStock)
    .reduce((sum, l) => sum + Number(l.baseQty ?? l.qty), 0);
  const stockBaseUnitLabel = unitLabel(items.find((i) => i.id === invoice.lines.find((l) => l.isStock)?.itemId)?.baseUnitCode ?? "");

  return (
    <DocumentDetail
      title={invoice.docNo ?? t("salesInvoices.detailTitle")}
      statusLabel={salesInvoiceStatusLabel(invoice.status, t)}
      statusTone={STATUS_TONE[invoice.status]}
      subtitle={
        <>
          {overdue ? <span className="text-danger-ink">{t("salesInvoices.overdue")}</span> : null}
          {detailConfirmError ? (
            <span role="alert" className="block text-[12.5px] font-semibold text-danger-ink">
              {detailConfirmError}
            </span>
          ) : null}
          <ReapprovalNotice
            requestId={invoice.status === "pending" ? (invoice.workflowRequestId ?? null) : null}
            pending={detailConfirm.isPending}
            onRequestAgain={async () => {
              setDetailConfirmError(null);
              try {
                await detailConfirm.mutateAsync({ id: invoice.id, expectedVersion: invoice.version });
                await queryClient.invalidateQueries({ queryKey: [APPROVAL_STANDING_KEY] });
              } catch (err) {
                setDetailConfirmError(errorMessage(err, t("common.failed")));
              }
            }}
          />
          <ConfirmRecalculationNotice invoice={invoice} />
          {taxRecalculatedNotice ? (
            <span role="status" className="block text-[12.5px] font-semibold text-warning-ink">
              {taxRecalculatedNotice}
            </span>
          ) : null}
        </>
      }
      /**
       * A draft used to be a DEAD END here: the confirm that posts stock, GL
       * and AR lived only in the list row's kebab, so a rep following a quote's
       * own "view invoice" link could not advance the document they had just
       * been sent to (D39). Every state a document can reach needs a screen
       * that moves it on.
       */
      actions={
        <>
          {invoice.status === "draft" ? (
            <Button
              variant="primary"
              disabled={detailConfirm.isPending}
              onClick={async () => {
                setDetailConfirmError(null);
                try {
                  // N-9: the version this screen was served. A second till that
                  // already moved this invoice gets the 409 refusal here.
                  const confirmed = await detailConfirm.mutateAsync({
                    id: invoice.id,
                    expectedVersion: invoice.version,
                    ...confirmAcknowledgementOf(invoice),
                    ...(isConsumerReceiptSale && detailReceiptPaymentMethod !== ""
                      ? { receiptPaymentMethod: detailReceiptPaymentMethod }
                      : {}),
                  });
                  setTaxRecalculatedNotice(confirmed.taxRecalculated?.message ?? null);
                } catch (err) {
                  setDetailConfirmError(errorMessage(err, t("common.failed")));
                }
              }}
            >
              {t("salesInvoices.confirm")}
            </Button>
          ) : null}
          <VoidSalesInvoiceAction invoice={invoice} />
          <Button onClick={onPrint}>{t("salesInvoices.share.print")}</Button>
        </>
      }
      summary={[
        { label: t("common.date"), value: <span className="mz-num">{invoice.date}</span> },
        { label: t("common.customer"), value: invoice.customerNameAr },
        { label: t("salesInvoices.col.dueDate"), value: <span className="mz-num">{invoice.dueDate}</span>, valueTone: overdue ? "danger" : "default" },
        { label: t("common.warehouse"), value: warehouses.find((w) => w.id === invoice.warehouseId)?.name ?? invoice.warehouseId },
        { label: t("salesInvoices.detail.branch"), value: branches.find((b) => b.id === invoice.branchId)?.name ?? invoice.branchId },
        { label: t("salesInvoices.detail.salesperson"), value: invoice.salespersonNameAr ?? t("salesInvoices.detail.unassigned") },
        ...(invoice.projectId
          ? [{ label: t("common.project"), value: project ? `${project.code} — ${nameOf(project)}` : invoice.projectId }]
          : []),
        ...(invoice.appliedPromotion
          ? [
              { label: t("salesInvoices.detail.appliedPromotion"), value: `${invoice.appliedPromotion.nameAr} (${invoice.appliedPromotion.code})` },
              {
                label: t("salesInvoices.detail.promotionDiscount"),
                value: <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(invoice.appliedPromotion.discountTotal)} />,
              },
            ]
          : []),
        { label: t("common.total"), value: <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(invoice.totals.grandTotal)} /> },
        ...(settledInBase
          ? [{ label: t("salesInvoices.detail.baseTotal"), value: <MoneyDisplay currencyLabel={settlementLabel} value={settlementTotal} /> }]
          : []),
        { label: t("salesInvoices.detail.remaining"), value: <MoneyDisplay currencyLabel={settlementLabel} value={remaining} />, valueTone: remaining > 0 ? "danger" : "success" },
      ]}
      effectsTitle={t("salesInvoices.effectsTitle")}
      effects={effects}
      tabs={[
        {
          key: "lines",
          label: t("salesInvoices.tab.lines"),
          content: (
            <div className="flex flex-col gap-[14px]">
            {invoice.status === "draft" && isConsumerReceiptSale ? (
              <Card className="p-[14px_16px]">
                <SelectField
                  label={t("salesInvoices.field.receiptPaymentMethod")}
                  hint={t("salesInvoices.field.receiptPaymentMethodHint")}
                  value={detailReceiptPaymentMethod}
                  onChange={(v) => setDetailReceiptPaymentMethod(v as EtaReceiptPaymentMethod | "")}
                  options={[
                    { value: "", label: t("salesInvoices.receiptPaymentMethod.auto") },
                    ...ETA_RECEIPT_PAYMENT_METHODS.map((m) => ({ value: m, label: t(RECEIPT_PAYMENT_METHOD_LABEL_KEY[m]) })),
                  ]}
                />
              </Card>
            ) : null}
            <InvoiceEffectCards
              stockBaseQty={stockBaseQty}
              baseUnitLabel={stockBaseUnitLabel}
              warehouseName={warehouses.find((w) => w.id === invoice.warehouseId)?.name ?? invoice.warehouseId}
              customerName={invoice.customerNameAr}
              grandTotal={toMajor(invoice.totals.grandTotal)}
              taxableTotal={toMajor(invoice.totals.taxableTotal ?? invoice.totals.subtotal)}
              taxTotal={toMajor(invoice.totals.taxTotal)}
            />
            <VoidReasonNotice invoice={invoice} />
            <UnnamedTaxNotice
              document={ClassifiableDocument.SalesInvoice}
              posted={SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)}
              documentKind={invoice.documentKind}
              lines={invoice.lines.map((l) => ({ lineId: l.lineId, label: l.itemNameAr, taxRatePercent: l.taxRatePercent, taxRateId: l.taxRateId ?? null }))}
            />
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("common.item")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.field.qty")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.field.unit")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.field.price")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.lineDiscountApplied")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.tax")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.detail.cost")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.detail.profit")}</th>
                      <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.lines.map((l) => {
                      const lt = lineTotals.get(l.lineId);
                      const cost = lineCost(l);
                      const baseNet = lineBaseNet(l.lineId);
                      return (
                        <tr key={l.lineId} className="border-b border-border last:border-b-0">
                          <td className="px-[15px] py-[11px] text-ink">{l.itemNameAr}</td>
                          <td className="px-[15px] py-[11px] text-end"><QtyDisplay value={l.qty} /></td>
                          <td className="px-[15px] py-[11px] text-start text-ink-muted">
                            {unitLabel(l.unitCode ?? "")}
                            {(l.unitFactor ?? 1) !== 1 ? (
                              <span className="block text-[11px] text-ink-faint">
                                = <QtyDisplay value={l.baseQty ?? l.qty} />{" "}
                                {unitLabel(items.find((i) => i.id === l.itemId)?.baseUnitCode ?? "")}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(l.unitPrice)} /></td>
                          <td className="px-[15px] py-[11px] text-end">
                            {lt ? <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(lt.lineDiscount.toString())} /> : "—"}
                          </td>
                          <td className="px-[15px] py-[11px] text-end">
                            {lt ? <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(lt.tax.toString())} /> : "—"}
                            <span className="block text-[11px] text-ink-faint">{postedTaxRateLabel(detailTaxRates, l, t)}</span>
                            <DraftLineEditAction invoice={invoice} line={l} taxRates={detailTaxRates} />
                            <ClassifyLineTaxAction
                              document={ClassifiableDocument.SalesInvoice}
                              documentId={invoice.id}
                              posted={SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)}
                              documentKind={invoice.documentKind}
                              line={{ lineId: l.lineId, label: l.itemNameAr, taxRatePercent: l.taxRatePercent, taxRateId: l.taxRateId ?? null }}
                              lines={invoice.lines.map((other) => ({ lineId: other.lineId, label: other.itemNameAr, taxRatePercent: other.taxRatePercent, taxRateId: other.taxRateId ?? null }))}
                              taxRates={detailTaxRates}
                            />
                          </td>
                          <td className="px-[15px] py-[11px] text-end">
                            {cost ? <MoneyDisplay currencyLabel={baseLabel} value={toMajor(cost.toString())} /> : "—"}
                          </td>
                          <td className="px-[15px] py-[11px] text-end">
                            {cost && baseNet ? (
                              <MoneyDisplay currencyLabel={baseLabel} value={toMajor(Money.fromScaled(baseNet.scaled - cost.scaled).toString())} />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-[15px] py-[11px] text-end">{lt ? <MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(lt.total.toString())} /> : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    {/* Subtotal and tax were computed and stored but never shown, so the
                        grand total appeared without the arithmetic that produced it (R2.7). */}
                    <tr className="text-ink-muted">
                      <td className="px-[15px] py-[9px]" colSpan={8}>{t("salesInvoices.detail.subtotal")}</td>
                      <td className="px-[15px] py-[9px] text-end"><MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(invoice.totals.subtotal)} /></td>
                    </tr>
                    <tr className="text-ink-muted">
                      <td className="px-[15px] py-[9px]" colSpan={8}>{t("salesInvoices.detail.tax")}</td>
                      <td className="px-[15px] py-[9px] text-end"><MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(invoice.totals.taxTotal)} /></td>
                    </tr>
                    <tr className="bg-surface-2 font-bold">
                      <td className="px-[15px] py-[11px]" colSpan={8}>{t("salesInvoices.grandTotal")}</td>
                      <td className="px-[15px] py-[11px] text-end"><MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(invoice.totals.grandTotal)} /></td>
                    </tr>
                    <tr className="text-ink-muted">
                      <td className="px-[15px] py-[9px]" colSpan={8}>{t("salesInvoices.detail.totalCost")}</td>
                      <td className="px-[15px] py-[9px] text-end"><MoneyDisplay currencyLabel={baseLabel} value={margin.cost} /></td>
                    </tr>
                    <tr className="text-ink-muted">
                      <td className="px-[15px] py-[9px]" colSpan={8}>{t("salesInvoices.detail.totalProfit")}</td>
                      <td className="px-[15px] py-[9px] text-end"><MoneyDisplay currencyLabel={baseLabel} value={margin.profit} /></td>
                    </tr>
                    <tr className="text-ink-muted">
                      <td className="px-[15px] py-[9px]" colSpan={8}>{t("salesInvoices.detail.grossMargin")}</td>
                      <td className="mz-num px-[15px] py-[9px] text-end">{format.number(Math.round(margin.marginPct * 10) / 10)}%</td>
                    </tr>
                    {toMajor(invoice.returnedCredit) > 0 ? (
                      <>
                        <tr className="text-danger">
                          <td className="px-[15px] py-[9px]" colSpan={8}>{t("salesInvoices.detail.returnsDeduction")}</td>
                          <td className="px-[15px] py-[9px] text-end"><MoneyDisplay currencyLabel={settlementLabel} value={-toMajor(invoice.returnedCredit)} /></td>
                        </tr>
                        <tr className="bg-surface-2 font-bold">
                          <td className="px-[15px] py-[11px]" colSpan={8}>{t("salesInvoices.detail.netAfterReturns")}</td>
                          <td className="px-[15px] py-[11px] text-end">
                            <MoneyDisplay currencyLabel={settlementLabel} value={settlementTotal - toMajor(invoice.returnedCredit)} />
                          </td>
                        </tr>
                      </>
                    ) : null}
                  </tfoot>
                </table>
              </div>
            </Card>
            </div>
          ),
        },
        {
          key: "gl",
          label: t("salesInvoices.tab.journal"),
          content: (
            <Card className="p-[16px_18px]">
              {invoice.journalEntryId ? (
                journalEntryQuery.data ? (
                  <>
                    <NameJournalLineTaxAction
                      document={ClassifiableDocument.SalesInvoice}
                      documentId={invoice.id}
                      journalEntryId={invoice.journalEntryId}
                      posted={SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)}
                      lines={invoice.lines.map((l) => ({ lineId: l.lineId, label: l.itemNameAr, taxRatePercent: l.taxRatePercent, taxRateId: l.taxRateId ?? null }))}
                      taxRates={detailTaxRates}
                      accountLabel={accountLabel}
                    />
                    <div className="mb-[12px] text-[13px] text-ink-muted">
                      {t("salesInvoices.journal.entryNo")} <span className="mz-num font-semibold text-ink">{journalEntryQuery.data.entryNo ?? invoice.docNo}</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[480px] border-collapse text-[13px]">
                        <thead>
                          <tr>
                            <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("salesInvoices.journal.account")}</th>
                            <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                            <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {journalEntryQuery.data.lines.map((l, i) => (
                            <tr key={i} className="border-b border-border last:border-b-0">
                              <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId)}</td>
                              <td className="px-[15px] py-[11px] text-end">{Number(l.debit) !== 0 ? <MoneyDisplay currencyLabel={baseLabel} value={Number(l.debit)} /> : "—"}</td>
                              <td className="px-[15px] py-[11px] text-end">{Number(l.credit) !== 0 ? <MoneyDisplay currencyLabel={baseLabel} value={Number(l.credit)} /> : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div className="p-[20px] text-center text-[12.5px] text-ink-muted">{t("salesInvoices.journal.loading")}</div>
                )
              ) : (
                <div className="p-[20px] text-center text-[12.5px] text-ink-muted">{t("salesInvoices.journal.none")}</div>
              )}
            </Card>
          ),
        },
        {
          key: "payments",
          label: t("salesInvoices.tab.payments"),
          content: (
            <div className="flex flex-col gap-[14px]">
              <Card className="p-[16px_18px]">
                <dl className="grid grid-cols-2 gap-[14px] text-[13px] sm:grid-cols-3">
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">{t("salesInvoices.grandTotal")}</dt>
                    <dd className="mt-[4px]"><MoneyDisplay currencyLabel={docCurrencyLabel} value={toMajor(invoice.totals.grandTotal)} /></dd>
                  </div>
                  {settledInBase ? (
                    <div>
                      <dt className="text-[11px] font-semibold text-ink-faint">{t("salesInvoices.detail.baseTotal")}</dt>
                      <dd className="mt-[4px]"><MoneyDisplay currencyLabel={settlementLabel} value={settlementTotal} /></dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">{t("salesInvoices.payments.collected")}</dt>
                    <dd className="mt-[4px]"><MoneyDisplay currencyLabel={settlementLabel} value={toMajor(invoice.amountPaid)} /></dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-semibold text-ink-faint">{t("salesInvoices.payments.remaining")}</dt>
                    <dd className="mt-[4px]"><MoneyDisplay currencyLabel={settlementLabel} value={remaining} /></dd>
                  </div>
                </dl>
              </Card>
              {canPay ? (
                <Card className="p-[16px_18px]">
                  <h3 className="mb-[10px] font-display text-[13.5px] font-bold text-ink">{t("salesInvoices.payments.heading")}</h3>
                  {paymentError ? (
                    <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                      {paymentError}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-[10px]">
                    <div>
                      <span className="mb-[6px] block text-xs font-semibold text-ink-muted">{t("salesInvoices.payments.amount")}</span>
                      <MoneyInput aria-label={t("salesInvoices.payments.amount")} value={paymentAmount} onChange={setPaymentAmount} />
                    </div>
                    <SelectField
                      label={t("salesInvoices.payments.treasury")}
                      value={paymentTreasuryId}
                      onChange={setPaymentTreasuryId}
                      options={[{ value: "", label: t("salesInvoices.payments.treasuryPlaceholder") }, ...treasuryOptions]}
                    />
                    <SelectField
                      label={t("salesInvoices.payments.method")}
                      value={paymentMethod}
                      onChange={(v) => setPaymentMethod(v as typeof paymentMethod)}
                      options={[
                        { value: "cash", label: t("vouchers.method.cash") },
                        { value: "bank", label: t("vouchers.method.bank") },
                        { value: "cheque", label: t("vouchers.method.cheque") },
                        { value: "card", label: t("vouchers.method.card") },
                        { value: "wallet", label: t("vouchers.method.wallet") },
                      ]}
                    />
                    <p className="text-[11.5px] text-ink-muted">{t("salesInvoices.payments.hint")}</p>
                    <Button variant="primary" disabled={payBusy} onClick={handleRecordPayment}>
                      {t("salesInvoices.payments.submit")}
                    </Button>
                  </div>
                </Card>
              ) : (
                <div className="p-[16px] text-center text-[12.5px] text-ink-muted">{t("salesInvoices.payments.blocked")}</div>
              )}
            </div>
          ),
        },
        {
          key: "returns",
          label: t("salesInvoices.tab.returns"),
          content: (
            <Card className="p-[16px_18px]">
              {invoiceReturns.length === 0 ? (
                <p className="text-[12.5px] text-ink-muted">{t("salesInvoices.returns.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-[8px] text-[12.5px]">
                  {invoiceReturns.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-md border border-border px-[12px] py-[9px]">
                      <span className="mz-num font-semibold text-ink">{r.docNo ?? r.id}</span>
                      <span className="text-ink-muted">
                        <span className="mz-num">{r.date}</span> · {documentStatusLabel(r.status, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ),
        },
        {
          key: "installments",
          label: t("salesInvoices.tab.installments"),
          content: (
            <Card className="p-[16px_18px]">
              {invoicePlans.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-[10px]">
                  <p className="text-[12.5px] text-ink-muted">{t("salesInvoices.installments.empty")}</p>
                  {toMajor(invoice.remainingBalance) > 0 ? (
                    <Button
                      size="sm"
                      onClick={() => navigate("installment-plans", { kind: "create", prefill: { invoiceId: invoice.id } })}
                    >
                      {t("salesInvoices.row.newInstallmentPlan")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <ul className="flex flex-col gap-[8px] text-[12.5px]">
                  {invoicePlans.map((plan) => (
                    <li key={plan.id} className="flex items-center justify-between rounded-md border border-border px-[12px] py-[9px]">
                      <span className="mz-num font-semibold text-ink">{plan.docNo ?? plan.id}</span>
                      <span className="text-ink-muted">
                        <span className="mz-num">{plan.lines.length}</span> · {documentStatusLabel(plan.status, t)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ),
        },
        {
          key: "eta",
          label: t("salesInvoices.tab.eta"),
          content: (
            <Card className="p-[16px_18px]">
              {etaRows.length === 0 ? (
                <p className="text-[12.5px] text-ink-muted">{t("salesInvoices.eta.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-[8px] text-[12.5px]">
                  {etaRows.map((e) => (
                    <li key={e.id} className="flex items-center justify-between rounded-md border border-border px-[12px] py-[9px]">
                      <span className="font-semibold text-ink">{e.status}</span>
                      <span className="text-ink-muted">
                        {e.etaUuid ?? "—"} · <span className="mz-num">{format.dateTime(e.updatedAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ),
        },
        {
          key: "attachments",
          label: t("attachments.tab"),
          content: <AttachmentsTab entityType="sales-invoice" entityId={invoice.id} />,
        },
        {
          key: "audit",
          label: t("salesInvoices.tab.audit"),
          content: (
            <Card className="p-[16px_18px]">
              {auditRows.length === 0 ? (
                <p className="text-[12.5px] text-ink-muted">{t("salesInvoices.audit.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-[8px] text-[12.5px]">
                  {auditRows.map((row, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md border border-border px-[12px] py-[9px]">
                      <span className="text-ink">{row.action}</span>
                      <span className="text-ink-muted">
                        {row.actor} · <span className="mz-num">{format.dateTime(row.timestamp)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
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
  const { t } = useAppTranslation();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    InvoiceFilterKey,
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [customerFilter, setCustomerFilter] = useState<EntityPickerOption | null>(null);
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");

  /**
   * One filter object drives the rows, the chip counts and the KPI strip
   * (R1.1). They used to be three separate derivations over whatever the
   * client happened to hold, so applying a branch or a date range moved the
   * rows and left the totals alone.
   */
  const debouncedSearch = useDebounced(search);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const listFilter: SalesInvoiceListQueryDTO = useMemo(
    () => ({
      ...(statusFilter === "all" ? {} : { status: statusFilter }),
      ...(customerFilter ? { customerId: customerFilter.id } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(branchFilter ? { branchId: branchFilter } : {}),
      ...(warehouseFilter ? { warehouseId: warehouseFilter } : {}),
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      page,
      pageSize,
    }),
    [statusFilter, customerFilter, fromDate, toDate, branchFilter, warehouseFilter, debouncedSearch, page, pageSize],
  );

  // The rows are ONE page from the server; the counts and the KPI strip are
  // computed over the whole filtered set and strip the page out again, so the
  // total the pager needs is the «الكل» chip rather than the rows on screen.
  const [sort, setSort] = useState<DocumentListSort | undefined>(undefined);
  // Only the rows carry the sort: the counts and the KPI strip are the same
  // whatever order the page is drawn in.
  const query = useSalesInvoices(
    sort ? { ...listFilter, sort: "docNo", sortDir: sort.direction } : listFilter,
  );
  const invoices = query.data ?? [];
  const counts = useSalesInvoiceCounts(listFilter).data ?? {};
  const stats = useSalesInvoiceStats(listFilter).data ?? null;

  // A filter that changes the result set must not leave the pager on a page
  // that no longer exists — the server would answer with nothing at all.
  // Only a CHANGE resets it: running on mount sent a reloaded or linked
  // `?page=3` back to the first page before its rows were ever asked for.
  const filterKey = JSON.stringify([
    statusFilter,
    customerFilter?.id ?? null,
    fromDate,
    toDate,
    branchFilter,
    warehouseFilter,
    debouncedSearch,
  ]);
  const settledFilterKey = useRef(filterKey);
  useEffect(() => {
    if (settledFilterKey.current === filterKey) return;
    settledFilterKey.current = filterKey;
    setPage(1);
  }, [filterKey, setPage]);
  const listBranches = useBranches().data ?? [];
  const listWarehouses = useWarehouses().data ?? [];
  const listCustomers = useCustomers().data ?? [];
  // `#/sales/sales-invoices` · `…/new` · `…/<docNo|id>`
  const subPage = useSubPage();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const savedNotice = useAlreadySavedNotice();
  const { navigate } = useNavigation();
  useScreenIntent((intent) => {
    const customerId = intent.prefill?.customerId;
    subPage.open(...(customerId ? ["new", customerId] : ["new"]));
  });

  const today = todayIso();
  const listConfirm = useConfirmSalesInvoice();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);

  const [rowRerate, setRowRerate] = useState<RowRerate | null>(null);

  async function confirmRow(row: Pick<SalesInvoiceDTO, "id" | "docNo" | "version" | "totals">, acknowledgeTaxRecalculation = false): Promise<RowActionOutcome | void> {
    if (confirmingId) return;
    setRowError(null);
    setRowNotice(null);
    setConfirmingId(row.id);
    try {
      // N-9: the version the LIST row was served. Without it a second till that
      // already moved this invoice wins silently.
      const confirmed = await listConfirm.mutateAsync({ id: row.id, expectedVersion: row.version, ...(acknowledgeTaxRecalculation ? { acknowledgeTaxRecalculation } : {}) });
      setRowRerate(null);
      setRowNotice(confirmed.taxRecalculated?.message ?? null);
    } catch (err) {
      if (err instanceof SalesTaxRecalculationPendingError) setRowRerate({ row, message: err.message, recalculated: err.recalculatedGrandTotal });
      else {
        setRowRerate(null);
        setRowError(errorMessage(err, t("common.failed")));
      }
      return RowActionOutcome.Refused;
    } finally {
      setConfirmingId(null);
    }
  }

  const [firstSegment] = subPage.segments;
  // Fetched by id or document number rather than searched for in `invoices`:
  // the list is one page now, so a deep link into a document on any later page
  // would otherwise read as "not found".
  const selectedId = firstSegment !== undefined && firstSegment !== "new" ? firstSegment : null;
  const selectedQuery = useSalesInvoice(selectedId);
  const selected = selectedQuery.data ?? null;


  /**
   * المقبوضات غير المخصصة — money taken from customers that is not yet applied
   * to any invoice (R3.2). Without it the strip shows what is owed but not the
   * cash already sitting against it, and the two never reconcile on screen.
   */
  const receipts = useVouchers({ type: "customer_collection", status: "confirmed" }).data ?? EMPTY;
  const unallocatedReceipts = useMemo(
    () => sumMajor(receipts.map((row) => row.allocationSummary?.unallocated ?? "0")),
    [receipts],
  );

  const kpi = {
    sales: majorOf(stats?.sales),
    collected: majorOf(stats?.collected),
    returned: majorOf(stats?.returned),
    remaining: majorOf(stats?.remaining),
  };


  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) +
    (branchFilter ? 1 : 0) +
    (warehouseFilter ? 1 : 0) +
    (customerFilter ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0);

  const totalRows = counts[statusFilter] ?? counts.all ?? invoices.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = invoices;

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "open", label: t("salesInvoices.status.open"), count: counts.open ?? 0 },
    { key: "overdue", label: t("salesInvoices.status.overdue"), count: counts.overdue ?? 0 },
    ...LIST_STATUSES.map((s) => ({ key: s, label: salesInvoiceStatusLabel(s, t), count: counts[s] ?? 0 })),
  ];

  const columns: DocumentListColumn<SalesInvoiceDTO>[] = [
    {
      key: "docNo",
      header: t("salesInvoices.col.docNo"),
      sortable: true,
      render: (inv) => (
        <div>
          <div className="mz-num font-semibold text-ink">{inv.docNo ?? t("docStatus.draft")}</div>
          <div className="text-[11.5px] text-ink-faint">
            {inv.customerNameAr} · <span className="mz-num">{inv.date}</span>
          </div>
        </div>
      ),
    },
    {
      key: "dueDate",
      header: t("salesInvoices.col.dueDate"),
      render: (inv) => (
        <div className="flex items-center gap-[8px]">
          <span className="mz-num text-ink-muted">{inv.dueDate}</span>
          {isOverdue(inv, today) ? (
            <StatusPill
              label={t("salesInvoices.overdueBy", {
                days: Math.max(0, Math.floor((new Date(today).getTime() - new Date(inv.dueDate).getTime()) / 86_400_000)),
              })}
              tone="danger"
            />
          ) : null}
        </div>
      ),
    },
    {
      key: "remaining",
      header: t("salesInvoices.col.remaining"),
      align: "end",
      render: (inv) => {
        const grand = toMajor(inv.totals.grandTotal);
        const paid = toMajor(inv.amountPaid);
        const returned = toMajor(inv.returnedCredit);
        const left = toMajor(inv.remainingBalance);
        return (
          <div className="flex flex-col items-end gap-[3px]">
            <MoneyDisplay value={left} />
            {returned > 0 ? (
              <span className="text-[11px] text-danger">
                − <MoneyDisplay value={returned} />
              </span>
            ) : null}
            {paid > 0 ? (
              <span className="text-[11px] text-success-ink">
                <MoneyDisplay value={paid} /> {t("salesInvoices.payments.collected")}
              </span>
            ) : null}
            {left <= 0 && grand > 0 ? <span className="text-[11px] text-success-ink">{t("salesInvoices.fullySettled")}</span> : null}
          </div>
        );
      },
      total: (rows) => <MoneyDisplay value={sumMajor(rows.map((inv) => inv.remainingBalance))} />,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (inv) => <StatusPill label={salesInvoiceStatusLabel(inv.status, t)} tone={STATUS_TONE[inv.status]} />,
    },
  ];

  if (firstSegment === "new") {
    return (
      <CreateInvoicePage
        onClose={subPage.close}
        onAlreadyCreated={(invoiceId) => {
          savedNotice.show(invoiceId);
          subPage.open(invoiceId);
        }}
        initialCustomerId={subPage.segments[1] ?? null}
      />
    );
  }

  // `#/sell/sales-invoices/<docNo>/print` — a destination, not an overlay, so
  // it survives a reload and leaves through the shell's own «رجوع».
  if (selected && subPage.segments[1] === "print") return <SalesInvoicePrintPage invoice={selected} />;

  return (
    <>
      <AlreadySavedNotice notice={savedNotice} openId={selectedId ?? null} message={t("salesInvoices.alreadyCreated")} dismissLabel={t("documents.alreadySaved.dismiss")} />
      {selected ? (
        <InvoiceDetailView invoice={selected} today={today} onPrint={() => subPage.open(selected.docNo ?? selected.id, "print")} />
      ) : (
        <div className="w-full">
          <ConfirmDialog
            open={rowRerate !== null}
            title={t("confirmPreview.rowTitle", { number: rowRerate?.row.docNo ?? t("docStatus.draft") })}
            consequence={
              rowRerate ? (
                <div role="status" className="flex flex-col gap-[6px]">
                  <p className="font-semibold">{rowRerate.message}</p>
                  <p>{t("confirmPreview.totals", { recalculated: twoDecimals(rowRerate.recalculated), shown: twoDecimals(rowRerate.row.totals.grandTotal) })}</p>
                </div>
              ) : null
            }
            confirmLabel={t("salesInvoices.confirm")}
            confirmDisabled={confirmingId !== null}
            onConfirm={() => {
              if (rowRerate) void confirmRow(rowRerate.row, true);
            }}
            onCancel={() => setRowRerate(null)}
          />
          {rowError ? (
            <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {rowError}
            </div>
          ) : null}
          {rowNotice ? (
            <div role="status" className="mb-[18px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
              {rowNotice}
            </div>
          ) : null}
          {query.isError ? (
            <Card className="mb-[18px] p-[18px_20px]">
              <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("salesInvoices.loadFailed")}</p>
              <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
                {t("common.retry")}
              </Button>
            </Card>
          ) : null}
          {(counts.overdue ?? 0) > 0 ? (
            <Card className="mb-[14px] flex flex-wrap items-center justify-between gap-[12px] border-s-[3px] border-s-danger p-[14px_18px]">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-danger">{t("salesInvoices.followUp.title")}</div>
                <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("salesInvoices.followUp.body", { count: counts.overdue ?? 0 })}</p>
              </div>
              <Button size="sm" onClick={() => { setStatusFilter("overdue"); setPage(1); }}>
                {t("salesInvoices.followUp.action")}
              </Button>
            </Card>
          ) : null}
          {(counts.partially_paid ?? 0) > 0 ? (
            <Card className="mb-[14px] flex items-center gap-[12px] p-[12px_18px]">
              <span className="mz-num font-display text-[19px] font-bold text-ink">{counts.partially_paid}</span>
              <span className="text-[12.5px] text-ink-muted">{t("salesInvoices.partiallyPaidCard")}</span>
            </Card>
          ) : null}
          <DocumentList<SalesInvoiceDTO>
            title={t("salesInvoices.title")}
            description={t("salesInvoices.description")}
            actions={
              <Button variant="primary" shortcut={modKeyLabel() + "+N"} onClick={() => subPage.open("new")}>
                {t("salesInvoices.new")}
              </Button>
            }
            listKey="sales-invoices"
            statsCollapsible
            stats={[
              { label: t("salesInvoices.stat.sales"), value: <MoneyDisplay value={kpi.sales} /> },
              { label: t("salesInvoices.stat.collected"), value: <MoneyDisplay value={kpi.collected} /> },
              { label: t("salesInvoices.stat.returned"), value: <MoneyDisplay value={kpi.returned} /> },
              { label: t("salesInvoices.stat.unallocatedReceipts"), value: <MoneyDisplay value={unallocatedReceipts} /> },
              { label: t("salesInvoices.stat.remaining"), value: <MoneyDisplay value={kpi.remaining} />, valueTone: kpi.remaining > 0 ? "danger" : "default" },
            ]}
            attentionBanners={[
          {
            key: "overdue",
            label: t("salesInvoices.banner.overdue", { count: counts.overdue ?? 0 }),
            count: counts.overdue ?? 0,
            tone: "danger",
            onApply: () => {
              setStatusFilter("overdue");
              setPage(1);
            },
          },
        ]}
        statusChips={statusChips}
            sort={sort}
            onSortChange={(key) => {
              if (key !== "docNo") return;
              setSort((prev) => ({ key, direction: prev?.key === key && prev.direction === "asc" ? "desc" : "asc" }));
              setPage(1);
            }}
            activeStatusKey={statusFilter}
            onStatusChange={(key) => {
              setStatusFilter(key as InvoiceFilterKey);
              setPage(1);
            }}
            searchValue={searchText}
            onSearchChange={(v) => {
              setSearchText(v);
              setPage(1);
            }}
            searchPlaceholder={t("salesInvoices.searchPlaceholder")}
            filterBarCollapsible
            activeFilterCount={activeFilterCount}
            filterBarExtra={
              <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <SelectField
                  label={t("salesInvoices.filter.branch")}
                  value={branchFilter}
                  onChange={(v) => { setBranchFilter(v); setPage(1); }}
                  options={[{ value: "", label: t("salesInvoices.filter.allBranches") }, ...listBranches.map((b) => ({ value: b.id, label: b.name }))]}
                />
                <SelectField
                  label={t("salesInvoices.filter.warehouse")}
                  value={warehouseFilter}
                  onChange={(v) => { setWarehouseFilter(v); setPage(1); }}
                  options={[{ value: "", label: t("salesInvoices.filter.allWarehouses") }, ...listWarehouses.map((w) => ({ value: w.id, label: w.name }))]}
                />
                <EntityPicker
                  id="invoices-filter-customer"
                  label={t("salesInvoices.filter.customer")}
                  value={customerFilter}
                  onChange={(opt) => { setCustomerFilter(opt); setPage(1); }}
                  options={listCustomers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code }))}
                  placeholder={t("salesInvoices.filter.anyCustomer")}
                />
                <TextField label={t("salesInvoices.filter.from")} value={fromDate} onChange={setFromDate} type="date" />
                <TextField label={t("salesInvoices.filter.to")} value={toDate} onChange={setToDate} type="date" />
              </div>
            }
            columns={columns}
            rows={pageRows}
            loading={query.isLoading}
            rowKey={(inv) => inv.id}
            onRowClick={(inv) => subPage.open(inv.docNo ?? inv.id)}
            rowAction={(inv) => {
              const owing = toMajor(inv.remainingBalance) > 0 && (inv.status === "confirmed" || inv.status === "partially_paid");
              const posted = inv.status === "confirmed" || inv.status === "partially_paid" || inv.status === "paid";
              // Derived from THIS row's state — a voided invoice offers neither
              // a return nor a plan, a settled one offers no collection (R1.3).
              const menuItems: RowMenuItem[] = [
                { key: "view", label: t("common.view"), onSelect: () => subPage.open(inv.docNo ?? inv.id) },
                { key: "preview", label: t("salesInvoices.row.preview"), onSelect: () => setPreviewId(inv.id) },
                {
                  key: "print",
                  label: t("salesInvoices.share.print"),
                  onSelect: () => subPage.open(inv.docNo ?? inv.id, "print"),
                },
                ...(inv.status === "draft"
                  ? [
                      {
                        key: "confirm",
                        label: t("salesInvoices.confirm"),
                        disabled: confirmingId === inv.id,
                        onSelect: () => confirmRow(inv),
                      },
                    ]
                  : []),
                ...(posted
                  ? [
                      {
                        key: "return",
                        label: t("salesInvoices.row.newReturn"),
                        onSelect: () => navigate("sales-returns", { kind: "create", prefill: { invoiceId: inv.id } }),
                      },
                    ]
                  : []),
                ...(owing
                  ? [
                      {
                        key: "plan",
                        label: t("salesInvoices.row.newInstallmentPlan"),
                        onSelect: () => navigate("installment-plans", { kind: "create", prefill: { invoiceId: inv.id } }),
                      },
                    ]
                  : []),
              ];
              return (
                <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                  {owing ? (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => navigate("treasury-vouchers", { kind: "create", prefill: { customerId: inv.customerId, invoiceId: inv.id } })}
                    >
                      {t("salesInvoices.collect")}
                    </Button>
                  ) : null}
                  <RowMenu items={menuItems} label={t("salesInvoices.row.actionsFor", { doc: inv.docNo ?? inv.id })} />
                </div>
              );
            }}
            page={currentPage}
            pageCount={pageCount}
            onPageChange={setPage}
            pageSummary={
              <span className="flex flex-wrap items-center gap-[10px]">
                <span>
                  {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")}{" "}
                  <span className="mz-num">{totalRows}</span> {t("salesInvoices.showingSuffix")}
                </span>
                <span className="flex items-center gap-[6px] text-[12px] text-ink-muted">
                  {t("salesInvoices.rowsPerPage")}
                  <Select
                    aria-label={t("salesInvoices.rowsPerPage")}
                    size="sm"
                    value={String(pageSize)}
                    onChange={(v) => {
                      setPageSize(Number(v));
                      setPage(1);
                    }}
                    options={[10, 25, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
                  />
                </span>
              </span>
            }
            pageSize={pageSize}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            emptyState={
              <EmptyState
                title={t("salesInvoices.empty")}
                description={t("salesInvoices.emptyBody")}
                action={{ label: t("salesInvoices.new"), onClick: () => subPage.open("new") }}
              />
            }
          />
        </div>
      )}

      <InvoicePreviewPanel
        invoice={previewId === null ? null : (invoices.find((inv) => inv.id === previewId) ?? null)}
        onClose={() => setPreviewId(null)}
        onOpenFull={(inv) => {
          setPreviewId(null);
          subPage.open(inv.docNo ?? inv.id);
        }}
        onPrint={(inv) => {
          setPreviewId(null);
          subPage.open(inv.docNo ?? inv.id, "print");
        }}
      />
    </>
  );
}

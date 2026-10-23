import { useCallback, useMemo, useState } from "react";
import { errorMessage } from "../../lib/error-message";
import {
  Button,
  EntityPicker,
  IconButton,
  Money as MoneyDisplay,
  StatusPill,
  useFormat,
  type EntityPickerOption,
} from "@mezan/ui";
import type { ItemDTO, TaxRateDTO } from "@mezan/contracts";
import { PricingGuardDiscountTypeDTO, PricingGuardDocTypeDTO, type PricingGuardEvaluateRequestDTO } from "@mezan/contracts";
import { usePricingGuardPreview } from "../enh/pricing-guard/pricing-guard-hooks";
import { PricingGuardLineStatus, PricingGuardSummary } from "../enh/pricing-guard/PricingGuardLineStatus";
import { Money } from "@mezan/domain";
import { NumberField, SectionCard, SelectField, TextAreaField, TextField } from "../../settings/form-controls";
import { useBranches, useCreateSalesQuote, useItemSearch, useCustomers, usePriceLists, useStockBalance, useTaxRates } from "../../data/hooks";
import { ItemPicker, itemOption, ACTIVE_ITEMS } from "../ItemPicker";
import { DERIVED_TAX, TaxRateField, appliedTaxPercent, lineTaxPayload } from "../tax-rate-field";
import { useCustomerAging } from "../../data/partner-detail-hooks";
import { useWorkingLocation } from "../../data/hub-hooks";
import { useAppTranslation } from "../../i18n";
import {
  blankLine,
  plusDays,
  previewTotals,
  toDomainDiscount,
  toDomainLines,
  today,
  type DiscountKind,
  type LineDraft,
} from "./quote-model";
import { EMPTY } from "../../lib/empty";
import { useLinkedOpportunity } from "../enh/crm-pipeline/hooks";

const NO_TAX_RATES: readonly TaxRateDTO[] = [];
const NO_PICKED_ITEMS: ReadonlyMap<string, ItemDTO> = new Map();

/**
 * عرض سعر جديد — the create form, one card per section with a sticky summary
 * beside it. Every field is bound to a real entity: the customer to
 * `/customers` (and its own aging row, so the seller sees what this customer
 * already owes before quoting), the branch to `/branches`, each line to
 * `/items` — which is what carries the price, the VAT rate, the unit and the
 * GL accounts the conversion to an invoice needs. The unit price is seeded
 * from the customer's price list when they have one, falling back to the
 * item's own sale price.
 */
export function QuoteFormView({
  onClose,
  initialCustomerId = "",
  initialOpportunityId = "",
}: {
  onClose: () => void;
  initialCustomerId?: string;
  initialOpportunityId?: string;
}) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const customersQuery = useCustomers();
  const customers = customersQuery.data ?? EMPTY;
  const [pickedItems, setPickedItems] = useState<ReadonlyMap<string, ItemDTO>>(NO_PICKED_ITEMS);
  const catalogue = useItemSearch("", ACTIVE_ITEMS);
  const branchesQuery = useBranches();
  const branches = branchesQuery.data ?? [];
  const priceListsQuery = usePriceLists();
  const priceLists = priceListsQuery.data ?? EMPTY;
  const stockQuery = useStockBalance();
  const stockRows = stockQuery.data ?? [];
  const agingQuery = useCustomerAging();
  const workingLocation = useWorkingLocation();
  const create = useCreateSalesQuote();
  const deal = useLinkedOpportunity(initialOpportunityId).data;
  const linkedDeal = deal && deal.customerId === initialCustomerId ? deal : null;

  // Carried in from «عرض سعر جديد» on a customer's page; the id is in the URL, so it survives a reload.
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [branchId, setBranchId] = useState(workingLocation.branchId ?? "");
  const [date, setDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState(plusDays(30));
  const [currency, setCurrency] = useState("EGP");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [discountKind, setDiscountKind] = useState<DiscountKind>("percent");
  const [discountValue, setDiscountValue] = useState(0);
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const effectiveBranchId = branchId || workingLocation.branchId || branches.find((b) => b.isMain)?.id || "";

  const priceList = useMemo(() => {
    if (customer?.priceListId) return priceLists.find((p) => p.id === customer.priceListId) ?? null;
    return priceLists.find((p) => p.isBase && p.active) ?? null;
  }, [customer, priceLists]);

  /** The price this quote should open a line at: the customer's list, else the item's own sale price. */
  const priceFor = useCallback(
    (item: ItemDTO): number => {
      const listed = priceList?.lines.find((l) => l.itemId === item.id);
      return Number(listed?.price ?? item.salePrice ?? "0");
    },
    [priceList],
  );

  function onHandOf(itemId: string): number | null {
    const row = stockRows.find((r) => r.itemId === itemId);
    return row ? Number(row.onHand) : null;
  }

  const amountOwed = useMemo(() => {
    if (!customer) return null;
    const row = agingQuery.data?.rows.find((r) => r.customerId === customer.id);
    return row ? row.total : "0.000000";
  }, [customer, agingQuery.data]);

  const customerOptions = useMemo<EntityPickerOption[]>(
    () => customers.filter((c) => c.active).map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [customers],
  );
  const itemSublabel = (i: ItemDTO) => `${i.code} · ${format.money(priceFor(i))} ${format.currencyLabel}`;

  const taxRates = useTaxRates().data ?? NO_TAX_RATES;
  const domainLines = useMemo(() => toDomainLines(lines, [...pickedItems.values()], taxRates), [lines, pickedItems, taxRates]);
  const discount = useMemo(() => toDomainDiscount(discountKind, discountValue), [discountKind, discountValue]);
  // Local preview only — the server recomputes and is authoritative on create.
  const totals = useMemo(
    () => previewTotals(domainLines, discount, customer?.taxExempt ?? false),
    [domainLines, discount, customer],
  );
  const totalsByLineId = useMemo(() => new Map(totals.lines.map((l) => [l.lineId, l])), [totals]);

  const priceGuardRequest = useMemo<PricingGuardEvaluateRequestDTO | null>(() => {
    if (!customer || !effectiveBranchId || domainLines.length === 0) return null;
    return {
      docType: PricingGuardDocTypeDTO.SalesQuote,
      date,
      customerId: customer.id,
      branchId: effectiveBranchId,
      warehouseId: null,
      currency,
      discount:
        discount.type === "percent"
          ? { type: PricingGuardDiscountTypeDTO.Percent, percent: discount.percent }
          : { type: PricingGuardDiscountTypeDTO.Amount, amount: discount.amount.toString() },
      lines: domainLines.map((l) => ({
        lineId: l.lineId,
        itemId: l.itemId,
        qty: l.qty.toString(),
        unitPrice: l.unitPrice.toString(),
        discountPercent: l.discountPercent,
        taxRatePercent: l.taxRatePercent,
      })),
    };
  }, [customer, effectiveBranchId, domainLines, date, currency, discount]);
  const priceGuard = usePricingGuardPreview(priceGuardRequest);
  const priceGuardByLine = useMemo(() => new Map((priceGuard?.lines ?? []).map((l) => [l.lineId, l])), [priceGuard]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit() {
    setError(null);
    if (!customer) {
      setError(t("quotes.error.needCustomer"));
      return;
    }
    if (!effectiveBranchId) {
      setError(t("quotes.error.needBranch"));
      return;
    }
    if (lines.some((l) => l.itemId === "")) {
      setError(t("quotes.error.needItem"));
      return;
    }
    const quoteLines = domainLines.filter((l) => l.qty.scaled > 0n);
    if (quoteLines.length === 0) {
      setError(t("quotes.error.needLine"));
      return;
    }
    const quotedKeys = new Set(quoteLines.map((l) => l.lineId));
    if (lines.some((l) => quotedKeys.has(l.key) && l.unitPrice !== null && !Number.isFinite(l.unitPrice))) {
      setError(t("quotes.error.needUnitPrice"));
      return;
    }
    try {
      await create.mutateAsync({
        date,
        expiryDate,
        customerId: customer.id,
        customerNameAr: customer.nameAr,
        customerTaxExempt: customer.taxExempt,
        branchId: effectiveBranchId,
        ...(linkedDeal ? { opportunityId: linkedDeal.id } : {}),
        currency,
        notes: notes.trim() === "" ? null : notes.trim(),
        internalNotes: internalNotes.trim() === "" ? null : internalNotes.trim(),
        discount:
          discount.type === "percent"
            ? { type: "percent", percent: discount.percent }
            : { type: "amount", amount: discount.amount.toString() },
        priceListId: priceList?.id ?? null,
        lines: quoteLines.map((l) => ({
          ...lineTaxPayload(lines.find((draft) => draft.key === l.lineId)?.tax ?? DERIVED_TAX, taxRates, l.taxRatePercent),
          lineId: l.lineId,
          itemId: l.itemId,
          itemNameAr: l.itemNameAr,
          qty: l.qty.toString(),
          unitPrice: l.unitPrice.toString(),
          discountPercent: l.discountPercent,
        })),
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("eyebrow.sales.quotations")}</div>
          <h1 className="font-display text-xl font-bold text-ink">{t("quotes.new")}</h1>
          {linkedDeal ? <p className="mt-1 text-[12px] font-semibold text-ink-muted">{t("crmPipeline.quote.linked", { title: linkedDeal.title })}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending}>
            {t("quotes.saveDraft")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <SectionCard title={t("quotes.section.details")}>
            <div className="sm:col-span-2 flex flex-col gap-3">
              <EntityPicker
                id="quote-customer"
                label={t("quotes.field.customer")}
                value={customer ? { id: customer.id, label: customer.nameAr, sublabel: customer.code } : null}
                onChange={(opt) => {
                  setCustomerId(opt?.id ?? "");
                  const picked = opt ? customers.find((c) => c.id === opt.id) : null;
                  if (picked) setCurrency(picked.currency);
                }}
                options={customerOptions}
                placeholder={t("quotes.field.chooseCustomer")}
              />
              {customer && amountOwed !== null ? (
                <div className="flex items-center gap-2 rounded-[8px] border border-border px-3 py-2 text-[12.5px]">
                  <span className="text-ink-muted">{t("quotes.amountOwed")}</span>
                  <span className={Money.fromMajor(amountOwed).scaled > 0n ? "font-semibold text-danger" : "font-semibold text-ink"}>
                    <MoneyDisplay value={amountOwed} />
                  </span>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label={t("quotes.field.branch")}
                  value={effectiveBranchId}
                  onChange={setBranchId}
                  options={[
                    { value: "", label: t("quotes.field.chooseBranch") },
                    ...branches.filter((b) => b.active).map((b) => ({ value: b.id, label: `${b.name} · ${b.code}` })),
                  ]}
                />
                <SelectField
                  label={t("quotes.field.currency")}
                  value={currency}
                  onChange={setCurrency}
                  options={[{ value: "EGP", label: t("quotes.field.baseCurrency") }, ...(customer && customer.currency !== "EGP" ? [{ value: customer.currency, label: customer.currency }] : [])]}
                />
                <TextField label={t("quotes.field.date")} value={date} onChange={setDate} type="date" />
                <TextField label={t("quotes.field.expiry")} value={expiryDate} onChange={setExpiryDate} type="date" />
              </div>
            </div>
          </SectionCard>

          <SectionCard title={t("quotes.linesHeading")}>
            <div className="sm:col-span-2 flex flex-col gap-2">
              {catalogue.data?.length === 0 ? (
                <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-ink-muted">{t("quotes.noItems")}</div>
              ) : null}
              {lines.map((line, index) => {
                const item = pickedItems.get(line.itemId) ?? null;
                const lineTotals = totalsByLineId.get(line.key);
                const onHand = item ? onHandOf(item.id) : null;
                return (
                  <div key={line.key} className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
                    <div className="grid grid-cols-[minmax(200px,1fr)_84px_104px_112px_auto_auto] items-start gap-2">
                      <div className="min-w-0">
                        <ItemPicker
                          id={`quote-line-item-${line.key}`}
                          label={t("quotes.field.lineItem", { number: index + 1 })}
                          value={item ? itemOption(item) : null}
                          filter={ACTIVE_ITEMS}
                          sublabel={itemSublabel}
                          onChange={(picked) => {
                            if (picked) setPickedItems((prev) => new Map(prev).set(picked.id, picked));
                            updateLine(line.key, {
                              itemId: picked?.id ?? "",
                              unitPrice: picked ? priceFor(picked) : null,
                              tax: DERIVED_TAX,
                            });
                          }}
                          placeholder={t("quotes.field.itemPlaceholder")}
                        />
                      </div>
                      <div>
                        <NumberField label={t("common.qty")} value={line.qty} onChange={(v) => updateLine(line.key, { qty: v })} min={0} />
                      </div>
                      <div>
                        <NumberField
                          label={t("quotes.field.unitPrice")}
                          value={line.unitPrice ?? 0}
                          onChange={(v) => updateLine(line.key, { unitPrice: v })}
                          min={0}
                          disabled={item === null}
                        />
                      </div>
                      <div className="mt-[22px] text-end">
                        <div className="text-[13px] font-semibold text-ink">
                          <MoneyDisplay value={lineTotals ? Number(lineTotals.total.toString()) : 0} />
                        </div>
                        {item ? (
                          <div className="text-[11px] text-ink-muted">
                            {t("quotes.field.taxPercent")} {format.number(appliedTaxPercent(line.tax, taxRates, item.taxRatePercent))}%
                          </div>
                        ) : null}
                      </div>
                      <IconButton
                        aria-label={t("quotes.line.toggleDetails", { number: index + 1 })}
                        className="mt-[22px]"
                        onClick={() => updateLine(line.key, { expanded: !line.expanded })}
                      >
                        {line.expanded ? "▲" : "▼"}
                      </IconButton>
                      <IconButton
                        aria-label={t("quotes.line.remove", { number: index + 1 })}
                        className="mt-[22px]"
                        disabled={lines.length === 1}
                        onClick={() => setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== line.key)))}
                      >
                        ✕
                      </IconButton>
                    </div>

                    {item && onHand !== null ? (
                      onHand <= 0 && item.trackInventory ? (
                        <StatusPill label={t("quotes.line.outOfStock")} tone="danger" />
                      ) : item.trackInventory ? (
                        <div className="text-[11.5px] text-ink-muted">
                          {t("quotes.line.onHand")} <span className="mz-num">{format.qty(onHand)}</span>
                        </div>
                      ) : null
                    ) : null}

                    {item ? <PricingGuardLineStatus line={priceGuardByLine.get(line.key)} costVisible={priceGuard?.costVisible ?? false} /> : null}

                    {line.expanded && item ? (
                      <div className="grid gap-3 border-t border-border pt-2 sm:grid-cols-2">
                        <NumberField
                          label={t("quotes.field.discountPercent")}
                          value={line.discountPercent}
                          onChange={(v) => updateLine(line.key, { discountPercent: v })}
                          min={0}
                          max={100}
                        />
                        <TaxRateField
                          label={t("taxRateField.label")}
                          choice={line.tax}
                          onChange={(tax) => updateLine(line.key, { tax })}
                          taxRates={taxRates}
                          fallbackPercent={item.taxRatePercent}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              <Button variant="default" onClick={() => setLines((prev) => [...prev, blankLine()])}>
                {t("quotes.addLine")}
              </Button>
              <PricingGuardSummary evaluation={priceGuard} />
            </div>
          </SectionCard>

          <SectionCard title={t("quotes.section.pricing")} description={t("quotes.section.pricingHint")}>
            <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
              <SelectField
                label={t("quotes.field.discountType")}
                value={discountKind}
                onChange={(v) => setDiscountKind(v as DiscountKind)}
                options={[
                  { value: "percent", label: t("quotes.field.discountPercentOption") },
                  { value: "amount", label: t("quotes.field.discountAmountOption") },
                ]}
              />
              <NumberField
                label={t("quotes.field.discountValue")}
                value={discountValue}
                onChange={setDiscountValue}
                min={0}
                max={discountKind === "percent" ? 100 : undefined}
              />
            </div>
          </SectionCard>

          <SectionCard title={t("quotes.section.notes")}>
            <div className="sm:col-span-2 grid gap-3 sm:grid-cols-2">
              <TextAreaField label={t("quotes.field.notes")} value={notes} onChange={setNotes} />
              <TextAreaField
                label={t("quotes.field.internalNotes")}
                hint={t("quotes.field.internalNotesHint")}
                value={internalNotes}
                onChange={setInternalNotes}
              />
            </div>
          </SectionCard>

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
        </div>

        <div className="flex flex-col gap-3">
          <SectionCard title={t("quotes.summary.title")}>
            <div className="sm:col-span-2 flex flex-col gap-2 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t("quotes.summary.priceList")}</span>
                <span className="font-semibold text-ink">{priceList?.nameAr ?? t("quotes.summary.noPriceList")}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t("quotes.subtotal")}</span>
                <MoneyDisplay value={Number(totals.subtotal.toString())} />
              </div>
              {totals.invoiceDiscountTotal.scaled > 0n ? (
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">{t("quotes.summary.discount")}</span>
                  <MoneyDisplay value={-Number(totals.invoiceDiscountTotal.toString())} />
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <span className="text-ink-muted">{t("quotes.taxTotal")}</span>
                <MoneyDisplay value={Number(totals.taxTotal.toString())} />
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2 font-semibold text-ink">
                <span>{t("quotes.grandTotal")}</span>
                <MoneyDisplay value={Number(totals.grandTotal.toString())} />
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

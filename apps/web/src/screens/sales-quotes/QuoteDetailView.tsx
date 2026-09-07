import { useMemo, useState } from "react";
import { errorMessage } from "../../lib/error-message";
import { Button, DocumentDetail, DocumentStatusStepper, Money as MoneyDisplay, useFormat } from "@mezan/ui";
import { SectionCard, SelectField, TextField } from "../../settings/form-controls";
import {
  useAcceptSalesQuote,
  useBranches,
  useCancelSalesQuote,
  useConvertSalesQuoteToInvoice,
  useItems,
  useRejectSalesQuote,
  useSendSalesQuote,
  useWarehouses,
  type SalesQuoteRecord,
} from "../../data/hooks";
import { useAuditLog } from "../../data/platform-hooks";
import { useWorkingLocation } from "../../data/hub-hooks";
import { useAppTranslation } from "../../i18n";
import { useNavigation } from "../../navigation";
import { AttachmentsTab } from "../../attachments/AttachmentsTab";
import { Money, Qty, computeQuoteTotals, type SalesQuoteDiscount, type SalesQuoteLine } from "@mezan/domain";
import {
  AR_ACCOUNT_ID,
  COGS_ACCOUNT_ID,
  INVENTORY_ACCOUNT_ID,
  REVENUE_ACCOUNT_ID,
  STATUS_KEY,
  STATUS_TONE,
  TAX_ACCOUNT_ID,
  daysExpired,
  isExpired,
  plusDays,
} from "./quote-model";

const STEPS = [
  { key: "draft", labelKey: "quotes.status.draft" },
  { key: "sent", labelKey: "quotes.status.sent" },
  { key: "accepted", labelKey: "quotes.status.accepted" },
  { key: "converted", labelKey: "quotes.status.converted" },
] as const;

/**
 * تفاصيل عرض السعر — status banner, the four-step lifecycle, what this
 * document does and does not move, and the line table with the discount and
 * tax each line actually carries. A quote never posts to the GL and never
 * moves stock; the effects panel says so on the screen, because "what will
 * happen when I press this" is the question the seller is actually asking.
 */
export function QuoteDetailView({ quote, onPrint, onBack }: { quote: SalesQuoteRecord; onPrint?: () => void; onBack: () => void }) {
  const { openScreenAt } = useNavigation();
  const { t } = useAppTranslation();
  const format = useFormat();
  const items = useItems().data ?? [];
  const branches = useBranches().data ?? [];
  const warehouses = useWarehouses().data ?? [];
  const workingLocation = useWorkingLocation();
  const send = useSendSalesQuote();
  const accept = useAcceptSalesQuote();
  const reject = useRejectSalesQuote();
  const cancel = useCancelSalesQuote();
  const convert = useConvertSalesQuoteToInvoice();

  const [error, setError] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState(plusDays(30));
  const [warehouseId, setWarehouseId] = useState(workingLocation.warehouseId ?? "");
  const audit = useAuditLog({ entityType: "SALES_QUOTE", limit: 100 });

  const branchName = branches.find((b) => b.id === quote.branchId)?.name ?? quote.branchId;
  const expired = isExpired(quote);

  /**
   * Per-line figures come back from the SAME engine the server priced the
   * quote with — the wire record carries only the header totals, and
   * re-deriving a line total with JS floats is exactly how money goes wrong.
   */
  const lineTotals = useMemo(() => {
    const domainLines: SalesQuoteLine[] = quote.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      itemNameAr: l.itemNameAr,
      qty: Qty.fromMajor(l.qty),
      unitPrice: Money.fromMajor(l.unitPrice),
      discountPercent: l.discountPercent ?? 0,
      taxRatePercent: l.taxRatePercent ?? 0,
    }));
    const discount: SalesQuoteDiscount =
      quote.discount.type === "percent"
        ? { type: "percent", percent: quote.discount.percent }
        : { type: "amount", amount: Money.fromMajor(quote.discount.amount) };
    const computed = computeQuoteTotals(domainLines, discount, { taxExempt: quote.customerTaxExempt });
    return new Map(computed.lines.map((l) => [l.lineId, l]));
  }, [quote]);

  const auditRows = useMemo(() => {
    const events = audit.data?.events ?? [];
    return events.filter((e) => {
      const details = e.details as Record<string, unknown> | null;
      if (!details) return false;
      return details.id === quote.id || details.quoteId === quote.id || details.docNo === quote.docNo;
    });
  }, [audit.data, quote.id, quote.docNo]);

  async function doConvert() {
    setError(null);
    if (!warehouseId.trim()) {
      setError(t("quotes.error.needWarehouse"));
      return;
    }
    try {
      await convert.mutateAsync({
        id: quote.id,
        body: {
          dueDate,
          warehouseId: warehouseId.trim(),
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
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  const bannerKey =
    quote.status === "draft"
      ? "quotes.banner.draft"
      : quote.status === "sent"
        ? "quotes.banner.sent"
        : quote.status === "accepted"
          ? "quotes.banner.accepted"
          : quote.status === "rejected"
            ? "quotes.banner.rejected"
            : quote.status === "converted"
              ? "quotes.banner.converted"
              : "quotes.banner.cancelled";

  const effects = [
    <span key="stock">
      <b>{t("quotes.effect.noInventory")}</b> — {t("quotes.effect.noInventoryBody")}
    </span>,
    <span key="ar">
      <b>{t("quotes.effect.noPayable")}</b> — {t("quotes.effect.noPayableBody")}
    </span>,
    <span key="convert">
      <b>{quote.status === "converted" ? t("quotes.effect.converted") : t("quotes.effect.notConverted")}</b> —{" "}
      {t("quotes.effect.convertedBody")}
    </span>,
  ];

  const detailsTab = (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-2 text-start font-semibold">{t("quotes.col.item")}</th>
              <th className="p-2 text-start font-semibold">{t("common.qty")}</th>
              <th className="p-2 text-end font-semibold">{t("quotes.field.unitPrice")}</th>
              <th className="p-2 text-end font-semibold">{t("quotes.field.discountPercent")}</th>
              <th className="p-2 text-end font-semibold">{t("quotes.field.taxPercent")}</th>
              <th className="p-2 text-end font-semibold">{t("common.total")}</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line) => {
              const item = items.find((i) => i.id === line.itemId) ?? null;
              const qty = Number(line.qty);
              const unitPrice = Number(line.unitPrice);
              const discountPercent = line.discountPercent ?? 0;
              const taxPercent = line.taxRatePercent ?? 0;
              const computed = lineTotals.get(line.lineId);
              return (
                <tr key={line.lineId} className="border-b border-border">
                  <td className="p-2">
                    <div className="font-semibold text-ink">{line.itemNameAr}</div>
                    <div className="text-[11px] text-ink-muted">{item?.code ?? line.itemId}</div>
                  </td>
                  <td className="p-2">
                    <span className="mz-num">{format.qty(qty)}</span> {item ? item.baseUnitCode : null}
                  </td>
                  <td className="p-2 text-end">
                    <MoneyDisplay value={unitPrice} />
                  </td>
                  <td className="mz-num p-2 text-end">{format.number(discountPercent)}%</td>
                  <td className="mz-num p-2 text-end">{format.number(taxPercent)}%</td>
                  <td className="p-2 text-end">
                    <MoneyDisplay value={computed ? Number(computed.total.toString()) : 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-1 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">{t("quotes.subtotal")}</span>
          <MoneyDisplay value={Number(quote.totals.subtotal)} />
        </div>
        {Number(quote.totals.invoiceDiscountTotal) > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-ink-muted">{t("quotes.summary.discount")}</span>
            <MoneyDisplay value={-Number(quote.totals.invoiceDiscountTotal)} />
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <span className="text-ink-muted">{t("quotes.taxTotal")}</span>
          <MoneyDisplay value={Number(quote.totals.taxTotal)} />
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1 font-semibold text-ink">
          <span>{t("quotes.grandTotal")}</span>
          <MoneyDisplay value={Number(quote.totals.grandTotal)} />
        </div>
      </div>

      {quote.notes ? (
        <div>
          <div className="text-[12px] font-bold text-ink-muted">{t("quotes.field.notes")}</div>
          <p className="whitespace-pre-wrap text-[12.5px] text-ink">{quote.notes}</p>
        </div>
      ) : null}
      {quote.internalNotes ? (
        <div>
          <div className="text-[12px] font-bold text-ink-muted">{t("quotes.field.internalNotes")}</div>
          <p className="whitespace-pre-wrap text-[12.5px] text-ink">{quote.internalNotes}</p>
        </div>
      ) : null}
    </div>
  );

  const auditTab = (
    <div className="flex flex-col gap-2 text-[12.5px]">
      {audit.isLoading ? <span className="text-ink-muted">{t("common.loading")}</span> : null}
      {!audit.isLoading && auditRows.length === 0 ? <span className="text-ink-muted">{t("quotes.audit.empty")}</span> : null}
      {auditRows.map((row, i) => (
        <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2">
          <span className="text-ink">{row.action}</span>
          <span className="text-ink-muted">
            {row.actor} · {format.dateTime(row.timestamp)}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="w-full">
      <DocumentDetail
        title={quote.docNo ?? t("quotes.detailTitle")}
        statusLabel={t(STATUS_KEY[quote.status])}
        statusTone={STATUS_TONE[quote.status]}
        subtitle={quote.customerNameAr}
        summary={[
          { label: t("quotes.field.customer"), value: quote.customerNameAr },
          { label: t("quotes.field.date"), value: <span className="mz-num">{quote.date}</span> },
          {
            label: t("quotes.field.expiry"),
            value: <span className="mz-num">{quote.expiryDate}</span>,
            valueTone: expired ? "danger" : "default",
          },
          { label: t("quotes.field.branch"), value: branchName },
          { label: t("quotes.field.currency"), value: quote.currency },
          { label: t("common.total"), value: <MoneyDisplay value={Number(quote.totals.grandTotal)} /> },
        ]}
        effectsTitle={t("quotes.effectsTitle")}
        effects={effects}
        tabs={[
          { key: "details", label: t("quotes.tab.details"), content: detailsTab },
          { key: "attachments", label: t("attachments.tab"), content: <AttachmentsTab entityType="sales-quote" entityId={quote.id} /> },
          { key: "audit", label: t("quotes.tab.audit"), content: auditTab },
        ]}
        aside={
          <div className="flex flex-col gap-3">
            <SectionCard title={t("quotes.nextStepTitle")}>
              <div className="sm:col-span-2 flex flex-col gap-3">
                <p className="text-[12.5px] text-ink-muted">{t(bannerKey)}</p>
                {onPrint ? (
                  <Button variant="default" onClick={onPrint}>
                    {t("print.action.print")}
                  </Button>
                ) : null}
                {expired ? <p className="text-[12.5px] text-danger">{t("quotes.expiredAgo", { days: daysExpired(quote) })}</p> : null}

                {quote.status === "draft" ? (
                  <Button variant="primary" onClick={() => send.mutate(quote.id)} disabled={send.isPending}>
                    {t("quotes.send")}
                  </Button>
                ) : null}
                {quote.status === "sent" ? (
                  <div className="flex gap-2">
                    <Button variant="primary" onClick={() => accept.mutate(quote.id)} disabled={accept.isPending}>
                      {t("quotes.accept")}
                    </Button>
                    <Button variant="default" onClick={() => reject.mutate(quote.id)} disabled={reject.isPending}>
                      {t("quotes.reject")}
                    </Button>
                  </div>
                ) : null}
                {quote.status === "accepted" ? (
                  <div className="flex flex-col gap-2">
                    <TextField label={t("quotes.field.dueDate")} value={dueDate} onChange={setDueDate} type="date" />
                    <SelectField
                      label={t("quotes.field.warehouse")}
                      value={warehouseId}
                      onChange={setWarehouseId}
                      options={[
                        { value: "", label: t("quotes.field.chooseWarehouse") },
                        ...warehouses.filter((w) => w.active).map((w) => ({ value: w.id, label: `${w.name} · ${w.code}` })),
                      ]}
                    />
                    <Button variant="primary" onClick={doConvert} disabled={convert.isPending}>
                      {t("quotes.createInvoice")}
                    </Button>
                  </div>
                ) : null}
                {quote.status === "converted" ? (
                  <div className="rounded-[8px] bg-success-soft px-3 py-2 text-[12.5px] text-success-ink">
                    {t("quotes.alreadyConverted")}
                    {quote.convertedInvoiceId ? (
                      <div className="mt-1 flex items-center gap-[8px] text-[11.5px]">
                        <span>
                          {t("quotes.convertedInvoice")} <span className="mz-num">{quote.convertedInvoiceId}</span>
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => openScreenAt("sales-invoices", [quote.convertedInvoiceId!])}>
                          {t("quotes.viewInvoice")}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {quote.status === "draft" || quote.status === "sent" ? (
                  <Button variant="ghost" onClick={() => cancel.mutate(quote.id)} disabled={cancel.isPending}>
                    {t("quotes.cancel")}
                  </Button>
                ) : null}

                {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
              </div>
            </SectionCard>

            <SectionCard title={t("quotes.lifecycleTitle")}>
              <DocumentStatusStepper
                className="sm:col-span-2"
                steps={STEPS.map((s) => ({ key: s.key, label: t(s.labelKey) }))}
                currentKey={quote.status === "rejected" || quote.status === "cancelled" ? "sent" : quote.status}
                tone={quote.status === "rejected" || quote.status === "cancelled" ? "danger" : "brand"}
              />
            </SectionCard>
          </div>
        }
      />
    </div>
  );
}

import { ArabicCase, CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../../lib/count-phrase";
import { useMemo, useState } from "react";
import { errorMessage } from "../../lib/error-message";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type RowMenuItem,
} from "@mezan/ui";
import { QuotePrintPage } from "../../print/documents";
import { SelectField, TextField } from "../../settings/form-controls";
import {
  useAcceptSalesQuote,
  useBranches,
  useCancelSalesQuote,
  useCustomers,
  useRejectSalesQuote,
  useSendSalesQuote,
  useSalesQuotes,
  useSalesQuoteCounts,
  useSalesQuoteStats,
  type SalesQuoteListFilter,
  type SalesQuoteRecord,
} from "../../data/hooks";
import { useNavigation, useScreenIntent, useSubPage } from "../../navigation";
import { useAppTranslation } from "../../i18n";
import { majorOf } from "../../lib/money";
import { QuoteDetailView } from "./QuoteDetailView";
import { QuoteFormView } from "./QuoteFormView";
import { STATUS_KEY, STATUS_TONE, daysExpired, isExpired, type QuoteFilterKey } from "./quote-model";
import { EMPTY } from "../../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../../lib/url-state";

const PAGE_SIZES = [10, 25, 50, 100] as const;

/** One server-computed money total at the display boundary; the addition happened in `Money`. */
function money(value: unknown): number {
  return majorOf(value === null || value === undefined ? "0" : String(value));
}

/**
 * عروض الأسعار / Sales Quotations (docs/archive/catalog/01) — list, create and detail,
 * matched field for field against the live reference product's own quotes
 * screen (enumerated 2026-08-25), not against the written catalog: the catalog
 * records labels, and a label cannot tell you whether a field is a picker over
 * an entity or a text box.
 *
 * Value, not count, is what the header reports — a quotations pipeline is
 * judged in money — and the status axis carries the derived منتهي (expired)
 * bucket the stored status set has no value for.
 */
export function SalesQuotesScreen() {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const format = useFormat();

  const customers = useCustomers().data ?? EMPTY;
  const branches = useBranches().data ?? [];
  const { openScreenAt } = useNavigation();
  const send = useSendSalesQuote();
  const accept = useAcceptSalesQuote();
  const reject = useRejectSalesQuote();
  const cancel = useCancelSalesQuote();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  async function runTransition(
    id: string,
    transition: { mutateAsync: (input: { id: string; expectedVersion?: number }) => Promise<unknown> },
    expectedVersion?: number,
  ): Promise<RowActionOutcome | void> {
    if (pendingId) return;
    setRowError(null);
    setPendingId(id);
    try {
      // N-9: the version this screen was served. Another till that already moved
      // this quote wins, and this call is refused by name rather than silently.
      await transition.mutateAsync({ id, expectedVersion });
    } catch (err) {
      setRowError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    } finally {
      setPendingId(null);
    }
  }

  // The sub-page lives in the URL: `#/sales/quotes`, `…/new`, `…/<id>`.
  const subPage = useSubPage();
  useScreenIntent((intent) => {
    const customerId = intent.prefill?.customerId;
    subPage.open(...(customerId ? ["new", customerId] : ["new"]));
  });

  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    QuoteFilterKey,
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [branchFilter, setBranchFilter] = useUrlParam("branch");
  const [customerFilter, setCustomerFilter] = useState<EntityPickerOption | null>(null);
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  /**
   * One filter for the rows, the chips and the KPI strip (R1.1). The screen
   * used to narrow by branch, customer and free text in the browser while the
   * three money tiles were added up as JS numbers over every quote the server
   * had sent, so applying a branch moved the table and left the header alone.
   */
  const filter = useMemo<SalesQuoteListFilter>(
    () => ({
      status: statusFilter,
      branchId: branchFilter || undefined,
      customerId: customerFilter?.id,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
      search: search.trim() || undefined,
    }),
    [statusFilter, branchFilter, customerFilter, fromDate, toDate, search],
  );

  const query = useSalesQuotes(filter);
  const filtered = query.data ?? [];
  const counts = useSalesQuoteCounts(filter).data ?? {};
  const stats = useSalesQuoteStats(filter).data ?? {};

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const activeFilterCount =
    (statusFilter === "all" ? 0 : 1) +
    (branchFilter ? 1 : 0) +
    (customerFilter ? 1 : 0) +
    (fromDate ? 1 : 0) +
    (toDate ? 1 : 0);

  const customerOptions = useMemo<EntityPickerOption[]>(
    () => customers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [customers],
  );

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "draft", label: t("quotes.status.draft"), count: counts.draft ?? 0 },
    { key: "sent", label: t("quotes.status.sent"), count: counts.sent ?? 0 },
    { key: "accepted", label: t("quotes.status.accepted"), count: counts.accepted ?? 0 },
    { key: "rejected", label: t("quotes.status.rejected"), count: counts.rejected ?? 0 },
    { key: "expired", label: t("quotes.status.expired"), count: counts.expired ?? 0 },
    { key: "converted", label: t("quotes.status.converted"), count: counts.converted ?? 0 },
  ];

  const columns: DocumentListColumn<SalesQuoteRecord>[] = [
    {
      key: "docNo",
      header: t("quotes.col.docNo"),
      render: (q) => (
        <div>
          <div className="mz-num font-semibold text-ink">{q.docNo ?? t("quotes.status.draft")}</div>
          <div className="text-[11px] text-ink-muted">
            {q.customerNameAr} · <span className="mz-num">{q.date}</span>
          </div>
        </div>
      ),
    },
    {
      key: "expiry",
      header: t("quotes.col.expiry"),
      render: (q) => (
        <div>
          <div className="mz-num">{q.expiryDate}</div>
          {isExpired(q) ? (
            <div className="text-[11px] text-danger">{t("quotes.expiredAgo", { days: countPhrase(daysExpired(q), CountedNoun.Day, ArabicCase.Oblique) })}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: "total",
      header: t("common.total"),
      align: "end",
      render: (q) => <MoneyDisplay value={Number(q.totals.grandTotal)} />,
    },
    {
      key: "status",
      header: t("common.status"),
      render: (q) => <StatusPill label={t(STATUS_KEY[q.status])} tone={STATUS_TONE[q.status]} />,
    },
  ];

  const [firstSegment] = subPage.segments;
  if (firstSegment === "new") return <QuoteFormView onClose={subPage.close} initialCustomerId={subPage.segments[1] ?? ""} initialOpportunityId={subPage.segments[2] ?? ""} />;
  if (firstSegment !== undefined) {
    const quote = filtered.find((q) => q.id === firstSegment || q.docNo === firstSegment);
    // `#/sell/quotes/<docNo>/print` — a destination, not an overlay, the way
    // the sales invoice's print page already is (P-6).
    if (quote && subPage.segments[1] === "print") return <QuotePrintPage quote={quote} />;
    if (quote) return <QuoteDetailView quote={quote} onPrint={() => subPage.open(quote.docNo ?? quote.id, "print")} onBack={subPage.close} />;
    if (!query.isLoading) {
      return (
        <div className="w-full p-8 text-center text-sm text-ink-muted">
          {t("quotes.notFound")}
          <div className="mt-3">
            <Button variant="default" onClick={subPage.close}>
              {t("quotes.backToList")}
            </Button>
          </div>
        </div>
      );
    }
    return <div className="w-full p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>;
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("quotes.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}
      <DocumentList<SalesQuoteRecord>
        loadFailed={query.isError}
        title={t("quotes.title")}
        description={t("quotes.description")}
        actions={
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("quotes.new")}
          </Button>
        }
        listKey="sales-quotes"
        statsCollapsible
        stats={[
          { label: t("quotes.stat.totalValue"), value: <MoneyDisplay value={money(stats.total)} /> },
          { label: t("quotes.stat.acceptedValue"), value: <MoneyDisplay value={money(stats.accepted)} /> },
          { label: t("quotes.stat.convertedValue"), value: <MoneyDisplay value={money(stats.converted)} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as QuoteFilterKey);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(v) => {
          setSearchText(v);
          setPage(1);
        }}
        searchPlaceholder={t("quotes.search.placeholder")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField
              label={t("quotes.filter.branch")}
              value={branchFilter}
              onChange={(v) => {
                setBranchFilter(v);
                setPage(1);
              }}
              options={[
                { value: "", label: t("quotes.filter.allBranches") },
                ...branches.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            <EntityPicker
              id="quotes-filter-customer"
              label={t("quotes.filter.customer")}
              value={customerFilter}
              onChange={(opt) => {
                setCustomerFilter(opt);
                setPage(1);
              }}
              options={customerOptions}
              placeholder={t("quotes.filter.anyCustomer")}
            />
            <TextField label={t("quotes.filter.from")} value={fromDate} onChange={setFromDate} type="date" />
            <TextField label={t("quotes.filter.to")} value={toDate} onChange={setToDate} type="date" />
          </div>
        }
        columns={columns}
        rows={pageRows}
        rowKey={(q) => q.id}
        onRowClick={(q) => subPage.open(q.docNo ?? q.id)}
        rowAction={(q) => {
          const live = q.status === "draft" || q.status === "sent";
          /**
           * Derived from THIS quote's state (R1.3): only a draft can be sent,
           * only a sent quote can be accepted or rejected, only an accepted one
           * converts into an invoice (R2.11), and a converted quote offers the
           * invoice it became instead of any of those.
           */
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("quotes.row.view"), onSelect: () => subPage.open(q.docNo ?? q.id) },
            { key: "print", label: t("print.action.print"), onSelect: () => subPage.open(q.docNo ?? q.id, "print") },
            ...(q.status === "draft"
              ? [{ key: "send", label: t("quotes.send"), disabled: pendingId === q.id, onSelect: () => runTransition(q.id, send, q.version) }]
              : []),
            ...(q.status === "sent"
              ? [
                  { key: "accept", label: t("quotes.accept"), disabled: pendingId === q.id, onSelect: () => runTransition(q.id, accept, q.version) },
                  { key: "reject", label: t("quotes.reject"), disabled: pendingId === q.id, onSelect: () => runTransition(q.id, reject, q.version) },
                ]
              : []),
            ...(q.status === "accepted"
              ? [{ key: "convert", label: t("quotes.createInvoice"), onSelect: () => subPage.open(q.docNo ?? q.id) }]
              : []),
            ...(q.status === "converted" && q.convertedInvoiceId
              ? [{ key: "invoice", label: t("quotes.viewInvoice"), onSelect: () => openScreenAt("sales-invoices", [q.convertedInvoiceId!]) }]
              : []),
            ...(live
              ? [
                  {
                    key: "cancel",
                    label: t("quotes.cancel"),
                    tone: "danger" as const,
                    disabled: pendingId === q.id,
                    onSelect: () => runTransition(q.id, cancel, q.version),
                  },
                ]
              : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              {q.status === "draft" ? (
                <Button size="sm" variant="default" disabled={pendingId === q.id} onClick={() => void runTransition(q.id, send, q.version)}>
                  {t("quotes.send")}
                </Button>
              ) : null}
              <RowMenu items={menuItems} label={t("quotes.row.actionsFor", { doc: q.docNo ?? q.id })} />
            </div>
          );
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{format.number(pageRows.length)}</span> {t("common.of")}{" "}
            <span className="mz-num">{format.number(filtered.length)}</span> {t("quotes.showingSuffix")}
          </>
        }
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : (
            <EmptyState
              title={t("quotes.empty")}
              description={t("quotes.emptyBody")}
              action={{ label: t("quotes.new"), onClick: () => subPage.open("new") }}
            />
          )
        }
      />
    </div>
  );
}

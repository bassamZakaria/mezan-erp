import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  EntityPicker,
  Money as MoneyDisplay,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
} from "@mezan/ui";
import { SelectField, TextField } from "../../settings/form-controls";
import { useBranches, useCustomers, useSalesQuotes, type SalesQuoteRecord } from "../../data/hooks";
import { useScreenIntent, useSubPage } from "../../navigation";
import { useAppTranslation } from "../../i18n";
import { QuoteDetailView } from "./QuoteDetailView";
import { QuoteFormView } from "./QuoteFormView";
import { STATUS_KEY, STATUS_TONE, daysExpired, isExpired, type QuoteFilterKey } from "./quote-model";

/**
 * عروض الأسعار / Sales Quotations (docs/catalog/01) — list, create and detail,
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
  const format = useFormat();
  const query = useSalesQuotes();
  const quotes = query.data ?? [];
  const customers = useCustomers().data ?? [];
  const branches = useBranches().data ?? [];

  // The sub-page lives in the URL: `#/sales/quotes`, `…/new`, `…/<id>`.
  const subPage = useSubPage();
  useScreenIntent(() => subPage.open("new"));

  const [statusFilter, setStatusFilter] = useState<QuoteFilterKey>("all");
  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState<EntityPickerOption | null>(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const counts = useMemo(() => {
    const c: Record<QuoteFilterKey, number> = {
      all: quotes.length,
      draft: 0,
      sent: 0,
      accepted: 0,
      rejected: 0,
      converted: 0,
      cancelled: 0,
      expired: 0,
    };
    for (const q of quotes) {
      c[q.status] += 1;
      if (isExpired(q)) c.expired += 1;
    }
    return c;
  }, [quotes]);

  /** The three figures the header reports, in money — total, accepted and converted value. */
  const values = useMemo(() => {
    let total = 0;
    let accepted = 0;
    let converted = 0;
    for (const q of quotes) {
      const amount = Number(q.totals.grandTotal);
      total += amount;
      if (q.status === "accepted") accepted += amount;
      if (q.status === "converted") converted += amount;
    }
    return { total, accepted, converted };
  }, [quotes]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return quotes.filter((q) => {
      if (statusFilter === "expired" ? !isExpired(q) : statusFilter !== "all" && q.status !== statusFilter) return false;
      if (branchFilter && q.branchId !== branchFilter) return false;
      if (customerFilter && q.customerId !== customerFilter.id) return false;
      if (fromDate && q.date < fromDate) return false;
      if (toDate && q.date > toDate) return false;
      if (needle !== "") {
        const haystack = `${q.docNo ?? ""} ${q.customerNameAr}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [quotes, statusFilter, branchFilter, customerFilter, fromDate, toDate, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const customerOptions = useMemo<EntityPickerOption[]>(
    () => customers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code })),
    [customers],
  );

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    { key: "draft", label: t("quotes.status.draft"), count: counts.draft },
    { key: "sent", label: t("quotes.status.sent"), count: counts.sent },
    { key: "accepted", label: t("quotes.status.accepted"), count: counts.accepted },
    { key: "rejected", label: t("quotes.status.rejected"), count: counts.rejected },
    { key: "expired", label: t("quotes.status.expired"), count: counts.expired },
    { key: "converted", label: t("quotes.status.converted"), count: counts.converted },
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
            <div className="text-[11px] text-danger">{t("quotes.expiredAgo", { days: daysExpired(q) })}</div>
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
  if (firstSegment === "new") return <QuoteFormView onClose={subPage.close} />;
  if (firstSegment !== undefined) {
    const quote = quotes.find((q) => q.id === firstSegment || q.docNo === firstSegment);
    if (quote) return <QuoteDetailView quote={quote} onBack={subPage.close} />;
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
      <DocumentList<SalesQuoteRecord>
        eyebrow={t("eyebrow.sales.quotations")}
        title={t("quotes.title")}
        description={t("quotes.description")}
        actions={
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("quotes.new")}
          </Button>
        }
        stats={[
          { label: t("quotes.stat.totalValue"), value: <MoneyDisplay value={values.total} /> },
          { label: t("quotes.stat.acceptedValue"), value: <MoneyDisplay value={values.accepted} /> },
          { label: t("quotes.stat.convertedValue"), value: <MoneyDisplay value={values.converted} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as QuoteFilterKey);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder={t("quotes.search.placeholder")}
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
        rowAction={(q) => (
          <div className="flex items-center gap-2">
            {q.status === "draft" ? (
              <Button size="sm" variant="default" onClick={() => subPage.open(q.docNo ?? q.id)}>
                {t("quotes.send")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => subPage.open(q.docNo ?? q.id)}>
              {t("common.show")}
            </Button>
          </div>
        )}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{format.number(pageRows.length)}</span> {t("common.of")}{" "}
            <span className="mz-num">{format.number(filtered.length)}</span> {t("quotes.showingSuffix")}
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? t("common.loading") : t("quotes.empty")}
          </div>
        }
      />
    </div>
  );
}

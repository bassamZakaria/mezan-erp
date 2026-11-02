import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ReportDrillDownFactFormat, reportDrillDownSchema, type ReportDrillDownDTO } from "@mezan/contracts";
import { Money, Qty, SidePanel, type ReportRunnerEntityRef } from "@mezan/ui";
import { useApi } from "../../data/ApiContext";
import { ApiError, loaderError } from "../../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { WEB_TRANSLATION_KEYS } from "../../i18n/catalog";
import { pathForRoute } from "../../routing";
import type { ScreenKey } from "../../router/screens";
import { errorMessage } from "../../lib/error-message";

/**
 * The drill-down panel a report cell opens (A5).
 *
 * A report row is an aggregate; this answers what it is made of by going back
 * to the posted documents, which is why the list comes from the server rather
 * than from the rows already loaded — the browser holds the report's summary,
 * not the sales invoices behind it.
 */

/** Where a source document lives in the shell. Null where the type has no own page. */
const SCREEN_BY_DOC_TYPE: Readonly<Record<ReportDrillDownDTO["documents"][number]["type"], ScreenKey | null>> = {
  SALES_INVOICE: "sales-invoices",
  PURCHASE_INVOICE: "purchase-invoices",
  JOURNAL_ENTRY: "journals",
  STOCK_MOVEMENT: null,
  SALES_QUOTE: "quotes",
  CRM_OPPORTUNITY: null,
};

const SALES_FUNNEL_KINDS: ReadonlySet<string> = new Set(["rep", "funnel-stage", "pipeline-stage"]);

function drillDownRoot(kind: string): string {
  return SALES_FUNNEL_KINDS.has(kind) ? "/sales-funnel/drill-down" : "/reports/drill-down";
}

/**
 * A panel must be asked for the window its figure was computed over, as the
 * server echoed it, or it disagrees with the row it opened from — the account
 * panel against the statements (D281), the customer, supplier and item panels
 * against the ladders, the by-supplier/by-customer periods and the stock
 * reports (D286).
 *
 * Reports name the same two bounds differently: `asOfDate` alone on an as-of
 * ladder, `periodFrom`/`periodTo` on the income statement, `dateFrom`/`dateTo`
 * on the sales and purchases periods, `fromDate`/`toDate` on the withholding
 * return.
 */
export function drillDownQuery(kind: string, reportParams?: Readonly<Record<string, unknown>> | null): string {
  if (!reportParams) return "";
  const text = (...keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const value = reportParams[key];
      if (typeof value === "string" && value !== "") return value;
    }
    return undefined;
  };
  const search = new URLSearchParams();
  const asOfDate = text("asOfDate");
  const fromDate = asOfDate ? undefined : text("periodFrom", "dateFrom", "fromDate");
  const toDate = asOfDate ?? text("periodTo", "dateTo", "toDate");
  if (fromDate) search.set("fromDate", fromDate);
  if (toDate) search.set("asOfDate", toDate);
  const branchId = text("branchId");
  if (branchId) search.set("branchId", branchId);
  // Only the item panel narrows by warehouse; the stock reports are the only
  // ones that carry the parameter.
  const warehouseId = kind === "item" ? text("warehouseId") : undefined;
  if (warehouseId) search.set("warehouseId", warehouseId);
  const ownerUserId = SALES_FUNNEL_KINDS.has(kind) ? text("ownerUserId") : undefined;
  if (ownerUserId) search.set("ownerUserId", ownerUserId);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

function useDrillDown(entity: ReportRunnerEntityRef | null, reportParams?: Readonly<Record<string, unknown>> | null) {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const query = entity ? drillDownQuery(entity.kind, reportParams) : "";
  return useQuery<ReportDrillDownDTO, ApiError>({
    queryKey: ["reports", "drill-down", entity?.kind, entity?.id, query],
    enabled: session !== null && entity !== null,
    queryFn: async () => {
      const res = await request(`${drillDownRoot(entity?.kind ?? "")}/${entity?.kind}/${encodeURIComponent(entity?.id ?? "")}${query}`);
      if (!res.ok) throw await loaderError(res, t("reportDrill.failed"), t);
      return reportDrillDownSchema.parse(await res.json());
    },
  });
}

/** The same overlay the report column headers use: a key the catalogue lacks falls back to the server's Arabic. */
function overlay(key: string, fallback: string, t: (k: AppTranslationKey) => string): string {
  return WEB_TRANSLATION_KEYS.has(key) ? t(key as AppTranslationKey) : fallback;
}

export function ReportDrillDownPanel({
  entity,
  onClose,
  reportParams,
}: {
  entity: ReportRunnerEntityRef | null;
  onClose: () => void;
  reportParams?: Readonly<Record<string, unknown>> | null;
}) {
  const { t } = useAppTranslation();
  const query = useDrillDown(entity, reportParams);
  const data = query.data ?? null;

  return (
    <SidePanel
      open={entity !== null}
      onClose={onClose}
      title={data?.titleAr ?? entity?.label ?? t("reportDrill.heading")}
      description={data?.subtitleAr ?? undefined}
    >
      {query.isFetching && !data ? (
        <p className="p-[21px] text-[12.5px] text-ink-muted">{t("reportDrill.loading")}</p>
      ) : query.isError ? (
        <p role="alert" className="p-[21px] text-[12.5px] text-danger-ink">
          {errorMessage(query.error, t("reportDrill.failed"))}
        </p>
      ) : data ? (
        <div className="flex flex-col gap-[18px] p-[21px]">
          <dl className="grid grid-cols-2 gap-[1px] overflow-hidden rounded-md border border-border bg-border">
            {data.facts.map((fact) => (
              <div key={fact.key} className="flex flex-col gap-[3px] bg-surface p-[11px_13px]">
                <dt className="text-[11.5px] text-ink-muted">
                  {overlay(`reportDrill.fact.${fact.key}`, fact.labelAr, t)}
                </dt>
                <dd className="text-[13.5px] font-semibold text-ink">
                  {fact.format === ReportDrillDownFactFormat.Money ? <Money value={fact.value} currencyLabel={t("ui.currency")} /> : <span className="mz-num">{fact.value}</span>}
                </dd>
              </div>
            ))}
          </dl>

          <section className="flex flex-col gap-[8px]">
            <h3 className="text-[12.5px] font-bold text-ink">{t("reportDrill.documents")}</h3>
            {data.documents.length === 0 ? (
              <p className="text-[12px] text-ink-muted">{t("reportDrill.noDocuments")}</p>
            ) : (
              <ul className="flex flex-col gap-[6px]">
                {data.documents.map((doc) => {
                  const screen = SCREEN_BY_DOC_TYPE[doc.type];
                  const label = overlay(`reportDrill.docType.${doc.type}`, doc.type, t);
                  const status = overlay(`reportDrill.status.${doc.status}`, doc.status, t);
                  const body = (
                    <>
                      <span className="flex flex-col gap-[2px]">
                        <span className="mz-num text-[12.5px] font-semibold text-ink">{doc.docNo}</span>
                        <span className="text-[11px] text-ink-muted">
                          {label} · <span className="mz-num">{doc.date}</span> · {status}
                        </span>
                      </span>
                      <span className="mz-num shrink-0 text-[12.5px] font-semibold text-ink">
                        {doc.amountFormat === "money" ? <Money value={doc.amount} currencyLabel={t("ui.currency")} /> : <Qty value={doc.amount} />}
                      </span>
                    </>
                  );
                  const shell = "flex items-center justify-between gap-[10px] rounded-md border border-border bg-surface p-[9px_12px]";
                  return (
                    <li key={`${doc.type}-${doc.id}-${doc.date}`}>
                      {screen ? (
                        /*
                          A real <Link>, not an <a href>. Under hash routing a
                          bare anchor navigated by changing the fragment, which
                          the shell picked up; against a path it is a full
                          document request that reloads the whole app and
                          throws away the query cache. Link keeps the href — so
                          the row is still middle-clickable and copyable — and
                          intercepts the plain click.
                        */
                        <Link to={pathForRoute(screen, [doc.id])} onClick={onClose} className={`${shell} transition-colors hover:border-brand`}>
                          {body}
                        </Link>
                      ) : (
                        <span className={shell}>{body}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {data.documentCount > data.documents.length ? (
              <p className="text-[11px] text-ink-faint">
                {t("reportDrill.showing", { shown: String(data.documents.length), total: String(data.documentCount) })}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </SidePanel>
  );
}

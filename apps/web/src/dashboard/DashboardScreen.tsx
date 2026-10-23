import { BranchGatedAction } from "../branch-restriction";
import { useBranchGate } from "../shell/useBranchGate";
import { DashboardRequest, Money as ExactMoney, mayActWith, mayReadWith } from "@mezan/domain";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Button, Card, Chip, Money, StatCard, useFormat } from "@mezan/ui";
import { useApi } from "../data/ApiContext";
import { useNavigation } from "../navigation";
import type { ScreenKey } from "../router/screens";
import type { ScreenIntentInput } from "../navigation";
import { useDashboardGate, useDashboardSummary, useEntitlements, useUserPreferences, type DashboardRange } from "../data/hooks";
import { sessionHolds } from "../data/session";
import { DeskTiles, useDeskTiles } from "./DeskTiles";
import { displayName } from "../display-name";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { storedMemoLabel } from "../domain-labels";
import { BalanceBeam, beamTiltDegrees } from "./BalanceBeam";
import { KpiTile, type BeamDirection, type DeltaTone } from "./KpiStrip";
import { AttentionQueue, type AttentionItem } from "./AttentionQueue";
import { AgingMatrix, type AgingMatrixRow } from "./AgingMatrix";
import { ExpenseDonut } from "./ExpenseDonut";
import { TopItems, type TopItemRow } from "./TopItems";
import { riseStyle, useReducedMotion } from "./motion";
import {
  COCKPIT_PERMISSION,
  DashboardSection,
  cockpitLeads,
  dashboardAudienceOf,
  resolveDashboardWidgets,
  type DashboardPanelKind,
} from "./widget-registry";
import { CockpitSection } from "./cockpit/CockpitSection";
import { useBookVersionWatch } from "./cockpit/cockpit-hooks";
import {
  expenseSlices,
  periodTotals,
  previousReportWindow,
  reportWindow,
  useAttentionData,
  useCustomerAging,
  useIncomeStatement,
  useSupplierAging,
  useTopProducts,
  type DashboardRangeValue,
} from "./dashboard-hooks";
import { entityName } from "../lib/entity-names";
import { useContractingExceptionSummary } from "../data/contracting-controls-hooks";
import { monthEndIsoOf, monthStartIsoOf } from "../lib/dates";
import { BackupProtectionNotice } from "../settings/BackupProtectionNotice";

type QuickAction = { labelKey: AppTranslationKey; screen: ScreenKey; permission: string; intent?: ScreenIntentInput; primary?: boolean };

/** Quick-action launchers: each navigates to its screen and opens that screen's create flow. */
const quickActions: QuickAction[] = [
  { labelKey: "dashboard.action.salesInvoice", screen: "sales-invoices", permission: "sales.invoice.create", intent: "create", primary: true },
  { labelKey: "dashboard.action.voucher", screen: "treasury-vouchers", permission: "treasury.cash_voucher.create", intent: "create" },
  { labelKey: "dashboard.action.goodsReceipt", screen: "goods-receipts", permission: "purchases.receipt.create", intent: "create" },
  { labelKey: "dashboard.action.purchaseInvoice", screen: "purchase-invoices", permission: "purchases.invoice.create", intent: "create" },
  { labelKey: "dashboard.action.purchaseOrder", screen: "purchase-orders", permission: "purchases.order.create", intent: "create" },
  { labelKey: "dashboard.action.quote", screen: "quotes", permission: "sales.quote.create", intent: "create" },
  { labelKey: "dashboard.action.newItem", screen: "items", permission: "inventory.item.create", intent: "create" },
];

const RANGE_OPTIONS = [
  { value: "month", labelKey: "dashboard.range.month" },
  { value: "year", labelKey: "dashboard.range.year" },
  { value: "all", labelKey: "dashboard.range.all" },
] as const satisfies readonly { value: DashboardRangeValue; labelKey: AppTranslationKey }[];

function rangeToDates(range: DashboardRangeValue, now: Date): DashboardRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (range === "month") {
    return { fromDate: monthStartIsoOf(y, m), toDate: monthEndIsoOf(y, m) };
  }
  if (range === "year") return { fromDate: `${y}-01-01`, toDate: `${y}-12-31` };
  return {};
}

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function num(value: string | undefined): number {
  return value ? Number(value) : 0;
}

interface PanelProps {
  readonly title: string;
  readonly hint: string;
  readonly step: number;
  readonly reduced: boolean;
  readonly children: ReactNode;
}

function Panel({ title, hint, step, reduced, children }: PanelProps) {
  return (
    /*
     * `min-w-0` is load-bearing, not tidiness. A grid item defaults to
     * `min-width: auto`, which means "at least as wide as my content" — so a
     * panel holding a 517px table refused to shrink below 517px inside a 390px
     * phone, and the `overflow-x-auto` wrapper INSIDE it never got the chance
     * to scroll: the panel simply pushed the page sideways instead. Every
     * screen with a wide child in a grid or flex row needs this.
     */
    <Card className="flex min-w-0 flex-col p-[18px_20px]" style={riseStyle(step, reduced)}>
      <h3 className="font-display text-md font-bold text-ink">{title}</h3>
      <div className="mb-[14px] mt-[2px] text-2xs text-ink-faint">{hint}</div>
      {children}
    </Card>
  );
}

/**
 * لوحة التحكم (Dashboard — Home). Every figure is REAL: the KPI strip and the
 * balance-beam hero come from `GET /dashboard/summary` (computed server-side
 * from posted GL journal entries), and every panel beside them reads the same
 * live report endpoints the report screens use — period-over-period from
 * `/financial-reports/income-statement`, tax due from `/financial-reports/vat-return`,
 * the aging matrix from `/reports/aging/{customers,suppliers}`, below-reorder
 * from `/reports/inventory/stock-levels`, top items from `/reports/sales/top-products`
 * and the collection queue from `/sales-invoices`. Zero is rendered as zero.
 */
export function DashboardScreen() {
  const { t, direction, locale } = useAppTranslation();
  const format = useFormat();
  const { session } = useApi();
  const { navigate } = useNavigation();
  const reduced = useReducedMotion();
  const [range, setRange] = useState<DashboardRangeValue>("month");

  const today = useMemo(() => new Date(), []);
  const dates = useMemo(() => rangeToDates(range, today), [range, today]);
  const window = useMemo(() => reportWindow(range, today), [range, today]);
  const priorWindow = useMemo(() => previousReportWindow(range, today), [range, today]);

  const mayAsk = useDashboardGate();
  const seesSummary = mayAsk(DashboardRequest.Summary);
  const query = useDashboardSummary(dates);
  const summary = query.data;
  // Mounted here, not inside the cockpit section: the cockpit renders only for
  // a user who holds its permission and has its widgets on, and every classic
  // panel below was frozen until a manual reload for everyone else.
  const liveWatch = useBookVersionWatch(true, null);
  const currentIncome = useIncomeStatement(window);
  const priorIncome = useIncomeStatement(priorWindow);
  const customerAging = useCustomerAging();
  const supplierAging = useSupplierAging();
  const topProducts = useTopProducts(window);
  const attention = useAttentionData(window);
  /**
   * استثناءات المقاولات — the one contracting tile (design §06). Gated on the
   * certificate-view right so a tenant that does not run contracting never sees
   * a row about it.
   */
  const branchGate = useBranchGate();
  const mayViewContracting = branchGate.allows(BranchGatedAction.ContractingExceptions) && mayAsk(DashboardRequest.ContractingExceptions);
  const contractingExceptions = useContractingExceptionSummary(mayViewContracting);
  const desk = useDeskTiles();

  const greetingName = session ? firstNameOf(displayName(session, locale)) : "";
  const gl = summary?.gl;
  const counts = summary?.counts;
  const revenue = num(gl?.revenue);
  const expenses = num(gl?.expenses);
  const netProfit = num(gl?.netProfit);
  const rtl = direction === "rtl";
  const prior = periodTotals(priorIncome.data);
  const hasPrior = priorWindow !== null && priorIncome.isSuccess;

  const tilt = beamTiltDegrees(revenue, expenses, netProfit);
  const verdictKey: AppTranslationKey =
    tilt > 0 ? "dashboard.hero.verdict.profit" : tilt < 0 ? "dashboard.hero.verdict.loss" : "dashboard.hero.verdict.level";
  const beamAriaKey: AppTranslationKey =
    tilt > 0 ? "dashboard.hero.aria.profit" : tilt < 0 ? "dashboard.hero.aria.loss" : "dashboard.hero.aria.level";

  function delta(current: number, previous: number, riseIsGood: boolean): {
    direction: BeamDirection;
    tone: DeltaTone;
    node: ReactNode;
  } {
    if (!hasPrior) return { direction: "level", tone: "neutral", node: t("dashboard.delta.none") };
    if (previous === 0 && current === 0) return { direction: "level", tone: "neutral", node: t("dashboard.delta.flat") };
    const rising = current > previous;
    const dir: BeamDirection = current === previous ? "level" : rising ? "up" : "down";
    const tone: DeltaTone = dir === "level" ? "neutral" : rising === riseIsGood ? "good" : "bad";
    if (previous === 0) {
      return {
        direction: dir,
        tone,
        node: (
          <>
            {t("dashboard.delta.previous")} <span className="mz-num">{format.money(previous)}</span>
          </>
        ),
      };
    }
    const pct = ((current - previous) / Math.abs(previous)) * 100;
    return {
      direction: dir,
      tone,
      node: (
        <>
          <span className="mz-num">{format.number(pct)}%</span> {t("dashboard.delta.suffix")}
        </>
      ),
    };
  }

  const revenueDelta = delta(revenue, prior.revenue, true);
  const expensesDelta = delta(expenses, prior.expenses, false);
  const netDelta = delta(netProfit, prior.netProfit, true);

  const invoicesUnit = t("dashboard.attention.invoicesUnit");
  const invoiceItems: AttentionItem[] = [
    {
      key: "overdue",
      kind: "overdue",
      tone: attention.overdueCount > 0 ? "danger" : "clear",
      title: t("dashboard.attention.overdue"),
      detail:
        attention.overdueCount > 0 ? (
          <>
            <span className="mz-num">{format.number(attention.overdueCount)}</span> {invoicesUnit} ·{" "}
            <span className="mz-num">{format.money(attention.overdueAmount)}</span>
          </>
        ) : (
          t("dashboard.attention.overdue.clear")
        ),
      actionLabel: t("dashboard.attention.overdue.action"),
      onAction: () => navigate("sales-invoices"),
      primary: attention.overdueCount > 0,
    },
    {
      key: "dueSoon",
      kind: "dueSoon",
      tone: attention.dueSoonCount > 0 ? "warning" : "clear",
      title: t("dashboard.attention.dueSoon"),
      detail:
        attention.dueSoonCount > 0 ? (
          <>
            <span className="mz-num">{format.number(attention.dueSoonCount)}</span> {invoicesUnit} ·{" "}
            <span className="mz-num">{format.money(attention.dueSoonAmount)}</span>
          </>
        ) : (
          t("dashboard.attention.dueSoon.clear")
        ),
      actionLabel: t("dashboard.attention.dueSoon.action"),
      onAction: () => navigate("sales-invoices"),
    },
  ];
  const stockItem: AttentionItem = {
    key: "stock",
    kind: "stock",
    tone: attention.lowStockCount > 0 ? "info" : "clear",
    title: t("dashboard.attention.stock"),
    detail:
      attention.lowStockCount > 0 ? (
        <>
          <span className="mz-num">{format.number(attention.lowStockCount)}</span> {t("dashboard.attention.itemsUnit")}
          {attention.lowStockFirstName ? ` · ${attention.lowStockFirstName}` : ""}
        </>
      ) : (
        t("dashboard.attention.stock.clear")
      ),
    actionLabel: t("dashboard.attention.stock.action"),
    onAction: () => navigate("report-inventory-stock-levels"),
  };
  const payablesItem: AttentionItem = {
    key: "payables",
    kind: "payables",
    tone: ExactMoney.fromMajor(attention.agedPayables).scaled > 0n ? "warning" : "clear",
    title: t("dashboard.attention.payables"),
    detail:
      ExactMoney.fromMajor(attention.agedPayables).scaled > 0n ? (
        <span className="mz-num">{format.money(attention.agedPayables)}</span>
      ) : (
        t("dashboard.attention.payables.clear")
      ),
    actionLabel: t("dashboard.attention.payables.action"),
    onAction: () => navigate("report-aging-suppliers"),
  };
  const attentionItems: AttentionItem[] = [
    ...(mayAsk(DashboardRequest.SalesInvoices) ? invoiceItems : []),
    ...(branchGate.allows(BranchGatedAction.VatReturn) && mayAsk(DashboardRequest.VatReturn)
      ? [
          {
            key: "tax",
            kind: "tax" as const,
            tone: attention.taxDue > 0 ? ("warning" as const) : ("clear" as const),
            title: t("dashboard.attention.tax"),
            detail:
              attention.taxDue > 0 ? <span className="mz-num">{format.money(attention.taxDue)}</span> : t("dashboard.attention.tax.clear"),
            actionLabel: t("dashboard.attention.tax.action"),
            onAction: () => navigate("financial-reports"),
          },
        ]
      : []),
    ...(mayAsk(DashboardRequest.StockLevels) ? [stockItem] : []),
    ...(mayViewContracting
      ? [
          {
            key: "contractingExceptions",
            kind: "contracting" as const,
            tone: (contractingExceptions.data?.total ?? 0) > 0 ? ("danger" as const) : ("clear" as const),
            title: t("dashboard.attention.contractingExceptions"),
            detail:
              (contractingExceptions.data?.total ?? 0) > 0 ? (
                <>
                  <span className="mz-num">{format.number(contractingExceptions.data?.total ?? 0)}</span>{" "}
                  {t("dashboard.attention.exceptionsUnit")}
                </>
              ) : (
                t("dashboard.attention.contractingExceptions.clear")
              ),
            actionLabel: t("dashboard.attention.contractingExceptions.action"),
            onAction: () => navigate("contracting-reports"),
          },
        ]
      : []),
    ...(mayAsk(DashboardRequest.SupplierAging) ? [payablesItem] : []),
  ];

  const agingRows: AgingMatrixRow[] = [];
  const customerTotals = customerAging.data?.grandTotals;
  if (customerTotals) {
    agingRows.push({
      key: "customers",
      label: t("dashboard.aging.customers"),
      buckets: [
        String(customerTotals.current ?? "0"),
        String(customerTotals.d31to60 ?? "0"),
        String(customerTotals.d61to90 ?? "0"),
        String(customerTotals.d91to120 ?? "0"),
        String(customerTotals.over120 ?? "0"),
      ],
    });
  }
  const supplierTotals = supplierAging.data?.grandTotals;
  if (supplierTotals) {
    agingRows.push({
      key: "suppliers",
      label: t("dashboard.aging.suppliers"),
      buckets: [
        String(supplierTotals.current ?? "0"),
        String(supplierTotals.d31to60 ?? "0"),
        String(supplierTotals.d61to90 ?? "0"),
        String(supplierTotals.d91to120 ?? "0"),
        String(supplierTotals.over120 ?? "0"),
      ],
    });
  }

  const topItemRows: TopItemRow[] = (topProducts.data?.rows ?? []).map((row) => ({
    key: row.itemId,
    rank: row.rank,
    name: entityName({ nameAr: row.itemNameAr, nameEn: row.itemNameEn }, locale),
    qty: row.qty,
    revenue: row.revenue,
    sharePercent: row.contributionPercent,
  }));

  const systemData = [
    { key: "accounts", label: t("dashboard.systemData.accounts"), value: counts?.accounts ?? 0 },
    { key: "customers", label: t("dashboard.systemData.customers"), value: counts?.customers ?? 0 },
    { key: "suppliers", label: t("dashboard.systemData.suppliers"), value: counts?.suppliers ?? 0 },
    { key: "items", label: t("dashboard.systemData.items"), value: counts?.items ?? 0 },
    { key: "journalEntries", label: t("dashboard.systemData.journalEntries"), value: counts?.journalEntries ?? 0 },
    { key: "users", label: t("dashboard.systemData.users"), value: counts?.users ?? 0 },
  ];

  const preferences = useUserPreferences().data;
  const plan = useEntitlements().data;
  const holds = (permission: string) => sessionHolds(session, permission);
  const canRead = (permission: string) => mayReadWith(permission, holds, plan);
  const audience = dashboardAudienceOf(session?.permissions ?? []);
  const visibleWidgets = useMemo(
    () => resolveDashboardWidgets(preferences?.dashboard, canRead, DashboardSection.Panels, audience),
    // `canRead` closes over the session and the plan, so their identities are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences?.dashboard, session, plan, audience],
  );
  const cockpitWidgets = useMemo(
    () => (canRead(COCKPIT_PERMISSION) ? resolveDashboardWidgets(preferences?.dashboard, canRead, DashboardSection.Cockpit, audience) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences?.dashboard, session, plan, audience],
  );
  const cockpitFirst = useMemo(
    () => cockpitWidgets.length > 0 && cockpitLeads(preferences?.dashboard, canRead, audience),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences?.dashboard, session, plan, audience, cockpitWidgets.length],
  );
  const cockpit = cockpitWidgets.length > 0 ? <CockpitSection widgets={cockpitWidgets} rtl={rtl} live={!liveWatch.isError} /> : null;
  const offeredActions = quickActions.filter((action) => mayActWith(action.permission, holds, plan));
  const ranged = seesSummary || mayAsk(DashboardRequest.IncomeStatement) || mayAsk(DashboardRequest.TopProducts);
  const nothingToShow = !seesSummary && attentionItems.length === 0 && visibleWidgets.length === 0 && cockpit === null && !desk.askable;

  const panelFor: Readonly<Record<DashboardPanelKind, ReactNode>> = {
    aging: (
      <Panel title={t("dashboard.aging")} hint={t("dashboard.aging.sub")} step={5} reduced={reduced}>
          <AgingMatrix
            partyHeader={t("dashboard.aging.party")}
            bucketLabels={[
              t("dashboard.aging.bucket.current"),
              t("dashboard.aging.bucket.b31"),
              t("dashboard.aging.bucket.b61"),
              t("dashboard.aging.bucket.b91"),
              t("dashboard.aging.bucket.over"),
            ]}
            rows={agingRows}
            emptyLabel={t("dashboard.aging.empty")}
          />
        </Panel>
    ),
    expenses: (
      <Panel title={t("dashboard.expenses")} hint={t("dashboard.expenses.sub")} step={6} reduced={reduced}>
          <ExpenseDonut
            slices={expenseSlices(currentIncome.data, locale)}
            centreCaption={t("dashboard.expenses.centre")}
            emptyLabel={t("dashboard.expenses.empty")}
          />
        </Panel>
    ),
    topItems: (
      <Panel title={t("dashboard.topItems")} hint={t("dashboard.topItems.sub")} step={7} reduced={reduced}>
          <TopItems rows={topItemRows} qtyUnitLabel={t("dashboard.topItems.unit")} emptyLabel={t("dashboard.topItems.empty")} />
        </Panel>
    ),
    activity: (
      <Panel title={t("dashboard.activity")} hint={t("dashboard.activity.sub")} step={8} reduced={reduced}>
          {summary && summary.recentActivity.length > 0 ? (
            <ul className="flex flex-col gap-[10px]">
              {summary.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-[10px]">
                  <span aria-hidden className="mt-[6px] h-[6px] w-[6px] flex-none rounded-full bg-brand" />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">{storedMemoLabel(entry.memo, locale) || entry.entryNo || entry.id}</div>
                    <div className="mt-[1px] text-2xs text-ink-faint">
                      <span className="mz-num">{entry.date}</span>
                      {entry.entryNo ? <span className="mz-lat"> · {entry.entryNo}</span> : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">{t("dashboard.activity.empty")}</p>
          )}
        </Panel>
    ),
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]" style={riseStyle(0, reduced)}>
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("dashboard.greeting", { name: greetingName })}</h1>
          {seesSummary ? <p className="mt-[4px] max-w-[62ch] text-sm text-ink-muted">{t("dashboard.subtitle")}</p> : null}
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {offeredActions.map((action) => (
            <Button
              key={action.labelKey}
              size="sm"
              variant={action.primary ? "primary" : "default"}
              onClick={() => navigate(action.screen, action.intent)}
            >
              {t(action.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      <BackupProtectionNotice />

      {cockpitFirst ? cockpit : null}

      {nothingToShow ? (
        <Card className="p-[18px_20px]">
          <p className="text-sm text-ink-muted">{t("dashboard.nothingToShow")}</p>
        </Card>
      ) : null}

      <DeskTiles tiles={desk.tiles} />

      {ranged ? (
        <div className="flex flex-wrap gap-[6px]" role="radiogroup" aria-label={t("dashboard.range.legend")} style={riseStyle(1, reduced)}>
          {RANGE_OPTIONS.map((opt) => (
            <Chip key={opt.value} type="button" active={range === opt.value} onClick={() => setRange(opt.value)}>
              {t(opt.labelKey)}
            </Chip>
          ))}
        </div>
      ) : null}

      {query.isError ? (
        <Card className="p-[18px_20px]">
          <p className="text-sm font-semibold text-danger-ink">{t("dashboard.error")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("dashboard.retry")}
          </Button>
        </Card>
      ) : null}

      {seesSummary ? (
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4" style={riseStyle(2, reduced)}>
          <KpiTile
            label={t("dashboard.kpi.revenue")}
            value={revenue}
            direction={revenueDelta.direction}
            deltaTone={revenueDelta.tone}
            delta={revenueDelta.node}
            rtl={rtl}
          />
          <KpiTile
            label={t("dashboard.kpi.expenses")}
            value={expenses}
            direction={expensesDelta.direction}
            deltaTone={expensesDelta.tone}
            delta={expensesDelta.node}
            rtl={rtl}
          />
          <KpiTile
            label={t("dashboard.kpi.netProfit")}
            value={netProfit}
            valueTone={netProfit < 0 ? "bad" : "good"}
            direction={netDelta.direction}
            deltaTone={netDelta.tone}
            delta={netDelta.node}
            rtl={rtl}
          />
          <KpiTile
            label={t("dashboard.kpi.cash")}
            value={num(gl?.cash)}
            direction="level"
            deltaTone="neutral"
            delta={t("dashboard.kpi.cash.sub")}
            rtl={rtl}
          />
        </div>
      ) : null}

      <div className={seesSummary && attentionItems.length > 0 ? "grid grid-cols-1 gap-[16px] xl:grid-cols-[1.5fr_1fr]" : "grid grid-cols-1 gap-[16px]"}>
        {seesSummary ? (
          <Card className="p-[20px_22px]" style={riseStyle(3, reduced)}>
            <h2 className="mt-[4px] font-display text-lg font-bold text-ink">{t("dashboard.hero.title")}</h2>

            <BalanceBeam
              revenue={revenue}
              expenses={expenses}
              net={netProfit}
              revenueAtEnd={rtl}
              label={t(beamAriaKey, { net: format.money(netProfit) })}
            />

            <div className="mt-[6px] flex flex-wrap items-end justify-between gap-[14px]">
              <div className="min-w-[104px]">
                <div className="flex items-center gap-[6px] text-2xs text-ink-muted">
                  <span aria-hidden className="h-[8px] w-[8px] rounded-sm bg-chart-1" />
                  {t("dashboard.kpi.revenue")}
                </div>
                <div className="mz-num mt-[2px] text-md font-semibold" style={{ color: "var(--chart-1)" }}>
                  {format.money(revenue)}
                </div>
              </div>

              <div className="flex-1 text-center">
                <div
                  className={`font-display text-2xl font-bold tracking-tight ${netProfit < 0 ? "text-danger-ink" : "text-success-ink"}`}
                >
                  <Money value={netProfit} />
                </div>
                <div className="mt-[2px] text-2xs text-ink-muted">{t(verdictKey)}</div>
              </div>

              <div className="min-w-[104px] text-end">
                <div className="flex items-center justify-end gap-[6px] text-2xs text-ink-muted">
                  <span aria-hidden className="h-[8px] w-[8px] rounded-sm bg-chart-2" />
                  {t("dashboard.kpi.expenses")}
                </div>
                <div className="mz-num mt-[2px] text-md font-semibold" style={{ color: "var(--chart-2)" }}>
                  {format.money(expenses)}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {attentionItems.length > 0 ? (
          <Card className="p-[18px_20px]" style={riseStyle(4, reduced)}>
            <h3 className="font-display text-md font-bold text-ink">{t("dashboard.attention")}</h3>
            <div className="mb-[4px] mt-[2px] text-2xs text-ink-faint">{t("dashboard.attention.sub")}</div>
            <AttentionQueue items={attentionItems} />
          </Card>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-[16px] xl:grid-cols-2">
        {/*
          Rendered from the user's OWN layout, not a hard-coded order: a
          warehouse keeper and an accountant want different things at the top
          (§8.5). `resolveDashboardWidgets` also drops any widget the caller may
          not read, so a layout saved before a permission was revoked degrades
          quietly rather than rendering a card they are not allowed to see
          (§8.7).
        */}
        {visibleWidgets.map((widget) => (
          <Fragment key={widget.id}>{panelFor[widget.kind as DashboardPanelKind]}</Fragment>
        ))}
      </div>

      {cockpitFirst ? null : cockpit}

      {seesSummary ? (
        <>
          <div style={riseStyle(9, reduced)}>
            <div className="mb-[8px] mz-eyebrow">{t("dashboard.companyWide")}</div>
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-3">
              <StatCard label={t("dashboard.kpi.receivables")} value={<Money value={num(gl?.receivables)} />} />
              <StatCard label={t("dashboard.kpi.payables")} value={<Money value={num(gl?.payables)} />} />
              <StatCard label={t("dashboard.kpi.inventoryValue")} value={<Money value={num(gl?.inventoryValue)} />} />
            </div>
          </div>

          <Card className="p-[18px_20px]" style={riseStyle(10, reduced)}>
            <h3 className="font-display text-md font-bold text-ink">{t("dashboard.systemData")}</h3>
            <div className="mt-[2px] text-2xs text-ink-faint">{t("dashboard.systemData.sub")}</div>
            <dl className="mt-[14px] grid grid-cols-2 gap-[10px] sm:grid-cols-3 lg:grid-cols-6">
              {systemData.map((row) => (
                <div key={row.key} className="rounded-md border border-border p-[10px_12px]">
                  <dt className="text-2xs text-ink-faint">{row.label}</dt>
                  <dd className="mz-num mt-[2px] text-lg font-bold text-ink">{format.number(row.value)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <p className="text-2xs text-ink-faint">{t("dashboard.footnote")}</p>
        </>
      ) : null}
    </div>
  );
}

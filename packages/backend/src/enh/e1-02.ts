import { createCashForecastRoutes, type CashForecastRoutesDeps } from "@mezan/api";
import {
  branchGrantCoversEvent,
  COMPANY_LEVEL_EVENT_PERMISSION,
  EVENT_BRANCH_IDS_KEY,
  resolvePermissions,
  type CashForecastAlertRecord,
  type EventCode,
  type CommitmentSource,
  type Money,
  type Notification,
  type Role,
} from "@mezan/domain";
import {
  createSqliteCashForecastStore,
  createSqliteChequeRepository,
  createSqliteHistoricalPurchaseArchiveStore,
  createSqliteHistoricalSalesArchiveStore,
  createSqliteNotificationStore,
  createSqlitePurchaseInvoiceStore,
  createStandaloneSqliteInstallmentPlanStore,
  createStandaloneSqlitePurchaseReturnStore,
  createStandaloneSqliteSalesReturnStore,
  createCashForecastStore,
  createNotificationStore,
  createChequeRepository,
  createHistoricalPurchaseArchiveStore,
  createHistoricalSalesArchiveStore,
  createInstallmentPlanStore,
  createPurchaseInvoiceStore,
  createPurchaseReturnStore,
  createSalesReturnStore,
  type SqlDb,
} from "@mezan/persistence";
import { randomUUID } from "node:crypto";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

export const CASH_FORECAST_PERMISSION = "treasury.cash_forecast.view";
export const CASH_FORECAST_ALERT_EVENT = "CASH_FORECAST_LOW" satisfies EventCode;
const CASH_FORECAST_LINK = "/treasury/cash-forecast";

const commitmentRegistry = new WeakMap<SqlDb, CommitmentSource[]>();

export function registerCashCommitmentSource(db: SqlDb, source: CommitmentSource): void {
  const sources = commitmentRegistry.get(db) ?? [];
  const at = sources.findIndex((s) => s.id === source.id);
  if (at >= 0) sources.splice(at, 1, source);
  else sources.push(source);
  commitmentRegistry.set(db, sources);
}

function majorLabel(money: Money): string {
  const negative = money.scaled < 0n;
  const abs = negative ? -money.scaled : money.scaled;
  const cents = (abs + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function reportsDeps(ctx: BackendModuleContext): CashForecastRoutesDeps["reports"] {
  const { stores } = ctx;
  const salesArchives = ctx.store((s) => createSqliteHistoricalSalesArchiveStore(s), (d) => createHistoricalSalesArchiveStore(d));
  const purchaseArchives = ctx.store((s) => createSqliteHistoricalPurchaseArchiveStore(s), (d) => createHistoricalPurchaseArchiveStore(d));
  return {
    salesInvoices: stores.salesInvoices,
    allocatable: stores.vouchers.invoices,
    salesReturnDocs: ctx.store((s) => createStandaloneSqliteSalesReturnStore(s), (d) => createSalesReturnStore(d)),
    purchaseReturnDocs: ctx.store((s) => createStandaloneSqlitePurchaseReturnStore(s), (d) => createPurchaseReturnStore(d)),
    cheques: ctx.store((s) => createSqliteChequeRepository(s), (d) => createChequeRepository(d)),
    voucherDocuments: stores.vouchers.documents,
    allocations: stores.vouchers.allocations,
    purchaseInvoices: ctx.store((s) => createSqlitePurchaseInvoiceStore(s), (d) => createPurchaseInvoiceStore(d)),
    historicalArchives: { sales: () => salesArchives.list(), purchases: () => purchaseArchives.list() },
    customers: stores.customers,
    suppliers: stores.suppliers,
    items: stores.items,
    warehouses: stores.warehouses,
    stockLedger: stores.stockLedger.ledger,
    costLayers: stores.stockLedger.layers,
    wacSnapshots: stores.stockLedger.snapshots,
    installmentPlans: ctx.store((s) => createStandaloneSqliteInstallmentPlanStore(s), (d) => createInstallmentPlanStore(d)),
    ledger: stores.ledger,
    accounts: stores.accounts,
  };
}

async function recipients(ctx: BackendModuleContext): Promise<string[]> {
  const roles = new Map<string, Role | null>();
  const out: string[] = [];
  for (const user of await ctx.uow.users.list()) {
    if (user.status !== "active") continue;
    let held: ReadonlySet<string> | null = null;
    if (!user.isCompanyAdmin) {
      if (!user.roleId) continue;
      if (!roles.has(user.roleId)) roles.set(user.roleId, await ctx.uow.roles.findById(user.roleId));
      const role = roles.get(user.roleId);
      if (!role) continue;
      held = resolvePermissions(role.permissions);
      if (!held.has(CASH_FORECAST_PERMISSION)) continue;
    }
    // The forecast is the whole company's cash, so the alert is a company-level event.
    const holdsCompanyLevel = held === null || held.has(COMPANY_LEVEL_EVENT_PERMISSION);
    if (branchGrantCoversEvent(user.branchScope, holdsCompanyLevel, [])) out.push(user.id);
  }
  return out;
}

export const area: BackendArea = {
  mount(ctx) {
    const store = ctx.store((s) => createSqliteCashForecastStore(s), (d) => createCashForecastStore(d));
    const notifications = ctx.store((s) => createSqliteNotificationStore(s), (d) => createNotificationStore(d));
    const notify = async (alert: CashForecastAlertRecord): Promise<number> => {
      const userIds = await recipients(ctx);
      const title = "تنبيه سيولة: الرصيد المتوقع أقل من الحد";
      const body =
        `يُتوقع أن ينخفض رصيد النقدية عن ${majorLabel(alert.threshold)} ج.م يوم ${alert.crossingDate}، ` +
        `وأدنى رصيد متوقع ${majorLabel(alert.lowestBalance)} ج.م يوم ${alert.lowestDate}.`;
      // Published as well as delivered: the direct write guarantees the people
      // who hold the permission are told, and the event is what a tenant's own
      // notification rule can subscribe to. A subscriber that throws is
      // reported by the bus and never fails the forecast request.
      ctx.eventBus.publish(
        CASH_FORECAST_ALERT_EVENT,
        {
          [EVENT_BRANCH_IDS_KEY]: [],
          alertId: alert.id,
          crossingDate: alert.crossingDate,
          threshold: majorLabel(alert.threshold),
          lowestDate: alert.lowestDate,
          lowestBalance: majorLabel(alert.lowestBalance),
          detectedAt: alert.detectedAt,
          title,
          body,
          link: CASH_FORECAST_LINK,
        },
        alert.detectedAt,
      );
      for (const userId of userIds) {
        const notification: Notification = {
          id: randomUUID(),
          ruleId: null,
          recipientUserId: userId,
          eventCode: CASH_FORECAST_ALERT_EVENT,
          title,
          body,
          priority: "high",
          channels: ["in_app"],
          channelStatus: { in_app: "delivered" },
          status: "unread",
          payload: {
            alertId: alert.id,
            crossingDate: alert.crossingDate,
            threshold: alert.threshold.toString(),
            lowestDate: alert.lowestDate,
            lowestBalance: alert.lowestBalance.toString(),
            link: CASH_FORECAST_LINK,
          },
          createdAt: alert.detectedAt,
          readAt: null,
        };
        await notifications.save(notification);
      }
      return userIds.length;
    };
    ctx.app.route(
      "/cash-forecast",
      createCashForecastRoutes(
        {
          reports: reportsDeps(ctx),
          treasuryAccounts: ctx.stores.treasuryAccounts,
          cashAndBankAccountIds: ctx.cashAndBankAccountIds,
          accounts: ctx.stores.accounts,
          store,
          commitmentSources: () => commitmentRegistry.get(ctx.db) ?? [],
          notify,
          audit: ctx.audit,
        },
        ctx.resolveAuthContext,
      ),
    );
    ctx.addCloser(store);
  },
};

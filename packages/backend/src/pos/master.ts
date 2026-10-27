import {
  createPosPaymentMethodsRoutes,
  createPosSettingsRoutes,
  createPosTerminalsRoutes,
  createShiftTemplatesRoutes,
  type ConfigTransactor,
} from "@mezan/api";
import {
  AuditChangeAction,
  POS_WALK_IN_CUSTOMER_CODE,
  POS_WALK_IN_CUSTOMER_ID,
  createCustomer,
  recordSensitiveEvent,
  type BranchEtaDevice,
} from "@mezan/domain";
import { createSqlitePosStore, createPosStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

async function ensureWalkInCustomer(ctx: BackendModuleContext): Promise<string> {
  const customers = ctx.stores.customers;
  if (await customers.findById(POS_WALK_IN_CUSTOMER_ID)) return POS_WALK_IN_CUSTOMER_ID;
  const clash = await customers.findByCode(POS_WALK_IN_CUSTOMER_CODE);
  const walkIn = createCustomer({
    id: POS_WALK_IN_CUSTOMER_ID,
    code: clash ? `${POS_WALK_IN_CUSTOMER_CODE}-POS` : POS_WALK_IN_CUSTOMER_CODE,
    nameAr: "زبون عابر",
    nameEn: "Walk-in customer",
    paymentTermsDays: 0,
    notes: "عميل نقاط البيع الافتراضي — تُصدر له فواتير البيع التي لا تحمل اسم مشترٍ.",
  });
  // Every counter sale that names no buyer hangs off this party, so it carries
  // real receivables — and it was the one customer the product created with no
  // record of when or why it appeared in the register.
  await ctx.db.transaction(async () => {
    await customers.save(walkIn);
    await recordSensitiveEvent(ctx.audit, {
      module: "pos",
      entityType: "CUSTOMER",
      entityId: walkIn.id,
      action: AuditChangeAction.Create,
      actor: "system",
      severity: "INFO",
      details: { customerId: walkIn.id, code: walkIn.code, nameAr: walkIn.nameAr, reason: "POS_WALK_IN" },
    });
  });
  return POS_WALK_IN_CUSTOMER_ID;
}

/** POS master data: terminals, payment methods, POS settings, and the platform's shift templates. */
export const area: BackendArea = {
  mount(ctx) {
    const store = ctx.store((s) => createSqlitePosStore(s), (d) => createPosStore(d));
    ctx.addCloser(store);
    const { branches, warehouses, treasuryAccounts, eta } = ctx.stores;
    // The boundary a config write shares with its audit row (D298).
    const transactor: ConfigTransactor = { run: (fn) => ctx.db.transaction(fn) };

    ctx.app.route(
      "/pos/terminals",
      createPosTerminalsRoutes(
        {
          terminals: store.terminals,
          paymentMethods: store.paymentMethods,
          branches,
          warehouses,
          treasuryAccounts,
          branchEtaDevices: async () =>
            new Map<string, BranchEtaDevice>((await eta.branchCodes.list()).map((b) => [b.branchId, b])),
          audit: ctx.audit,
          transactor,
        },
        ctx.resolveAuthContext,
      ),
    );
    ctx.app.route(
      "/pos/payment-methods",
      createPosPaymentMethodsRoutes(
        { paymentMethods: store.paymentMethods, terminals: store.terminals, treasuryAccounts },
        ctx.resolveAuthContext,
      ),
    );
    ctx.app.route(
      "/pos/settings",
      createPosSettingsRoutes(
        { settings: store.settings, ensureWalkInCustomer: () => ensureWalkInCustomer(ctx), audit: ctx.audit, transactor },
        ctx.resolveAuthContext,
      ),
    );
    ctx.app.route(
      "/shift-templates",
      createShiftTemplatesRoutes({ shiftTemplates: store.shiftTemplates, branches }, ctx.resolveAuthContext),
    );
  },
};

import {
  createPosPaymentMethodsRoutes,
  createPosSettingsRoutes,
  createPosTerminalsRoutes,
  createShiftTemplatesRoutes,
} from "@mezan/api";
import {
  POS_WALK_IN_CUSTOMER_CODE,
  POS_WALK_IN_CUSTOMER_ID,
  createCustomer,
  type BranchEtaDevice,
} from "@mezan/domain";
import { createSqlitePosStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

async function ensureWalkInCustomer(ctx: BackendModuleContext): Promise<string> {
  const customers = ctx.stores.customers;
  if (await customers.findById(POS_WALK_IN_CUSTOMER_ID)) return POS_WALK_IN_CUSTOMER_ID;
  const clash = await customers.findByCode(POS_WALK_IN_CUSTOMER_CODE);
  await customers.save(
    createCustomer({
      id: POS_WALK_IN_CUSTOMER_ID,
      code: clash ? `${POS_WALK_IN_CUSTOMER_CODE}-POS` : POS_WALK_IN_CUSTOMER_CODE,
      nameAr: "زبون عابر",
      nameEn: "Walk-in customer",
      paymentTermsDays: 0,
      notes: "عميل نقاط البيع الافتراضي — تُصدر له فواتير البيع التي لا تحمل اسم مشترٍ.",
    }),
  );
  return POS_WALK_IN_CUSTOMER_ID;
}

/** POS master data: terminals, payment methods, POS settings, and the platform's shift templates. */
export const area: BackendArea = {
  mount(ctx) {
    const store = createSqlitePosStore(ctx.sqlite);
    ctx.addCloser(store);
    const { branches, warehouses, treasuryAccounts, eta } = ctx.stores;

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
        { settings: store.settings, ensureWalkInCustomer: () => ensureWalkInCustomer(ctx), audit: ctx.audit },
        ctx.resolveAuthContext,
      ),
    );
    ctx.app.route(
      "/shift-templates",
      createShiftTemplatesRoutes({ shiftTemplates: store.shiftTemplates, branches }, ctx.resolveAuthContext),
    );
  },
};

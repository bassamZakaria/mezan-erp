import { Hono, type Context } from "hono";
import {
  Money,
  can,
  discountLimitFor,
  percentBpFromString,
  percentBpToString,
  recordSensitiveEvent,
  updatePosSettings,
  type AuditSink,
  type PosDiscountLimit,
  type PosSettings,
  type PosSettingsRepository,
} from "@mezan/domain";
import { updatePosSettingsSchema, type PosDiscountLimitDTO, type PosSettingsDTO } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "../permission-gate.js";
import { posDomainError, readJson, validationError } from "./http.js";

export interface PosSettingsRoutesDeps {
  readonly settings: PosSettingsRepository;
  /** Creates the seeded «زبون عابر» when it is missing and returns its id. */
  readonly ensureWalkInCustomer: () => Promise<string>;
  readonly audit?: AuditSink;
}

function limitToWire(limit: PosDiscountLimit): PosDiscountLimitDTO {
  return { percent: percentBpToString(limit.percentBp), amount: limit.amount.toString() };
}

function limitFromWire(limit: PosDiscountLimitDTO): PosDiscountLimit {
  return { percentBp: percentBpFromString(limit.percent) ?? -1, amount: Money.fromMajor(limit.amount) };
}

function toWire(settings: PosSettings): PosSettingsDTO {
  return {
    ...settings,
    cashierDiscountLimit: limitToWire(settings.cashierDiscountLimit),
    managerDiscountLimit: limitToWire(settings.managerDiscountLimit),
    mealSections: [...settings.mealSections],
  };
}

/** إعدادات نقطة البيع — `/pos/settings`. */
export function createPosSettingsRoutes(deps: PosSettingsRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function current(): Promise<PosSettings> {
    const settings = await deps.settings.get();
    const walkInCustomerId = await deps.ensureWalkInCustomer();
    return settings.walkInCustomerId === walkInCustomerId ? settings : { ...settings, walkInCustomerId };
  }

  async function record(c: Context, before: PosSettings, after: PosSettings) {
    if (!deps.audit) return;
    const limitsMoved =
      before.cashierDiscountLimit.percentBp !== after.cashierDiscountLimit.percentBp ||
      before.cashierDiscountLimit.amount.scaled !== after.cashierDiscountLimit.amount.scaled ||
      before.managerDiscountLimit.percentBp !== after.managerDiscountLimit.percentBp ||
      before.managerDiscountLimit.amount.scaled !== after.managerDiscountLimit.amount.scaled;
    await recordSensitiveEvent(deps.audit, {
      module: "pos",
      entityType: "POS_SETTINGS",
      entityId: "pos-settings",
      action: "UPDATE",
      actor: getAuthContext(c)?.userId ?? "system",
      severity: limitsMoved || before.allowArCollection !== after.allowArCollection ? "WARNING" : "INFO",
      details: {
        cashierDiscountLimit: limitToWire(after.cashierDiscountLimit),
        managerDiscountLimit: limitToWire(after.managerDiscountLimit),
        previousCashierDiscountLimit: limitToWire(before.cashierDiscountLimit),
        previousManagerDiscountLimit: limitToWire(before.managerDiscountLimit),
        allowArCollection: after.allowArCollection,
        pricesIncludeTax: after.pricesIncludeTax,
      },
    });
  }

  app.get("/", gate("pos.terminal.view"), async (c) => c.json(toWire(await current())));

  /**
   * The ceiling the CALLER may grant at the till without an approval: the
   * manager's when the session holds `pos.discount.approve`, else the
   * cashier's. Resolved here so the till never supplies its own limit.
   */
  app.get("/discount-limit", gate("pos.terminal.view"), async (c) => {
    const auth = getAuthContext(c);
    const limit = discountLimitFor(await deps.settings.get(), auth ? can(auth, "pos.discount.approve") : false);
    return c.json({ ...limitToWire(limit), tier: limit.tier });
  });

  app.put("/", gate("pos.settings.edit"), async (c) => {
    const parsed = updatePosSettingsSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    const before = await current();
    try {
      const { cashierDiscountLimit, managerDiscountLimit, ...rest } = parsed.data;
      const next = updatePosSettings(before, {
        ...rest,
        ...(cashierDiscountLimit ? { cashierDiscountLimit: limitFromWire(cashierDiscountLimit) } : {}),
        ...(managerDiscountLimit ? { managerDiscountLimit: limitFromWire(managerDiscountLimit) } : {}),
      });
      await deps.settings.save(next);
      await record(c, before, next);
      return c.json(toWire(next));
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  return app;
}

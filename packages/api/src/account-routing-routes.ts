import { Hono } from "hono";
import {
  ACCOUNT_ROUTING_SLOTS,
  DEFAULT_ACCOUNT_ROUTING_OPTIONS,
  isAccountRoutingKey,
  type AccountRouting,
  type AccountRoutingRepository,
} from "@mezan/domain";
import { updateAccountRoutingSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * توجيه الحسابات (R6.1), mounted at `/accounting/account-routing`.
 *
 * The response always lists EVERY slot, resolved — a routing screen that only
 * showed what a tenant had already overridden could not be used to discover
 * where anything currently posts, which is the question it exists to answer.
 */
function serialize(routing: AccountRouting) {
  return {
    slots: ACCOUNT_ROUTING_SLOTS.map((slot) => {
      const override = routing.overrides[slot.key];
      return {
        key: slot.key,
        section: slot.section,
        labelAr: slot.labelAr,
        labelEn: slot.labelEn,
        defaultAccountId: slot.defaultAccountId,
        accountId: override ?? slot.defaultAccountId,
        overridden: override !== undefined,
      };
    }),
    options: routing.options,
  };
}

export function createAccountRoutingRoutes(
  repo: AccountRoutingRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function current(): Promise<AccountRouting> {
    return (await repo.get()) ?? { overrides: {}, options: DEFAULT_ACCOUNT_ROUTING_OPTIONS };
  }

  app.get("/", gate("accounting.coa.view"), async (c) => c.json(serialize(await current())));

  app.put("/", gate("accounting.coa.manage"), async (c) => {
    const parsed = updateAccountRoutingSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);

    const routing = await current();
    const overrides: Record<string, string> = { ...routing.overrides };
    for (const [key, accountId] of Object.entries(parsed.data.overrides ?? {})) {
      // An unknown key is a caller mistake, not a new slot: silently storing
      // it would leave a mapping nothing ever reads.
      if (!isAccountRoutingKey(key)) {
        return c.json({ error: "UNKNOWN_ROUTING_KEY", message: `Unknown account-routing key "${key}".` }, 422);
      }
      if (accountId === null) delete overrides[key];
      else overrides[key] = accountId;
    }

    const next: AccountRouting = {
      overrides,
      options: { ...routing.options, ...(parsed.data.options ?? {}) },
    };
    await repo.save(next);
    return c.json(serialize(next));
  });

  return app;
}

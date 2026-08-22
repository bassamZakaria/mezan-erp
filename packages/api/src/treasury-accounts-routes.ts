import { Hono, type Context } from "hono";
import {
  createTreasuryAccount,
  updateTreasuryAccount,
  DuplicateTreasuryAccountCodeError,
  NegativeCashBalanceError,
  TreasuryAccountNotFoundError,
  type TreasuryAccount,
  type TreasuryAccountRepository,
} from "@mezan/domain";
import { createTreasuryAccountSchema, updateTreasuryAccountSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

function serialize(account: TreasuryAccount) {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    currency: account.currency,
    branchId: account.branchId,
    glAccountId: account.glAccountId,
    openingBalance: account.openingBalance.toString(),
    openingBalanceDate: account.openingBalanceDate,
    status: account.status,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof TreasuryAccountNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateTreasuryAccountCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof NegativeCashBalanceError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Treasury account routes (docs/catalog/04 "حسابات الخزينة"): list, get one,
 * create, edit (PATCH doubles as "إضافة رصيد افتتاحي" — adjusting the
 * opening balance after creation). Gated by `treasury.account.view` /
 * `.manage`, matching the permission catalog's treasury module row 1.
 */
export function createTreasuryAccountsRoutes(
  repo: TreasuryAccountRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("treasury.account.view"), async (c) => {
    const accounts = await repo.list();
    return c.json(accounts.map(serialize));
  });

  app.get("/:id", gate("treasury.account.view"), async (c) => {
    const account = await repo.findById(c.req.param("id"));
    if (!account) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(account));
  });

  app.post("/", gate("treasury.account.manage"), async (c) => {
    const parsed = createTreasuryAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const account = await createTreasuryAccount(parsed.data, repo);
      return c.json(serialize(account), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("treasury.account.manage"), async (c) => {
    const parsed = updateTreasuryAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const account = await updateTreasuryAccount(c.req.param("id"), parsed.data, repo);
      return c.json(serialize(account));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

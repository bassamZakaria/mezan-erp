import { Hono, type Context } from "hono";
import {
  createAccount,
  updateAccount,
  buildAccountTree,
  AccountNotFoundError,
  DuplicateAccountCodeError,
  InvalidParentAccountError,
  CircularParentAccountError,
  HeaderAccountHasChildrenError,
  AccountHasPostingsError,
  type Account,
  type AccountRepository,
  type PostedAccountLookup,
} from "@mezan/domain";
import { createAccountSchema, updateAccountSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/** Wire representation of an account — a plain JSON-safe projection. */
function serialize(account: Account) {
  return {
    id: account.id,
    code: account.code,
    nameAr: account.nameAr,
    nameEn: account.nameEn,
    type: account.type,
    naturalBalance: account.naturalBalance,
    parentId: account.parentId,
    isHeader: account.isHeader,
    status: account.status,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof AccountNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateAccountCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (
    err instanceof InvalidParentAccountError ||
    err instanceof CircularParentAccountError ||
    err instanceof HeaderAccountHasChildrenError ||
    err instanceof AccountHasPostingsError
  ) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Chart of Accounts routes (docs/archive/catalog/04 "دليل الحسابات"): list/tree, get
 * one (with a movements stub — real movements wire in once journal posting is
 * a full ledger in Phase 2), create, edit. Every route is permission-gated via
 * the permissions engine (`accounting.coa.view` / `accounting.coa.manage`).
 */
export function createAccountsRouter(
  repo: AccountRepository,
  resolveAuthContext: AuthContextResolver,
  /**
   * The GL ledger, so an edit that would strand a posted balance is refused.
   * Omit it and the chart is editable with no regard for what has been posted.
   */
  ledger?: PostedAccountLookup,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.coa.view"), async (c) => {
    const accounts = await repo.list();
    return c.json(accounts.map(serialize));
  });

  app.get("/tree", gate("accounting.coa.view"), async (c) => {
    const accounts = await repo.list();
    return c.json(buildAccountTree(accounts));
  });

  app.get("/:id", gate("accounting.coa.view"), async (c) => {
    const account = await repo.findById(c.req.param("id"));
    if (!account) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({
      ...serialize(account),
      // Movements/balance are stubbed until journal posting feeds the ledger
      // (Phase 2) — the shape is final so the web detail panel can render an
      // empty state today and light up once a real UnitOfWork backs this.
      balance: { opening: "0.000000", movement: "0.000000", closing: "0.000000" },
      movements: [] as unknown[],
      movementsStubbed: true,
    });
  });

  app.post("/", gate("accounting.coa.manage"), async (c) => {
    const parsed = createAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const account = await createAccount(parsed.data, repo);
      return c.json(serialize(account), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("accounting.coa.manage"), async (c) => {
    const parsed = updateAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const account = await updateAccount(c.req.param("id"), parsed.data, repo, ledger);
      return c.json(serialize(account));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

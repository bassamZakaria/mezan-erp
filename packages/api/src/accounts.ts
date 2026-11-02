import { messageEnOf } from "./observability/error-message-backfill.js";
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
  AuditChangeAction,
  type Account,
  type AccountRepository,
  type AuditSink,
  type PostedAccountLookup,
  can,
} from "@mezan/domain";
import { createAccountSchema, updateAccountSchema } from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { accountStandingInView, serializeAccountBalance, type AccountStandingLedger } from "./account-standing.js";
import { branchLineViewOf } from "./branch-view.js";
import { recordFieldChanges } from "./admin-audit.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

// INVARIANT: the permission `GET /gl/accounts/:accountId/ledger` is gated on — a session that may not read an account's ledger there is not told its balance here.
const ACCOUNT_BALANCE_PERMISSION = "accounting.journal.view";

function standingLedgerOf(ledger: Partial<AccountStandingLedger> | undefined): AccountStandingLedger | null {
  const accountBalance = ledger?.accountBalance;
  if (!ledger || !accountBalance) return null;
  const listLines = ledger.listLines;
  return {
    accountBalance: (accountId, asOfDate) => accountBalance.call(ledger, accountId, asOfDate),
    listLines: listLines ? (filter) => listLines.call(ledger, filter) : undefined,
  };
}

export const AUDITED_ACCOUNT_FIELDS = ["code", "nameAr", "nameEn", "type", "naturalBalance", "parentId", "isHeader", "status"] as const;

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
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 404 | 409 | 422) =>
    c.json({ error: e.code, message: e.message, messageEn: messageEnOf(e, status) }, status);
  if (err instanceof AccountNotFoundError) {
    return refuse(err, 404);
  }
  if (err instanceof DuplicateAccountCodeError) {
    return refuse(err, 409);
  }
  if (
    err instanceof InvalidParentAccountError ||
    err instanceof CircularParentAccountError ||
    err instanceof HeaderAccountHasChildrenError ||
    err instanceof AccountHasPostingsError
  ) {
    return refuse(err, 422);
  }
  throw err;
}

/**
 * Chart of Accounts routes (docs/archive/catalog/04 "دليل الحسابات"): list/tree, get
 * one (with its posted balance), create, edit. Every route is permission-gated via
 * the permissions engine (`accounting.coa.view` / `accounting.coa.manage`).
 */
export function createAccountsRouter(
  repo: AccountRepository,
  resolveAuthContext: AuthContextResolver,
  /**
   * The GL ledger, so an edit that would strand a posted balance is refused.
   * Omit it and the chart is editable with no regard for what has been posted.
   */
  ledger?: PostedAccountLookup & Partial<AccountStandingLedger>,
  audit?: AuditSink,
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
    const ctx = getAuthContext(c);
    const balances = ctx !== undefined && can(ctx, ACCOUNT_BALANCE_PERMISSION) ? standingLedgerOf(ledger) : null;
    const standing = balances ? await accountStandingInView(balances, account.id, branchLineViewOf(c)) : null;
    return c.json({ ...serialize(account), balance: standing ? serializeAccountBalance(standing.balance) : null });
  });

  app.post("/", gate("accounting.coa.manage"), async (c) => {
    const parsed = createAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const account = await createAccount(parsed.data, repo);
      await recordFieldChanges(audit, c, {
        entity: { module: "accounting", entityType: "ACCOUNT", entityId: account.id },
        action: AuditChangeAction.Create,
        before: null,
        after: serialize(account),
        fields: AUDITED_ACCOUNT_FIELDS,
      });
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
      const before = await repo.findById(c.req.param("id"));
      const account = await updateAccount(c.req.param("id"), parsed.data, repo, ledger);
      await recordFieldChanges(audit, c, {
        entity: { module: "accounting", entityType: "ACCOUNT", entityId: account.id },
        action: AuditChangeAction.Update,
        before: before ? serialize(before) : null,
        after: serialize(account),
        fields: AUDITED_ACCOUNT_FIELDS,
        warnOn: ["type", "naturalBalance", "parentId", "isHeader", "status"],
      });
      return c.json(serialize(account));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

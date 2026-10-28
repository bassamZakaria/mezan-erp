import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import {
  type ForeignTreasuryBalance,
  Money,
  createTreasuryAccount,
  updateTreasuryAccount,
  DuplicateAccountCodeError,
  DuplicateTreasuryAccountCodeError,
  InvalidGuaranteeFacilityLimitError,
  InvalidParentAccountError,
  InvalidOpeningBalanceError,
  InvalidTreasuryLedgerAccountError,
  NegativeCashBalanceError,
  TreasuryAccountNotFoundError,
  TreasuryAccountHasMovementsError,
  TreasuryGlAccountCurrencyConflictError,
  TreasuryLedgerAccountUnlinkError,
  AuditChangeAction,
  type AuditSink,
  type TreasuryAccount,
  type TreasuryAccountRepository,
  type TreasuryLedgerAccountDeps,
} from "@mezan/domain";
import { createTreasuryAccountSchema, updateTreasuryAccountSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";
import { recordFieldChanges } from "./admin-audit.js";
import { AUDITED_ACCOUNT_FIELDS } from "./accounts.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { sharedFieldRefusal } from "./branch-policy.js";

const TREASURY_ACCOUNTS_PREFIX = "/treasury-accounts";
import { DuplicateRecordIdError } from "@mezan/domain";

function serialize(account: TreasuryAccount) {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    nameEn: account.nameEn,
    type: account.type,
    currency: account.currency,
    bankAccountNumber: account.bankAccountNumber,
    branchId: account.branchId,
    glAccountId: account.glAccountId,
    openingBalance: account.openingBalance.toString(),
    openingBalanceDate: account.openingBalanceDate,
    guaranteeFacilityLimit: account.guaranteeFacilityLimit === null ? null : account.guaranteeFacilityLimit.toString(),
    status: account.status,
  };
}

export const AUDITED_TREASURY_ACCOUNT_FIELDS = [
  "code",
  "name",
  "nameEn",
  "type",
  "currency",
  "bankAccountNumber",
  "branchId",
  "glAccountId",
  "openingBalance",
  "openingBalanceDate",
  "guaranteeFacilityLimit",
  "status",
] as const;

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 404 | 409 | 422) =>
    c.json({ error: e.code, message: e.message, ...(e.messageEn ? { messageEn: e.messageEn } : {}) }, status);
  if (err instanceof TreasuryAccountNotFoundError) {
    return refuse(err, 404);
  }
  if (err instanceof DuplicateTreasuryAccountCodeError || err instanceof DuplicateAccountCodeError) {
    return refuse(err, 409);
  }
  if (
    err instanceof NegativeCashBalanceError ||
    err instanceof InvalidTreasuryLedgerAccountError ||
    err instanceof TreasuryLedgerAccountUnlinkError ||
    err instanceof InvalidParentAccountError ||
    err instanceof InvalidGuaranteeFacilityLimitError ||
    err instanceof InvalidOpeningBalanceError ||
    err instanceof TreasuryAccountHasMovementsError ||
    err instanceof TreasuryGlAccountCurrencyConflictError
  ) {
    return refuse(err, 422);
  }
  throw err;
}

/**
 * Treasury account routes (docs/archive/catalog/04 "حسابات الخزينة"): list, chip
 * counts, KPI stats, get one, create, edit (PATCH doubles as "إضافة رصيد
 * افتتاحي" — adjusting the opening balance after creation). Gated by
 * `treasury.account.view` / `.manage`, matching the permission catalog's
 * treasury module row 1.
 */
export function createTreasuryAccountsRoutes(
  repo: TreasuryAccountRepository,
  resolveAuthContext: AuthContextResolver,
  /**
   * A treasury account's LIVE balance is its GL account's balance. Without this
   * the strip can only report opening balances, and publishing one under a
   * live-balance label is the defect `73381da` fixed — so the live figures are
   * omitted rather than approximated when no ledger is wired.
   */
  ledger?: { accountBalance(accountId: string, asOfDate?: string): Promise<{ balance: Money }>; listLines?(filter: { accountIds: readonly string[] }): Promise<readonly unknown[]> },
  /**
   * Which GL account a till or bank posts to is what decides where cash lands.
   * Repointing one silently is the treasury twin of raising a credit limit.
   */
  audit?: AuditSink,
  ledgerAccounts?: TreasuryLedgerAccountDeps,
  foreignBalances?: () => Promise<readonly ForeignTreasuryBalance[]>,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  function auditAccount(c: Context, account: TreasuryAccount, action: AuditChangeAction, before?: TreasuryAccount | null) {
    return recordFieldChanges(audit, c, {
      entity: { module: "treasury", entityType: "TREASURY_ACCOUNT", entityId: account.id },
      action,
      before: before ? serialize(before) : null,
      after: serialize(account),
      fields: AUDITED_TREASURY_ACCOUNT_FIELDS,
      warnOn: ["glAccountId", "openingBalance", "openingBalanceDate", "currency", "bankAccountNumber", "branchId", "guaranteeFacilityLimit", "status"],
      details: { code: account.code, name: account.name },
    });
  }

  function auditingOpenedLeaf(c: Context, treasuryAccountId: string): TreasuryLedgerAccountDeps | undefined {
    if (!ledgerAccounts) return undefined;
    return {
      ...ledgerAccounts,
      onOpened: async (leaf) => {
        await recordFieldChanges(audit, c, {
          entity: { module: "accounting", entityType: "ACCOUNT", entityId: leaf.id },
          action: AuditChangeAction.Create,
          before: null,
          after: leaf,
          fields: AUDITED_ACCOUNT_FIELDS,
          details: { treasuryAccountId },
        });
      },
    };
  }

  /**
   * The list's one chip axis mixes status with type — الكل / نشط / نقدية /
   * بنكية / غير نشط — so a single `status` parameter carries all five, and an
   * unrecognised value is rejected rather than ignored: silently dropping it
   * would widen the set the caller asked to narrow.
   */
  const ACCOUNT_FILTERS = new Set(["all", "active", "inactive", "cash", "bank"]);

  interface AccountListFilter {
    readonly status?: string;
    readonly search?: string;
  }

  function parseListQuery(c: Context): { ok: true; filter: AccountListFilter } | { ok: false; details: unknown } {
    const status = c.req.query("status") || undefined;
    if (status && !ACCOUNT_FILTERS.has(status)) {
      return { ok: false, details: { fieldErrors: { status: [`قيمة غير معروفة: ${status}`] } } };
    }
    return { ok: true, filter: { status, search: c.req.query("search") || undefined } };
  }

  /**
   * The single filter the rows, the chip counts and the KPI strip all go
   * through (R1.1). `search` narrows an already-scoped set — `branchScopeOf`
   * alone decides which accounts this caller may see, and no query parameter
   * widens it.
   */
  async function listFilteredAccounts(c: Context, filter: AccountListFilter): Promise<readonly TreasuryAccount[]> {
    let rows = withinScope(await repo.list(), branchScopeOf(c), (a) => a.branchId);
    const { status, search } = filter;
    if (status === "active" || status === "inactive") rows = rows.filter((a) => a.status === status);
    else if (status === "cash" || status === "bank") rows = rows.filter((a) => a.type === status);
    const term = search?.trim().toLowerCase();
    if (term) {
      rows = rows.filter((a) => a.name.toLowerCase().includes(term) || (a.nameEn ?? "").toLowerCase().includes(term) || a.code.toLowerCase().includes(term));
    }
    return rows;
  }

  async function withForeignBalance(accounts: readonly TreasuryAccount[]) {
    const rows = new Map(((await foreignBalances?.()) ?? []).map((row) => [row.treasuryAccountId, row]));
    const linked = accounts.some((account) => account.glAccountId) ? ((await ledgerAccounts?.accounts.list()) ?? []) : [];
    const chart = new Map(linked.map((account) => [account.id, account]));
    return accounts.map((account) => {
      const row = rows.get(account.id);
      const ledgerAccount = account.glAccountId ? chart.get(account.glAccountId) : undefined;
      return {
        ...serialize(account),
        glAccountCode: ledgerAccount?.code ?? null,
        glAccountNameAr: ledgerAccount?.nameAr ?? null,
        glAccountNameEn: ledgerAccount?.nameEn ?? null,
        foreignBalance: row ? row.foreignBalance.toString() : null,
        foreignBalanceBase: row ? row.baseBalance.toString() : null,
        foreignBalanceDerivedLines: row ? row.derivedLines : null,
      };
    });
  }

  app.get("/", gate("treasury.account.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    const accounts = await listFilteredAccounts(c, parsed.filter);
    return c.json(await withForeignBalance(accounts));
  });

  /**
   * The filter chips. Deliberately ignores the `status` query parameter: a
   * chip has to say how many rows it WOULD show, so counting the already
   * filtered set would render every chip but the active one as zero. The
   * search term still applies.
   */
  app.get("/counts", gate("treasury.account.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    const { status: _ignored, ...withoutStatus } = parsed.filter;
    const accounts = await listFilteredAccounts(c, withoutStatus);
    const counts: Record<string, number> = { all: accounts.length, active: 0, inactive: 0, cash: 0, bank: 0 };
    for (const account of accounts) {
      counts[account.status] = (counts[account.status] ?? 0) + 1;
      counts[account.type] = (counts[account.type] ?? 0) + 1;
    }
    return c.json(counts);
  });

  /**
   * The KPI strip, summed in `Money` over the whole filtered set (R1.1).
   *
   * The money reported here is the OPENING balance, and is named so. A
   * treasury account's live balance IS its GL account's balance, which only
   * the trial balance can produce and this module has no ledger dependency to
   * ask — reporting an opening figure as "الرصيد" is precisely the defect
   * fixed in the balances screens, so it is not repeated here under a name
   * that would invite it.
   */
  app.get("/stats", gate("treasury.account.view"), async (c) => {
    const parsed = parseListQuery(c);
    if (!parsed.ok) return c.json({ error: "VALIDATION_ERROR", details: parsed.details }, 400);
    const accounts = await listFilteredAccounts(c, parsed.filter);
    let active = 0;
    let inactive = 0;
    let openingTotal = Money.zero();
    let openingCash = Money.zero();
    let openingBank = Money.zero();
    for (const account of accounts) {
      if (account.status === "active") active += 1;
      if (account.status === "inactive") inactive += 1;
      openingTotal = openingTotal.add(account.openingBalance);
      if (account.type === "cash") openingCash = openingCash.add(account.openingBalance);
      if (account.type === "bank") openingBank = openingBank.add(account.openingBalance);
    }
    // Summed from the ledger, per account, rather than from the documents —
    // the balance IS the control account, and any other route to it can drift.
    let liveTotal = Money.zero();
    let liveCash = Money.zero();
    let liveBank = Money.zero();
    if (ledger) {
      for (const account of accounts) {
        if (!account.glAccountId) continue;
        const { balance } = await ledger.accountBalance(account.glAccountId);
        liveTotal = liveTotal.add(balance);
        if (account.type === "cash") liveCash = liveCash.add(balance);
        if (account.type === "bank") liveBank = liveBank.add(balance);
      }
    }

    return c.json({
      count: accounts.length,
      active,
      inactive,
      openingTotal: openingTotal.toString(),
      openingCash: openingCash.toString(),
      openingBank: openingBank.toString(),
      // Absent, not zero, when no ledger is wired: a zero here would read as
      // "the tills are empty" rather than "not measured".
      ...(ledger
        ? { liveTotal: liveTotal.toString(), liveCash: liveCash.toString(), liveBank: liveBank.toString() }
        : {}),
    });
  });

  app.get("/:id", gate("treasury.account.view"), async (c) => {
    const account = await repo.findById(c.req.param("id"));
    if (!account) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json((await withForeignBalance([account]))[0]);
  });

  app.post("/", gate("treasury.account.manage"), async (c) => {
    const parsed = createTreasuryAccountSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const account = await createTreasuryAccount(parsed.data, repo, auditingOpenedLeaf(c, parsed.data.id));
      await auditAccount(c, account, AuditChangeAction.Create);
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
      const before = await repo.findById(c.req.param("id"));
      const restricted = before ? sharedFieldRefusal(c, TREASURY_ACCOUNTS_PREFIX, serialize(before), parsed.data) : null;
      if (restricted) return restricted;
      const account = await updateTreasuryAccount(c.req.param("id"), parsed.data, repo, auditingOpenedLeaf(c, c.req.param("id")), {
        hasPostedLines: async (glAccountId) => ((await ledger?.listLines?.({ accountIds: [glAccountId] })) ?? []).length > 0,
      });
      await auditAccount(c, account, AuditChangeAction.Update, before);
      return c.json(serialize(account));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

import { useMemo, useState, type FormEvent } from "react";
import {
  FulcrumRule,
  AccountTree,
  Button,
  Card,
  EntityPicker,
  IconButton,
  Money,
  StatCard,
  StatusPill,
  SidePanel,
  type AccountTreeRow,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import type { AccountDTO, AccountStatusDTO, AccountTypeDTO, NaturalBalanceDTO } from "@mezan/contracts";
import { buildAccountTree, hasChildAccounts, isDescendantOf, type AccountTreeNode } from "../lib/account-tree";
import { useAccounts, useCreateAccount, useUpdateAccount } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const TYPE_KEY: Record<AccountTypeDTO, AppTranslationKey> = {
  asset: "coa.type.asset",
  liability: "coa.type.liability",
  equity: "coa.type.equity",
  revenue: "coa.type.revenue",
  expense: "coa.type.expense",
};

const NATURAL_BALANCE_KEY: Record<NaturalBalanceDTO, AppTranslationKey> = { debit: "coa.natural.debit", credit: "coa.natural.credit" };
const NATURE_KEY = { header: "coa.nature.header", detail: "coa.nature.detail" } as const;
const STATUS_KEY: Record<AccountStatusDTO, AppTranslationKey> = { active: "coa.status.active", inactive: "coa.status.inactive" };
const STATUS_TONE: Record<AccountStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

const ROOT_PARENT_ID = "__root__";

interface FlatRow extends AccountDTO {
  level: number;
  hasChildren: boolean;
}

/** Depth-first walk of the tree, pruning branches whose header is collapsed. */
function visibleRows(nodes: readonly AccountTreeNode[], level: number, expanded: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = [];
  for (const node of nodes) {
    const { children, ...account } = node;
    out.push({ ...account, level, hasChildren: children.length > 0 });
    if (children.length > 0 && expanded.has(node.id)) {
      out.push(...visibleRows(children, level + 1, expanded));
    }
  }
  return out;
}

/**
 * Client-side mirror of the hierarchy rules `@mezan/domain`'s
 * `createAccount`/`updateAccount` enforce (packages/domain/src/accounts) —
 * unique code, a parent must exist and be a header account, no reparent
 * cycles, a header with children can't become postable. The server
 * re-validates on save; this runs first so the form shows the same messages
 * inline without importing the whole domain package into the web bundle.
 */
/** Returns a catalogue KEY (with any placeholders), so the caller decides the locale. */
type ValidationError = { key: AppTranslationKey; params?: Record<string, string | number> };

function validateDraft(draft: AccountDraft, existing: AccountDTO[], editingId: string | null): ValidationError | null {
  if (!editingId && existing.some((a) => a.code === draft.code.trim())) {
    return { key: "coa.codeInUse" as const, params: { code: draft.code.trim() } };
  }
  if (draft.parentId !== null) {
    if (editingId && draft.parentId === editingId) {
      return { key: "coa.circularParent" as const };
    }
    const parent = existing.find((a) => a.id === draft.parentId);
    if (!parent) return { key: "coa.parentMissing" as const };
    if (!parent.isHeader) return { key: "coa.parentNotHeader" as const };
    if (editingId && isDescendantOf(existing, draft.parentId, editingId)) {
      return { key: "coa.circularParent" as const };
    }
  }
  if (editingId) {
    const current = existing.find((a) => a.id === editingId);
    if (current?.isHeader && !draft.isHeader && hasChildAccounts(existing, editingId)) {
      return { key: "coa.hasChildren" as const };
    }
  }
  return null;
}

interface AccountDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: AccountTypeDTO;
  naturalBalance: NaturalBalanceDTO;
  parentId: string | null;
  isHeader: boolean;
  status: AccountStatusDTO;
}

const BLANK_DRAFT: AccountDraft = {
  code: "",
  nameAr: "",
  nameEn: "",
  type: "asset",
  naturalBalance: "debit",
  parentId: null,
  isHeader: false,
  status: "active",
};

function draftFromAccount(account: AccountDTO): AccountDraft {
  return {
    code: account.code,
    nameAr: account.nameAr,
    nameEn: account.nameEn ?? "",
    type: account.type,
    naturalBalance: account.naturalBalance,
    parentId: account.parentId,
    isHeader: account.isHeader,
    status: account.status,
  };
}

export function ChartOfAccountsScreen() {
  const { t } = useAppTranslation();
  const query = useAccounts();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const accounts = query.data ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountTypeDTO | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatusDTO | "all">("all");
  const [expandedOverride, setExpandedOverride] = useState<Set<string> | null>(null);

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"movements" | "audit">("movements");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(BLANK_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  const tree = useMemo(() => buildAccountTree(accounts), [accounts]);
  const allHeaderIds = useMemo(() => accounts.filter((a) => a.isHeader).map((a) => a.id), [accounts]);
  // All headers start expanded until the user makes their first explicit toggle.
  const expandedIds = expandedOverride ?? new Set(allHeaderIds);

  const hasActiveFilter = search.trim() !== "" || typeFilter !== "all" || statusFilter !== "all";

  const rows: FlatRow[] = useMemo(() => {
    if (!hasActiveFilter) return visibleRows(tree, 0, expandedIds);
    const q = search.trim().toLowerCase();
    return [...accounts]
      .filter((a) => typeFilter === "all" || a.type === typeFilter)
      .filter((a) => statusFilter === "all" || a.status === statusFilter)
      .filter((a) => q === "" || a.nameAr.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || (a.nameEn ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => ({ ...a, level: 0, hasChildren: false }));
  }, [tree, accounts, expandedIds, hasActiveFilter, search, typeFilter, statusFilter]);

  const treeRows: AccountTreeRow[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    typeLabel: t(TYPE_KEY[row.type]),
    natureLabel: row.isHeader ? t(NATURE_KEY.header) : t(NATURE_KEY.detail),
    statusLabel: t(STATUS_KEY[row.status]),
    statusTone: STATUS_TONE[row.status],
    level: row.level,
    hasChildren: row.hasChildren,
    expanded: expandedIds.has(row.id),
  }));

  const allExpanded = allHeaderIds.length > 0 && allHeaderIds.every((id) => expandedIds.has(id));

  const headerOptions: EntityPickerOption[] = useMemo(
    () => [
      { id: ROOT_PARENT_ID, label: t("coa.rootParent") },
      ...accounts
        .filter((a) => a.isHeader && a.id !== editingId)
        .map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` })),
    ],
    [accounts, editingId],
  );

  const selectedAccount = selectedAccountId ? accounts.find((a) => a.id === selectedAccountId) ?? null : null;
  const parentOfSelected = selectedAccount?.parentId ? accounts.find((a) => a.id === selectedAccount.parentId) ?? null : null;
  // Movements/balance are stubbed server-side (GET /accounts/:id) until journal posting feeds the ledger — always zero today.
  const balance = { opening: 0, movement: 0, closing: 0 };

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(account: AccountDTO) {
    setEditingId(account.id);
    setDraft(draftFromAccount(account));
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, accounts, editingId);
    if (error) {
      setFormError(t(error.key, error.params));
      return;
    }
    setFormError(null);
    const nameEn = draft.nameEn.trim() === "" ? null : draft.nameEn.trim();
    try {
      if (editingId) {
        await updateAccount.mutateAsync({
          id: editingId,
          patch: {
            nameAr: draft.nameAr.trim(),
            nameEn,
            type: draft.type,
            naturalBalance: draft.naturalBalance,
            parentId: draft.parentId,
            isHeader: draft.isHeader,
            status: draft.status,
          },
        });
      } else {
        await createAccount.mutateAsync({
          id: crypto.randomUUID(),
          code: draft.code.trim(),
          nameAr: draft.nameAr.trim(),
          nameEn,
          type: draft.type,
          naturalBalance: draft.naturalBalance,
          parentId: draft.parentId,
          isHeader: draft.isHeader,
        });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.failed"));
    }
  }

  const totalCount = accounts.length;
  const activeCount = accounts.filter((a) => a.status === "active").length;
  const headerCount = accounts.filter((a) => a.isHeader).length;
  const detailCount = accounts.filter((a) => !a.isHeader).length;

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="mz-eyebrow">{t("eyebrow.accounting.chartOfAccounts")}</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("coa.chartOfAccounts")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">
            {t("coa.theTreeOfParentAnd")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={() => setExpandedOverride(allExpanded ? new Set() : new Set(allHeaderIds))}>
            {allExpanded ? t("coa.collapseAll") : t("coa.expandAll")}
          </Button>
          <Button variant="primary" onClick={openCreateForm}>
            {t("coa.addAccount")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("coa.theChartOfAccountsCould")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("coa.totalAccounts")} value={<span className="mz-num">{totalCount}</span>} />
        <StatCard label={t("coa.activeAccounts")} value={<span className="mz-num">{activeCount}</span>} />
        <StatCard label={t("coa.parentAccounts")} value={<span className="mz-num">{headerCount}</span>} />
        <StatCard label={t("coa.detailAccounts")} value={<span className="mz-num">{detailCount}</span>} />
      </div>

      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <div className="flex min-w-[240px] flex-1 items-center gap-[9px] rounded-md border border-border bg-surface px-[13px] py-[9px] focus-within:border-brand">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] flex-none text-ink-faint">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("coa.searchByNameOrNumber")}
            aria-label={t("coa.searchByNameOrNumber2")}
            className="w-full border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <select
          aria-label={t("coa.filterByType")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AccountTypeDTO | "all")}
          className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
        >
          <option value="all">{t("coa.allTypes")}</option>
          {(Object.keys(TYPE_KEY) as AccountTypeDTO[]).map((type) => (
            <option key={type} value={type}>
              {t(TYPE_KEY[type])}
            </option>
          ))}
        </select>
        <select
          aria-label={t("coa.filterByStatus")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AccountStatusDTO | "all")}
          className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
        >
          <option value="all">{t("coa.allStatuses")}</option>
          <option value="active">{t("common.active")}</option>
          <option value="inactive">{t("common.inactive")}</option>
        </select>
      </div>

      <AccountTree
        rows={treeRows}
        onToggle={(id) =>
          setExpandedOverride((prev) => {
            const next = new Set(prev ?? allHeaderIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onRowClick={(id) => {
          setSelectedAccountId(id);
          setDetailTab("movements");
        }}
        rowActions={(row) => (
          <IconButton
            aria-label={t("coa.editNamed", { name: row.nameAr })}
            onClick={(event) => {
              event.stopPropagation();
              const account = accounts.find((a) => a.id === row.id);
              if (account) openEditForm(account);
            }}
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px]">
              <path
                d="M13.5 3.5 16.5 6.5 7 16H4v-3L13.5 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
        )}
        emptyState={<div className="p-4 text-center text-[12.5px] text-ink-muted">{t("coa.noMatchingAccounts")}</div>}
      />

      <div className="mt-[10px] text-xs text-ink-muted">
        {t("common.show")} <span className="mz-num">{rows.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("coa.accounts")}
      </div>

      <div className="mt-[18px] flex items-start gap-[13px] rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] bg-brand text-accent">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[19px] w-[19px]">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 6v5M10 14h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <h3 className="mb-[6px] font-display text-[13.5px] font-bold text-brand">{t("coa.accountNumberingGuide")}</h3>
          <p className="text-[12.5px] text-ink">
            {t("coa.1xxxAssets2xxxLiabilities3xxx")}
          </p>
        </div>
      </div>

      {/* -------- Account detail panel -------- */}
      <SidePanel
        open={selectedAccount !== null}
        onClose={() => setSelectedAccountId(null)}
        title={selectedAccount ? `${selectedAccount.code} — ${selectedAccount.nameAr}` : ""}
        description={selectedAccount ? t(TYPE_KEY[selectedAccount.type]) : undefined}
      >
        {selectedAccount ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill label={t(STATUS_KEY[selectedAccount.status])} tone={STATUS_TONE[selectedAccount.status]} />
              <span className="inline-flex rounded-sm bg-surface-3 px-[8px] py-[3px] text-[11.5px] font-semibold text-ink-muted">
                {selectedAccount.isHeader ? t(NATURE_KEY.header) : t(NATURE_KEY.detail)}
              </span>
              <Button size="sm" onClick={() => openEditForm(selectedAccount)}>
                {t("common.edit")}
              </Button>
            </div>

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("coa.normalBalance")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{t(NATURAL_BALANCE_KEY[selectedAccount.naturalBalance])}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("coa.parentAccount")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">
                  {parentOfSelected ? `${parentOfSelected.code} — ${parentOfSelected.nameAr}` : t("coa.noParentRoot")}
                </div>
              </div>
            </Card>

            <Card className="grid grid-cols-3 overflow-hidden">
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("coa.openingBalance")}</div>
                <div className="mt-[5px]"><Money value={balance?.opening ?? 0} /></div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("coa.movementInThePeriod")}</div>
                <div className="mt-[5px]"><Money value={balance?.movement ?? 0} /></div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("coa.closingBalance")}</div>
                <div className="mt-[5px]"><Money value={balance?.closing ?? 0} /></div>
              </div>
            </Card>

            <div>
              <div role="tablist" className="mb-[12px] flex gap-1 border-b border-border">
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "movements"}
                  onClick={() => setDetailTab("movements")}
                  className={`-mb-px border-b-2 px-3 py-[9px] text-[12.5px] font-semibold transition-colors ${detailTab === "movements" ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  {t("coa.accountMovement")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={detailTab === "audit"}
                  onClick={() => setDetailTab("audit")}
                  className={`-mb-px border-b-2 px-3 py-[9px] text-[12.5px] font-semibold transition-colors ${detailTab === "audit" ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  {t("coa.auditTrail")}
                </button>
              </div>
              {detailTab === "movements" ? (
                <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">
                  {t("coa.accountMovementWillAppearHere")}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">
                  {t("coa.theAuditTrailShowsEvery")}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Add / edit account form -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? t("coa.editAccount") : t("coa.addAccount")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <div>
            <label htmlFor="acct-type" className="mb-[6px] block text-xs font-semibold text-ink-muted">
              {t("coa.type")}
            </label>
            <select
              id="acct-type"
              required
              value={draft.type}
              onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value as AccountTypeDTO }))}
              className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink"
            >
              {(Object.keys(TYPE_KEY) as AccountTypeDTO[]).map((type) => (
                <option key={type} value={type}>
                  {t(TYPE_KEY[type])}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="acct-code" className="mb-[6px] block text-xs font-semibold text-ink-muted">
              {t("coa.code")}
            </label>
            <input
              id="acct-code"
              required
              dir="ltr"
              disabled={editingId !== null}
              value={draft.code}
              onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              placeholder="1xxx"
              className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-60"
            />
            <span className="mt-[4px] block text-[11px] text-ink-faint">{t("coa.codesOfThisTypeUsually")}</span>
          </div>

          <div>
            <label htmlFor="acct-name-ar" className="mb-[6px] block text-xs font-semibold text-ink-muted">
              {t("coa.name")}
            </label>
            <input
              id="acct-name-ar"
              required
              value={draft.nameAr}
              onChange={(e) => setDraft((d) => ({ ...d, nameAr: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </div>

          <div>
            <label htmlFor="acct-name-en" className="mb-[6px] block text-xs font-semibold text-ink-muted">
              {t("coa.nameInEnglish")}
            </label>
            <input
              id="acct-name-en"
              dir="ltr"
              value={draft.nameEn}
              onChange={(e) => setDraft((d) => ({ ...d, nameEn: e.target.value }))}
              className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink outline-none focus:border-brand"
            />
          </div>

          <EntityPicker
            label={t("coa.parentAccount")}
            options={headerOptions}
            value={draft.parentId ? (headerOptions.find((o) => o.id === draft.parentId) ?? null) : (headerOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, parentId: !option || option.id === ROOT_PARENT_ID ? null : option.id }))}
          />

          <div>
            <label htmlFor="acct-natural-balance" className="mb-[6px] block text-xs font-semibold text-ink-muted">
              {t("coa.normalBalance2")}
            </label>
            <select
              id="acct-natural-balance"
              required
              value={draft.naturalBalance}
              onChange={(e) => setDraft((d) => ({ ...d, naturalBalance: e.target.value as NaturalBalanceDTO }))}
              className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink"
            >
              <option value="debit">{t("common.debit")}</option>
              <option value="credit">{t("common.credit")}</option>
            </select>
          </div>

          <label htmlFor="acct-is-header" className="flex items-center justify-between gap-[10px] rounded-md border border-border px-[12px] py-[10px]">
            <span className="text-[12.5px] font-semibold text-ink">{t("coa.parentAccountCannotBePosted")}</span>
            <input
              id="acct-is-header"
              type="checkbox"
              checked={draft.isHeader}
              onChange={(e) => setDraft((d) => ({ ...d, isHeader: e.target.checked }))}
              className="h-[18px] w-[18px]"
            />
          </label>

          {editingId ? (
            <div>
              <label htmlFor="acct-status" className="mb-[6px] block text-xs font-semibold text-ink-muted">
                {t("common.status")}
              </label>
              <select
                id="acct-status"
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as AccountStatusDTO }))}
                className="w-full rounded-md border border-border bg-surface px-[11px] py-[9px] text-[13px] text-ink"
              >
                <option value="active">{t("common.active")}</option>
                <option value="inactive">{t("common.inactive")}</option>
              </select>
            </div>
          ) : null}

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? t("common.save") : t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

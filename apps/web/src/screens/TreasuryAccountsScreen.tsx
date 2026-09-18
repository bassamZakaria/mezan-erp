import { useEffect, useMemo, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/error-message";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { DocumentList, EmptyState, Money as MoneyDisplay, StatusPill, Chip, Card, Button, RowMenu, SidePanel, MoneyInput, TextInput, useFormat, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { TREASURY_ACCOUNT_TYPE_DEFINITIONS, getTreasuryAccountTypeLabel, type TreasuryAccountType as DomainTreasuryAccountType } from "@mezan/domain";
import type { BranchDTO, ListCountsDTO, TreasuryAccountDTO, TreasuryAccountStatusDTO, TreasuryAccountTypeDTO } from "@mezan/contracts";
import { ApiError, useAccountLedger, useBranches, useCreateJournalEntry, useCreateTreasuryAccount, useTreasuryAccounts, useUpdateTreasuryAccount,
  useTreasuryAccountStats,
} from "../data/hooks";
import { useApi } from "../data/ApiContext";
import { treasuryBalanceById } from "../lib/partner-balances";
import { useFinancialReport } from "../data/financial-reports-hooks";
import type { TrialBalanceRow } from "@mezan/domain";
import { branchName } from "../settings/branch-name";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlSearch } from "../lib/url-state";

/**
 * Chip counts (R1.1). Not in `data/hooks.ts` yet — the /treasury-accounts/counts
 * endpoint already exists (its own `status` axis withheld, same as every other
 * list resource), but this pass wires only the chips, so the hook is kept
 * screen-local rather than exported.
 */
function useTreasuryAccountCounts(search: string): UseQueryResult<ListCountsDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<ListCountsDTO, ApiError>({
    queryKey: ["treasury-accounts", "counts", search],
    enabled: session !== null,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      const qs = params.toString();
      const res = await request(`/treasury-accounts/counts${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new ApiError(res.status, t("treasuryAcc.treasuryAccountsCouldNotBe"));
      return res.json<ListCountsDTO>();
    },
  });
}

/**
 * أرصدة افتتاحية — the equity account an opening balance is funded from. NOT
 * 3200, which is Partner Drawings and carries the opposite natural balance;
 * posting an opening balance there would be wrong in a way the trial balance
 * would still show as balanced.
 */
const OPENING_BALANCE_EQUITY_ACCOUNT = "3210";

const PAGE_SIZES = [10, 25, 50, 100] as const;

/** حسابات الخزينة (Treasury Accounts) — docs/archive/catalog/04 §"حسابات الخزينة". List + detail + add dialog. */

const STATUS_KEY: Record<TreasuryAccountStatusDTO, AppTranslationKey> = { active: "treasuryAcc.status.active", inactive: "treasuryAcc.status.inactive" };
const STATUS_TONE: Record<TreasuryAccountStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

interface TreasuryAccountDraft {
  code: string;
  name: string;
  nameEn: string;
  type: TreasuryAccountTypeDTO;
  currency: string;
  branchId: string;
  glAccountId: string;
  openingBalance: number | null;
  openingBalanceDate: string;
  guaranteeFacilityLimit: number | null;
  active: boolean;
}

function blankDraft(branches: BranchDTO[]): TreasuryAccountDraft {
  return {
    code: "",
    name: "",
    nameEn: "",
    type: "cash",
    currency: "EGP",
    branchId: branches[0]?.id ?? "",
    glAccountId: "",
    openingBalance: 0,
    openingBalanceDate: "",
    guaranteeFacilityLimit: null,
    active: true,
  };
}

function draftFromAccount(account: TreasuryAccountDTO): TreasuryAccountDraft {
  return {
    code: account.code,
    name: account.name,
    nameEn: account.nameEn ?? "",
    type: account.type,
    currency: account.currency,
    branchId: account.branchId,
    glAccountId: account.glAccountId ?? "",
    openingBalance: toMajor(account.openingBalance),
    openingBalanceDate: account.openingBalanceDate ?? "",
    guaranteeFacilityLimit: account.guaranteeFacilityLimit === null ? null : toMajor(account.guaranteeFacilityLimit),
    active: account.status === "active",
  };
}

/** Returns a catalogue KEY (with any placeholders), so the caller decides the locale. */
type ValidationError = { key: AppTranslationKey; params?: Record<string, string | number> };

function validateDraft(draft: TreasuryAccountDraft, existing: TreasuryAccountDTO[], editingId: string | null): ValidationError | null {
  const code = draft.code.trim();
  if (code === "") return { key: "treasuryAcc.codeRequired" as const };
  if (existing.some((a) => a.code === code && a.id !== editingId)) return { key: "treasuryAcc.codeInUse" as const, params: { code } };
  if (draft.name.trim() === "") return { key: "treasuryAcc.nameRequired" as const };
  if (draft.branchId.trim() === "") return { key: "treasuryAcc.branchRequired" as const };
  if (draft.type === "cash" && (draft.openingBalance ?? 0) < 0) {
    return { key: "treasuryAcc.cashNotNegative" as const };
  }
  return null;
}

export function TreasuryAccountsScreen() {
  const { t } = useAppTranslation();
  const nameOf = useEntityName();
  const query = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const createTreasuryAccount = useCreateTreasuryAccount();
  const updateTreasuryAccount = useUpdateTreasuryAccount();
  const accounts = query.data ?? EMPTY;
  const branches = branchesQuery.data ?? [];
  const [searchText, setSearchText, search] = useUrlSearch();
  // The chips (R1.1): /treasury-accounts/counts drops its own status/type axis, so
  // every chip reports how many rows it would show under the search term alone,
  // not the count of whatever chip happens to be active.
  const accountCounts = useTreasuryAccountCounts(search).data ?? {};
  const [filter, setFilter] = useState<"all" | "active" | "cash" | "bank" | "inactive">("all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openingFor, setOpeningFor] = useState<TreasuryAccountDTO | null>(null);
  const [openingAmount, setOpeningAmount] = useState(0);
  const [openingDate, setOpeningDate] = useState(todayIso());
  const [openingError, setOpeningError] = useState<string | null>(null);
  const postOpeningEntry = useCreateJournalEntry();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TreasuryAccountDraft>(blankDraft(branches));
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = accounts;
    if (filter === "active") rows = rows.filter((a) => a.status === "active");
    else if (filter === "inactive") rows = rows.filter((a) => a.status === "inactive");
    else if (filter === "cash") rows = rows.filter((a) => a.type === "cash");
    else if (filter === "bank") rows = rows.filter((a) => a.type === "bank");
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
    }
    return rows;
  }, [accounts, filter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = filter === "all" ? 0 : 1;

  // A treasury account's balance IS its GL account's balance. Reporting the
  // opening figure under "الرصيد" left the screen at 0.00 with ten confirmed
  // vouchers posted (D41); re-deriving it from vouchers disagreed with the
  // ledger by 248,900 on the bank account, because cheques and settlements post
  // there too.
  const trialBalance = useFinancialReport<TrialBalanceRow>("trial-balance", "/trial-balance", { asOfDate: todayIso() });
  const liveBalance = useMemo(() => treasuryBalanceById(accounts, trialBalance.data?.rows ?? []), [accounts, trialBalance.data]);
  const balanceOf = (id: string) => liveBalance.get(id) ?? 0;
  /**
   * Summed on the SERVER over the whole filtered set, in Money, from the GL
   * (R1.1) — the browser sum below is the fallback for a backend with no ledger
   * wired, and adds JS numbers, which is exactly what R1.1 exists to remove.
   */
  const stats = useTreasuryAccountStats().data;
  const totalBalance = stats?.liveTotal !== undefined ? Number(stats.liveTotal) : accounts.reduce((sum, a) => sum + balanceOf(a.id), 0);
  const cashBalance = stats?.liveCash !== undefined ? Number(stats.liveCash) : accounts.filter((a) => a.type === "cash").reduce((sum, a) => sum + balanceOf(a.id), 0);
  const bankBalance = stats?.liveBank !== undefined ? Number(stats.liveBank) : accounts.filter((a) => a.type === "bank").reduce((sum, a) => sum + balanceOf(a.id), 0);

  const selected = selectedId ? accounts.find((a) => a.id === selectedId) ?? null : null;

  function openCreateForm() {
    setEditingId(null);
    setDraft(blankDraft(branches));
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(account: TreasuryAccountDTO) {
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
    const fields = {
      code: draft.code.trim(),
      name: draft.name.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      type: draft.type,
      currency: draft.currency,
      branchId: draft.branchId,
      glAccountId: draft.glAccountId.trim() === "" ? null : draft.glAccountId.trim(),
      openingBalance: (draft.openingBalance ?? 0).toFixed(6),
      openingBalanceDate: draft.openingBalanceDate.trim() === "" ? null : draft.openingBalanceDate.trim(),
      guaranteeFacilityLimit: draft.guaranteeFacilityLimit === null ? null : draft.guaranteeFacilityLimit.toFixed(6),
    };
    try {
      if (editingId) {
        await updateTreasuryAccount.mutateAsync({ id: editingId, patch: { ...fields, status: draft.active ? "active" : "inactive" } });
      } else {
        await createTreasuryAccount.mutateAsync({ id: crypto.randomUUID(), ...fields });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("common.failed"));
    }
  }

  const columns: DocumentListColumn<TreasuryAccountDTO>[] = [
    {
      key: "name",
      header: t("treasuryAcc.accountName"),
      render: (a) => (
        <div>
          <div className="font-semibold text-ink">{nameOf(a)}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">
            {a.code} · {branchName(a.branchId, branches)}
          </div>
        </div>
      ),
    },
    { key: "type", header: t("treasuryAcc.accountType"), render: (a) => <StatusPill label={getTreasuryAccountTypeLabel(a.type as DomainTreasuryAccountType)} tone="info" /> },
    { key: "currency", header: t("treasuryAcc.currency"), render: (a) => a.currency },
    { key: "balance", header: t("treasuryAcc.balance"), align: "end", render: (a) => <MoneyDisplay value={balanceOf(a.id)} /> },
    { key: "status", header: t("common.status"), render: (a) => <StatusPill label={t(STATUS_KEY[a.status])} tone={STATUS_TONE[a.status]} /> },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (a) => (
        <div className="flex items-center justify-end" onClick={(event) => event.stopPropagation()}>
          <RowMenu
            label={a.name}
            items={
              // Offered only where it applies (R8.4): an account already
              // holding money does not need an opening balance, and one with
              // no GL account behind it has nowhere to post it.
              balanceOf(a.id) === 0 && a.glAccountId !== null
                ? [
                    {
                      key: "opening-balance",
                      label: t("treasuryAcc.action.openingBalance"),
                      onSelect: () => setOpeningFor(a),
                    },
                  ]
                : []
            }
          />
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("treasuryAcc.treasuryAccountsCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<TreasuryAccountDTO>
        title={t("treasuryAcc.treasuryAccounts")}
        description={t("treasuryAcc.cashBoxesAndBankAccounts")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("treasuryAcc.addAccount")}
          </Button>
        }
        listKey="treasury-accounts"
        statsCollapsible
        stats={[
          { label: t("treasuryAcc.totalAccounts"), value: <span className="mz-num">{accounts.length}</span> },
          { label: t("treasuryAcc.totalBalances"), value: <MoneyDisplay value={totalBalance} /> },
          { label: t("treasuryAcc.cashOnHand"), value: <MoneyDisplay value={cashBalance} /> },
          { label: t("treasuryAcc.bankBalance"), value: <MoneyDisplay value={bankBalance} /> },
        ]}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("treasuryAcc.searchByName")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]" role="radiogroup">
            {(
              [
                ["all", t("common.all")],
                ["active", t("common.active")],
                ["cash", t("treasuryAcc.cash")],
                ["bank", t("treasuryAcc.bank")],
                ["inactive", t("common.inactive")],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                active={filter === value}
                count={accountCounts[value] ?? 0}
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                }}
              >
                {label}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={branchesQuery.isLoading}
        rowKey={(a) => a.id}
        onRowClick={(a) => setSelectedId(a.id)}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{accounts.length}</span> {t("treasuryAcc.accounts")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("treasuryAcc.noMatchingTreasuryAccounts")}
            description={t("treasuryAcc.emptyBody")}
            action={{ label: t("treasuryAcc.addAccount"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel
        open={openingFor !== null}
        title={t("treasuryAcc.opening.title")}
        onClose={() => {
          setOpeningFor(null);
          setOpeningError(null);
        }}
      >
        <div className="flex flex-col gap-[12px]">
          <p className="text-[12.5px] text-ink-muted">{t("treasuryAcc.opening.hint")}</p>
          {openingFor !== null && openingFor.glAccountId === null ? (
            <p className="text-[12.5px] font-semibold text-danger-ink">{t("treasuryAcc.opening.noGlAccount")}</p>
          ) : null}
          <label className="flex flex-col gap-[5px] text-[12.5px] font-semibold text-ink">
            {t("treasuryAcc.balance")}
            <MoneyInput value={openingAmount} onChange={(value) => setOpeningAmount(value ?? 0)} aria-label={t("treasuryAcc.balance")} />
          </label>
          <label className="flex flex-col gap-[5px] text-[12.5px] font-semibold text-ink">
            {t("common.date")}
            <TextInput
              type="date"
              value={openingDate}
              onChange={(event) => setOpeningDate(event.target.value)}
              aria-label={t("common.date")}
            />
          </label>
          {openingError ? <p className="text-[12.5px] font-semibold text-danger-ink">{openingError}</p> : null}
          <Button
            variant="primary"
            disabled={openingAmount <= 0 || postOpeningEntry.isPending}
            onClick={async () => {
              const account = openingFor;
              if (!account?.glAccountId) return;
              setOpeningError(null);
              try {
                await postOpeningEntry.mutateAsync({
                  id: `TRO-${account.id}-${openingDate}`,
                  date: openingDate,
                  memo: t("treasuryAcc.opening.title") + " — " + account.name,
                  lines: [
                    // Money in, funded by equity. Amounts are wire decimals so
                    // the figure never becomes a float on its way to the ledger.
                    { accountId: account.glAccountId, debit: openingAmount.toFixed(2), credit: "0.00" },
                    { accountId: OPENING_BALANCE_EQUITY_ACCOUNT, debit: "0.00", credit: openingAmount.toFixed(2) },
                  ],
                });
                setOpeningFor(null);
                setOpeningAmount(0);
              } catch (err) {
                setOpeningError(errorMessage(err, t("common.failed")));
              }
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </SidePanel>

      {/* -------- Treasury account detail panel -------- */}
      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("treasuryAcc.statementTitle", { name: selected.name }) : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center justify-between gap-[8px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
                <StatusPill label={getTreasuryAccountTypeLabel(selected.type as DomainTreasuryAccountType)} tone="info" />
              </div>
              <Button variant="primary" onClick={() => openEditForm(selected)}>
                {t("common.edit")}
              </Button>
            </div>
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.code")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.code}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("treasuryAcc.currency")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.currency}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.branch")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId, branches)}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("treasuryAcc.ledgerAccount")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.glAccountId ?? t("treasuryAcc.automaticByType")}</div>
              </div>
            </Card>
            <TreasuryAccountLedger account={selected} />
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Add/edit treasury account form -------- */}
      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? t("treasuryAcc.editAccount") : t("treasuryAcc.addAccount")}
        description={t("treasuryAcc.theAccountSCoreDetails")}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("treasuryAcc.accountName2")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label={t("treasuryAcc.accountNameEn")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <TextField label={t("treasuryAcc.code")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="CASH-003" />
          <SelectField
            label={t("treasuryAcc.accountType2")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as TreasuryAccountTypeDTO }))}
            options={TREASURY_ACCOUNT_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: d.labelAr }))}
          />
          <TextField label={t("treasuryAcc.currency2")} value={draft.currency} onChange={(v) => setDraft((d) => ({ ...d, currency: v.toUpperCase() }))} />
          <SelectField
            label={t("treasuryAcc.branch")}
            value={draft.branchId}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <TextField
            label={t("treasuryAcc.ledgerAccount")}
            value={draft.glAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, glAccountId: v }))}
            hint={t("treasuryAcc.youRarelyNeedToFill")}
          />

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("treasuryAcc.openingBalanceOptional")}</h3>
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("treasuryAcc.openingBalance")}</div>
                <MoneyInput aria-label={t("treasuryAcc.openingBalance")} value={draft.openingBalance} onChange={(v) => setDraft((d) => ({ ...d, openingBalance: v }))} />
              </div>
              <TextField
                label={t("treasuryAcc.openingBalanceDate")}
                value={draft.openingBalanceDate}
                onChange={(v) => setDraft((d) => ({ ...d, openingBalanceDate: v }))}
                placeholder="YYYY-MM-DD"
              />
            </div>
          </div>

          {draft.type === "bank" ? (
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("treasuryAcc.guaranteeFacilityLimit")}</div>
              <MoneyInput
                aria-label={t("treasuryAcc.guaranteeFacilityLimit")}
                value={draft.guaranteeFacilityLimit}
                onChange={(v) => setDraft((d) => ({ ...d, guaranteeFacilityLimit: v }))}
              />
              <p className="mt-[4px] text-[11.5px] text-ink-muted">{t("treasuryAcc.guaranteeFacilityLimitHint")}</p>
            </div>
          ) : null}

          {editingId ? (
            <ToggleField label={t("common.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
          ) : null}

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {editingId ? t("treasuryAcc.saveChanges") : t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}


/**
 * حركة الحساب — the treasury account's own GL movements and its TRUE closing
 * balance. Two defects in one card: the panel printed a "(المرحلة الثانية)"
 * placeholder over the ledger (D43), and the "closing balance" figure beside it
 * was actually the OPENING balance, so a till that had taken money all month
 * still read as it did on day one (the D41 shape).
 */
function TreasuryAccountLedger({ account }: { account: TreasuryAccountDTO }) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const query = useAccountLedger(account.glAccountId ?? null);
  const lines = query.data?.lines ?? [];
  const closing = query.data?.balance;

  return (
    <>
      <Card className="p-[13px_15px]">
        <div className="text-[11px] font-semibold text-ink-faint">{t("treasuryAcc.closingBalance")}</div>
        <div className="mt-[6px]">
          <MoneyDisplay value={closing ? Number(closing.balance) : toMajor(account.openingBalance)} className="text-[18px] font-bold" />
        </div>
        <div className="mt-[6px] text-[11.5px] text-ink-faint">
          {t("treasuryAcc.openingBalance")} <MoneyDisplay value={toMajor(account.openingBalance)} />
          {account.openingBalanceDate ? <span className="mz-num"> · {account.openingBalanceDate}</span> : null}
        </div>
      </Card>

      {query.isLoading ? (
        <div className="p-[18px] text-center text-[12.5px] text-ink-muted">{t("common.loading")}</div>
      ) : lines.length === 0 ? (
        <div className="rounded-md border border-border p-[18px] text-center text-[12.5px] text-ink-muted">{t("treasuryAcc.movements.empty")}</div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="bg-surface-2 text-[11px] font-semibold text-ink-faint">
              <tr>
                <th className="px-[13px] py-[8px] text-start">{t("common.date")}</th>
                <th className="px-[13px] py-[8px] text-start">{t("coa.movements.entry")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("coa.movements.debit")}</th>
                <th className="px-[13px] py-[8px] text-end">{t("coa.movements.credit")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.entryId} className="border-t border-border">
                  <td className="mz-num px-[13px] py-[9px]">{line.date}</td>
                  <td className="mz-num px-[13px] py-[9px] text-ink">{line.entryNo ?? "—"}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end">{Number(line.debit) ? format.money(Number(line.debit)) : "—"}</td>
                  <td className="mz-num px-[13px] py-[9px] text-end">{Number(line.credit) ? format.money(Number(line.credit)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

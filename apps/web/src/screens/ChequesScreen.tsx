import { useMemo, useState } from "react";
import {
  FulcrumRule,
  Button,
  Card,
  DocumentList,
  EntityPicker,
  Money as MoneyDisplay,
  MoneyInput,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { CHEQUE_STATUS_DEFINITIONS, getChequeDirectionLabel, getChequeStatusLabel } from "@mezan/domain";
import type { ChequeDTO, ChequeDirectionDTO, ChequeStatusDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import {
  useBounceCheque,
  useBranches,
  useCheques,
  useCollectCheque,
  useCreateCheque,
  useCustomers,
  useDepositCheque,
  useReplaceCheque,
  useSuppliers,
  useTreasuryAccounts,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/**
 * سجل الشيكات — Cheque Register (docs/catalog/04, route `/financial-papers/cheques`
 * + `/financial-papers/cheques/new`). Real data only: the list, its 7-state status
 * tabs and every lifecycle action (إيداع/تحصيل/ارتداد/استبدال) go through
 * `/cheques`; the party and branch typeaheads are real customers/suppliers/branches.
 *
 * The two routes are one component with a `mode` switch, matching how the shell
 * routes screens by nav key rather than by URL.
 */

const STATUS_TONE: Record<ChequeStatusDTO, PillTone> = {
  pending: "neutral",
  under_collection: "info",
  due_today: "warning",
  deposited: "info",
  collected: "success",
  bounced: "danger",
  replaced: "neutral",
};

/**
 * Control accounts each direction posts against — the standard COA
 * (packages/domain/src/accounts/coa-template.ts): incoming cheques reclassify
 * out of trade receivables (1105) into "شيكات تحت التحصيل" (1320), bouncing into
 * "شيكات مرتجعة" (1360); outgoing ones move trade payables (2100) into
 * "شيكات صادرة" (2150), which has no bounced counterpart.
 */
const DIRECTION_ACCOUNTS: Record<ChequeDirectionDTO, { counterparty: string; underCollection: string; bounced: string | null }> = {
  incoming: { counterparty: "1105", underCollection: "1320", bounced: "1360" },
  outgoing: { counterparty: "2100", underCollection: "2150", bounced: null },
};

/** The bank GL account a collection lands in — "النقدية بالبنوك" in the standard COA. */
const BANK_GL_ACCOUNT_ID = "1310";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The lifecycle actions legal from a cheque's CURRENT stored status (domain status.ts). */
function legalActions(cheque: ChequeDTO): ("deposit" | "collect" | "bounce" | "replace")[] {
  switch (cheque.status) {
    case "pending":
      return ["deposit"];
    case "deposited":
      return ["collect", "bounce"];
    case "bounced":
      return cheque.direction === "incoming" ? ["replace"] : [];
    default:
      return [];
  }
}

/** Keys, not copy — the action buttons translate at render. */
const ACTION_KEY = {
  deposit: "cheques.action.deposit",
  collect: "cheques.action.collect",
  bounce: "cheques.action.bounce",
  replace: "cheques.action.replace",
} as const;

export function ChequesScreen() {
  const { t } = useAppTranslation();
  const [mode, setMode] = useState<"list" | "create">("list");
  const [statusFilter, setStatusFilter] = useState<"all" | ChequeStatusDTO>("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | ChequeDirectionDTO>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Direction + date range go to the server as query params. The status tabs
  // then partition THAT result set on `effectiveStatus`, which the server
  // derives per row against its own "as of" date — the client never recomputes
  // it, and one request keeps every tab's count real rather than unknown.
  const query = useCheques({
    direction: directionFilter === "all" ? undefined : directionFilter,
    fromDate: fromDate === "" ? undefined : fromDate,
    toDate: toDate === "" ? undefined : toDate,
  });
  const cheques = useMemo(() => query.data ?? [], [query.data]);

  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const treasuryQuery = useTreasuryAccounts();

  const deposit = useDepositCheque();
  const collect = useCollectCheque();
  const bounce = useBounceCheque();
  const replace = useReplaceCheque();

  const partyName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customersQuery.data ?? []) map.set(c.id, c.nameAr);
    for (const s of suppliersQuery.data ?? []) map.set(s.id, s.nameAr);
    return (id: string) => map.get(id) ?? id;
  }, [customersQuery.data, suppliersQuery.data]);

  const bankTreasuryAccounts = useMemo(
    () => (treasuryQuery.data ?? []).filter((account) => account.type === "bank" && account.status === "active"),
    [treasuryQuery.data],
  );

  const statusCounts = useMemo(() => {
    const counts: Record<ChequeStatusDTO, number> = {
      pending: 0,
      under_collection: 0,
      due_today: 0,
      deposited: 0,
      collected: 0,
      bounced: 0,
      replaced: 0,
    };
    for (const c of cheques) counts[c.effectiveStatus] += 1;
    return counts;
  }, [cheques]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cheques
      .filter((c) => (statusFilter === "all" ? true : c.effectiveStatus === statusFilter))
      .filter((c) => (q === "" ? true : c.chequeNumber.toLowerCase().includes(q)));
  }, [cheques, search, statusFilter]);

  const totals = useMemo(() => {
    let value = 0;
    let pendingValue = 0;
    let depositedValue = 0;
    for (const c of cheques) {
      const amount = Number(c.amount);
      value += amount;
      if (c.status === "pending") pendingValue += amount;
      if (c.status === "deposited") depositedValue += amount;
    }
    return { count: cheques.length, value, pendingValue, depositedValue };
  }, [cheques]);

  const selected = selectedId ? (cheques.find((c) => c.id === selectedId) ?? null) : null;

  async function runAction(cheque: ChequeDTO, action: "deposit" | "collect" | "bounce" | "replace") {
    if (pendingId) return;
    setPendingId(cheque.id);
    setActionError(null);
    try {
      if (action === "deposit") {
        const bankAccount = bankTreasuryAccounts[0];
        if (!bankAccount) throw new Error(t("cheques.thereIsNoActiveBank"));
        await deposit.mutateAsync({ id: cheque.id, body: { bankTreasuryAccountId: bankAccount.id } });
      } else if (action === "collect") {
        await collect.mutateAsync({ id: cheque.id, body: { bankGlAccountId: BANK_GL_ACCOUNT_ID, date: today() } });
      } else if (action === "bounce") {
        await bounce.mutateAsync({ id: cheque.id, body: { date: today() } });
      } else {
        await replace.mutateAsync({
          id: cheque.id,
          body: {
            newCheque: {
              chequeNumber: `${cheque.chequeNumber}-R`,
              bankName: cheque.bankName,
              bankBranchName: cheque.bankBranchName,
              bankAccountNumber: cheque.bankAccountNumber,
              issueDate: today(),
              dueDate: plusDays(30),
              branchId: cheque.branchId,
              notes: cheque.notes,
            },
            date: today(),
          },
        });
      }
      setSelectedId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  }

  if (mode === "create") {
    return <CreateChequeView onDone={() => setMode("list")} />;
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: cheques.length },
    ...CHEQUE_STATUS_DEFINITIONS.map((d) => ({ key: d.code, label: d.labelAr, count: statusCounts[d.code] })),
  ];

  const columns: DocumentListColumn<ChequeDTO>[] = [
    {
      key: "chequeNumber",
      header: t("cheques.chequeNumber"),
      render: (c) => <span className="mz-num font-semibold text-ink">{c.chequeNumber}</span>,
    },
    { key: "party", header: t("cheques.party"), render: (c) => <span className="text-ink">{partyName(c.partyId)}</span> },
    { key: "amount", header: t("common.amount"), align: "end", render: (c) => <MoneyDisplay value={Number(c.amount)} /> },
    { key: "dueDate", header: t("cheques.dueDate"), render: (c) => <span className="mz-num">{c.dueDate}</span> },
    { key: "bankName", header: t("cheques.bankName"), render: (c) => <span className="text-ink-muted">{c.bankName}</span> },
    { key: "direction", header: t("cheques.direction"), render: (c) => getChequeDirectionLabel(c.direction) },
    {
      key: "status",
      header: t("common.status"),
      render: (c) => <StatusPill label={getChequeStatusLabel(c.effectiveStatus)} tone={STATUS_TONE[c.effectiveStatus]} />,
    },
    {
      key: "createdBy",
      header: t("cheques.by"),
      render: (c) => <span className="mz-num text-[11px] text-ink-faint">{c.createdAt.slice(0, 10)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (c) => {
        const actions = legalActions(c);
        if (actions.length === 0) return <span className="text-ink-faint">—</span>;
        return (
          <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setSelectedId(c.id); }}>
            {t("cheques.actions")}
          </Button>
        );
      },
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<ChequeDTO>
        title={t("cheques.chequeRegister")}
        description={t("cheques.trackingChequesInFromCustomers")}
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            {t("cheques.newCheque")}
          </Button>
        }
        stats={[
          { label: t("cheques.totalCheques"), value: <span className="mz-num">{totals.count}</span> },
          { label: t("cheques.totalValue"), value: <MoneyDisplay value={totals.value} /> },
          { label: t("cheques.pending"), value: <MoneyDisplay value={totals.pendingValue} /> },
          { label: t("cheques.deposited"), value: <MoneyDisplay value={totals.depositedValue} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | ChequeStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("cheques.searchByChequeNumber")}
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="w-[150px]">
              <SelectField
                label={t("cheques.direction")}
                value={directionFilter}
                onChange={(v) => setDirectionFilter(v as "all" | ChequeDirectionDTO)}
                options={[
                  { value: "all", label: t("cheques.allDirections") },
                  { value: "incoming", label: t("cheques.incoming") },
                  { value: "outgoing", label: t("cheques.outgoing") },
                ]}
              />
            </div>
            <div className="w-[150px]">
              <TextField label={t("cheques.from")} value={fromDate} onChange={setFromDate} placeholder="YYYY-MM-DD" />
            </div>
            <div className="w-[150px]">
              <TextField label={t("cheques.to")} value={toDate} onChange={setToDate} placeholder="YYYY-MM-DD" />
            </div>
          </div>
        }
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{rows.length}</span> {t("common.of")} <span className="mz-num">{totals.count}</span> {t("cheques.cheques")}
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? t("common.loading") : query.isError ? (query.error?.message ?? t("cheques.chequesCouldNotBeLoaded")) : t("cheques.noCheques")}
          </div>
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("cheques.detailTitle", { number: selected.chequeNumber }) : t("cheques.cheques")}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={getChequeStatusLabel(selected.effectiveStatus)} tone={STATUS_TONE[selected.effectiveStatus]} />
            <div className="text-[12.5px] text-ink-muted">{t("cheques.party2")} {partyName(selected.partyId)}</div>
            <div className="text-[12.5px] text-ink-muted">{t("cheques.bank")} {selected.bankName}</div>
            <div className="text-[12.5px] text-ink-muted">
              {t("cheques.due")} <span className="mz-num">{selected.dueDate}</span>
            </div>
            <div className="flex items-center justify-between text-[13px] font-semibold">
              <span>{t("common.amount")}</span>
              <MoneyDisplay value={Number(selected.amount)} />
            </div>

            {actionError ? <div role="alert" className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{actionError}</div> : null}

            <div className="flex flex-col gap-2">
              {legalActions(selected).map((action) => (
                <Button
                  key={action}
                  variant={action === "bounce" ? "danger-outline" : "primary"}
                  disabled={pendingId === selected.id}
                  onClick={() => runAction(selected, action)}
                >
                  {t(ACTION_KEY[action])}
                </Button>
              ))}
              {legalActions(selected).length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">{t("cheques.noActionsAreAvailableOn")}</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* شيك جديد — create form (`/financial-papers/cheques/new`)              */
/* -------------------------------------------------------------------- */

function CreateChequeView({ onDone }: { onDone: () => void }) {
  const { t } = useAppTranslation();
  const [direction, setDirection] = useState<ChequeDirectionDTO | null>(null);
  const [partyId, setPartyId] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranchName, setBankBranchName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(plusDays(30));
  const [branchId, setBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const customersQuery = useCustomers();
  const suppliersQuery = useSuppliers();
  const branchesQuery = useBranches();
  const create = useCreateCheque();

  const partyOptions: EntityPickerOption[] =
    direction === "incoming"
      ? (customersQuery.data ?? []).map((c) => ({ id: c.id, label: c.nameAr }))
      : direction === "outgoing"
        ? (suppliersQuery.data ?? []).map((s) => ({ id: s.id, label: s.nameAr }))
        : [];
  const branchOptions: EntityPickerOption[] = (branchesQuery.data ?? []).map((b) => ({ id: b.id, label: b.name }));

  function pickDirection(next: ChequeDirectionDTO) {
    setDirection(next);
    setPartyId(""); // the party field swaps between customers and suppliers
  }

  const canSubmit =
    direction !== null &&
    partyId !== "" &&
    chequeNumber.trim() !== "" &&
    bankName.trim() !== "" &&
    (amount ?? 0) > 0 &&
    issueDate !== "" &&
    dueDate !== "" &&
    branchId !== "" &&
    !create.isPending;

  async function submit() {
    if (!direction || !canSubmit) return;
    setError(null);
    const accounts = DIRECTION_ACCOUNTS[direction];
    try {
      await create.mutateAsync({
        direction,
        chequeNumber: chequeNumber.trim(),
        bankName: bankName.trim(),
        bankBranchName: bankBranchName.trim() === "" ? null : bankBranchName.trim(),
        bankAccountNumber: bankAccountNumber.trim() === "" ? null : bankAccountNumber.trim(),
        amount: String(amount ?? 0),
        issueDate,
        dueDate,
        branchId,
        notes: notes.trim() === "" ? null : notes.trim(),
        partyId,
        counterpartyGlAccountId: accounts.counterparty,
        controlAccounts: { underCollectionAccountId: accounts.underCollection, bouncedAccountId: accounts.bounced },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("cheques.newCheque")}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {t("cheques.saveCheque")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">{t("cheques.chequeType")}</h2>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <button
              type="button"
              onClick={() => pickDirection("incoming")}
              aria-pressed={direction === "incoming"}
              className={`rounded-lg border p-[16px] text-start shadow-1 transition-colors ${direction === "incoming" ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand"}`}
            >
              <div className="font-display text-[14px] font-bold text-ink">{t("cheques.incoming")}</div>
              <div className="mt-[6px] text-[12px] text-ink-muted">{t("cheques.receivedFromACustomer")}</div>
            </button>
            <button
              type="button"
              onClick={() => pickDirection("outgoing")}
              aria-pressed={direction === "outgoing"}
              className={`rounded-lg border p-[16px] text-start shadow-1 transition-colors ${direction === "outgoing" ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand"}`}
            >
              <div className="font-display text-[14px] font-bold text-ink">{t("cheques.outgoing")}</div>
              <div className="mt-[6px] text-[12px] text-ink-muted">{t("cheques.issuedToASupplier")}</div>
            </button>
          </div>

          {direction ? (
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{direction === "incoming" ? t("cheques.customer") : t("cheques.supplier")}</div>
              <EntityPicker
                value={partyOptions.find((o) => o.id === partyId) ?? null}
                onChange={(o) => setPartyId(o?.id ?? "")}
                options={partyOptions}
                placeholder={direction === "incoming" ? t("cheques.chooseTheCustomer") : t("cheques.chooseTheSupplier")}
              />
            </div>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">{t("cheques.chequeDetails")}</h2>
          <TextField label={t("cheques.chequeNumber2")} value={chequeNumber} onChange={setChequeNumber} placeholder="CHQ-5001" />
          <TextField label={t("cheques.bankName2")} value={bankName} onChange={setBankName} />
          <TextField label={t("cheques.bankBranch")} value={bankBranchName} onChange={setBankBranchName} />
          <TextField label={t("cheques.accountNumber")} value={bankAccountNumber} onChange={setBankAccountNumber} />
        </Card>

        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">{t("cheques.valueAndDates")}</h2>
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("cheques.amount")}</div>
            <MoneyInput value={amount} onChange={setAmount} aria-label={t("common.amount")} />
          </div>
          <TextField label={t("cheques.issueDate")} value={issueDate} onChange={setIssueDate} placeholder="YYYY-MM-DD" />
          <TextField label={t("cheques.dueDate2")} value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
        </Card>

        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">{t("cheques.branchAndNotes")}</h2>
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("cheques.branch")}</div>
            <EntityPicker
              value={branchOptions.find((o) => o.id === branchId) ?? null}
              onChange={(o) => setBranchId(o?.id ?? "")}
              options={branchOptions}
              placeholder={t("cheques.chooseTheBranch")}
            />
          </div>
          <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
        </Card>
      </div>
    </div>
  );
}

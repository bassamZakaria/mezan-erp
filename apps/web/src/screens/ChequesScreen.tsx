import { useMemo, useState } from "react";
import {
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

const ACTION_LABEL = {
  deposit: "إيداع في البنك",
  collect: "تأكيد التحصيل",
  bounce: "تسجيل ارتداد",
  replace: "استبدال الشيك",
} as const;

export function ChequesScreen() {
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
    () => (treasuryQuery.data ?? []).filter((t) => t.type === "bank" && t.status === "active"),
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
        if (!bankAccount) throw new Error("لا يوجد حساب خزينة بنكي نشط لإيداع الشيك فيه.");
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
    { key: "all", label: "الكل", count: cheques.length },
    ...CHEQUE_STATUS_DEFINITIONS.map((d) => ({ key: d.code, label: d.labelAr, count: statusCounts[d.code] })),
  ];

  const columns: DocumentListColumn<ChequeDTO>[] = [
    {
      key: "chequeNumber",
      header: "رقم الشيك",
      render: (c) => <span className="mz-num font-semibold text-ink">{c.chequeNumber}</span>,
    },
    { key: "party", header: "الجهة", render: (c) => <span className="text-ink">{partyName(c.partyId)}</span> },
    { key: "amount", header: "المبلغ", align: "end", render: (c) => <MoneyDisplay value={Number(c.amount)} /> },
    { key: "dueDate", header: "تاريخ الاستحقاق", render: (c) => <span className="mz-num">{c.dueDate}</span> },
    { key: "bankName", header: "اسم البنك", render: (c) => <span className="text-ink-muted">{c.bankName}</span> },
    { key: "direction", header: "الاتجاه", render: (c) => getChequeDirectionLabel(c.direction) },
    {
      key: "status",
      header: "الحالة",
      render: (c) => <StatusPill label={getChequeStatusLabel(c.effectiveStatus)} tone={STATUS_TONE[c.effectiveStatus]} />,
    },
    {
      key: "createdBy",
      header: "بواسطة",
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
            إجراءات
          </Button>
        );
      },
    },
  ];

  return (
    <div className="w-full">
      <DocumentList<ChequeDTO>
        eyebrow="Financial Papers · Cheques"
        title="سجل الشيكات"
        description="متابعة الشيكات الواردة من العملاء والصادرة للموردين عبر دورة حياتها الكاملة."
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            شيك جديد
          </Button>
        }
        stats={[
          { label: "إجمالي الشيكات", value: <span className="mz-num">{totals.count}</span> },
          { label: "إجمالي القيمة", value: <MoneyDisplay value={totals.value} /> },
          { label: "قيد الانتظار", value: <MoneyDisplay value={totals.pendingValue} /> },
          { label: "مودع", value: <MoneyDisplay value={totals.depositedValue} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | ChequeStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم الشيك..."
        filterBarExtra={
          <div className="flex flex-wrap items-end gap-[10px]">
            <div className="w-[150px]">
              <SelectField
                label="الاتجاه"
                value={directionFilter}
                onChange={(v) => setDirectionFilter(v as "all" | ChequeDirectionDTO)}
                options={[
                  { value: "all", label: "كل الاتجاهات" },
                  { value: "incoming", label: "واردة" },
                  { value: "outgoing", label: "صادرة" },
                ]}
              />
            </div>
            <div className="w-[150px]">
              <TextField label="من تاريخ" value={fromDate} onChange={setFromDate} placeholder="YYYY-MM-DD" />
            </div>
            <div className="w-[150px]">
              <TextField label="إلى تاريخ" value={toDate} onChange={setToDate} placeholder="YYYY-MM-DD" />
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
            عرض <span className="mz-num">{rows.length}</span> من <span className="mz-num">{totals.count}</span> شيك
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : query.isError ? (query.error?.message ?? "تعذّر تحميل الشيكات.") : "لا توجد شيكات"}
          </div>
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? `شيك ${selected.chequeNumber}` : "شيك"}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={getChequeStatusLabel(selected.effectiveStatus)} tone={STATUS_TONE[selected.effectiveStatus]} />
            <div className="text-[12.5px] text-ink-muted">الجهة: {partyName(selected.partyId)}</div>
            <div className="text-[12.5px] text-ink-muted">البنك: {selected.bankName}</div>
            <div className="text-[12.5px] text-ink-muted">
              تاريخ الاستحقاق: <span className="mz-num">{selected.dueDate}</span>
            </div>
            <div className="flex items-center justify-between text-[13px] font-semibold">
              <span>المبلغ</span>
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
                  {ACTION_LABEL[action]}
                </Button>
              ))}
              {legalActions(selected).length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">لا توجد إجراءات متاحة على هذا الشيك.</div>
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
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Financial Papers · New Cheque</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">شيك جديد</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>إلغاء</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            حفظ الشيك
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">نوع الشيك</h2>
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <button
              type="button"
              onClick={() => pickDirection("incoming")}
              aria-pressed={direction === "incoming"}
              className={`rounded-lg border p-[16px] text-start shadow-1 transition-colors ${direction === "incoming" ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand"}`}
            >
              <div className="font-display text-[14px] font-bold text-ink">واردة</div>
              <div className="mt-[6px] text-[12px] text-ink-muted">شيك مستلم من عميل</div>
            </button>
            <button
              type="button"
              onClick={() => pickDirection("outgoing")}
              aria-pressed={direction === "outgoing"}
              className={`rounded-lg border p-[16px] text-start shadow-1 transition-colors ${direction === "outgoing" ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-brand"}`}
            >
              <div className="font-display text-[14px] font-bold text-ink">صادرة</div>
              <div className="mt-[6px] text-[12px] text-ink-muted">شيك صادر لمورد</div>
            </button>
          </div>

          {direction ? (
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{direction === "incoming" ? "العميل *" : "المورّد *"}</div>
              <EntityPicker
                value={partyOptions.find((o) => o.id === partyId) ?? null}
                onChange={(o) => setPartyId(o?.id ?? "")}
                options={partyOptions}
                placeholder={direction === "incoming" ? "اختر العميل..." : "اختر المورد..."}
              />
            </div>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">بيانات الشيك</h2>
          <TextField label="رقم الشيك *" value={chequeNumber} onChange={setChequeNumber} placeholder="CHQ-5001" />
          <TextField label="اسم البنك *" value={bankName} onChange={setBankName} />
          <TextField label="اسم فرع البنك" value={bankBranchName} onChange={setBankBranchName} />
          <TextField label="رقم الحساب" value={bankAccountNumber} onChange={setBankAccountNumber} />
        </Card>

        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">القيمة والتواريخ</h2>
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">المبلغ *</div>
            <MoneyInput value={amount} onChange={setAmount} aria-label="المبلغ" />
          </div>
          <TextField label="تاريخ الإصدار *" value={issueDate} onChange={setIssueDate} placeholder="YYYY-MM-DD" />
          <TextField label="تاريخ الاستحقاق *" value={dueDate} onChange={setDueDate} placeholder="YYYY-MM-DD" />
        </Card>

        <Card className="flex flex-col gap-[14px] p-[18px]">
          <h2 className="font-display text-[13.5px] font-bold text-ink">الفرع والملاحظات</h2>
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">الفرع *</div>
            <EntityPicker
              value={branchOptions.find((o) => o.id === branchId) ?? null}
              onChange={(o) => setBranchId(o?.id ?? "")}
              options={branchOptions}
              placeholder="اختر الفرع..."
            />
          </div>
          <TextField label="ملاحظات" value={notes} onChange={setNotes} />
        </Card>
      </div>
    </div>
  );
}

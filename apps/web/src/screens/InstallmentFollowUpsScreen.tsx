import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  RowMenu,
  SidePanel,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type { CollectionFollowUpDTO, FollowUpStatusDTO, FollowUpTypeDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import {
  useCancelFollowUp,
  useCompleteFollowUp,
  useCreateFollowUp,
  useCustomers,
  useFollowUps,
  useFollowUpCounts,
  useFollowUpStats,
  type FollowUpListFilters,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { todayIso } from "../lib/dates";

/** متابعة التحصيل (Collection Follow-ups) — docs/catalog/05. A collections-agent worklog against customers with overdue installment balances. */

const TYPE_KEY: Record<FollowUpTypeDTO, AppTranslationKey> = { CALL: "followUps.typeCall", VISIT: "followUps.typeVisit", SMS: "followUps.typeSms", EMAIL: "followUps.typeEmail", NOTE: "followUps.typeNote" };
const STATUS_KEY: Record<FollowUpStatusDTO, AppTranslationKey> = { pending: "followUps.statusPending", completed: "followUps.statusCompleted", cancelled: "followUps.statusCancelled" };
const STATUS_TONE: Record<FollowUpStatusDTO, PillTone> = { pending: "warning", completed: "success", cancelled: "neutral" };

function today(): string {
  return todayIso();
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

export function InstallmentFollowUpsScreen() {
  const { t } = useAppTranslation();
  const customersQuery = useCustomers();
  const createFollowUp = useCreateFollowUp();
  const completeFollowUp = useCompleteFollowUp();
  const cancelFollowUp = useCancelFollowUp();

  const customers = customersQuery.data ?? [];

  const customerName = useMemo(() => {
    const map = new Map(customers.map((c) => [c.id, c.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [customers]);

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [rowPendingId, setRowPendingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | FollowUpStatusDTO>("all");
  // One filter for the rows, the status chips and the KPI strip (R1.1): the
  // screen used to derive all three from one client-side fetch, so the header
  // numbers stayed at the grand total no matter which status tab was active.
  const filter = useMemo<FollowUpListFilters>(() => ({ status: statusFilter }), [statusFilter]);
  const query = useFollowUps(filter);
  const followUps = query.data ?? [];
  const counts = useFollowUpCounts(filter).data ?? {};
  const stats = useFollowUpStats(filter).data ?? {};
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [customerId, setCustomerId] = useState("");
  const [type, setType] = useState<FollowUpTypeDTO>("CALL");
  const [followUpDate, setFollowUpDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(followUps.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = followUps.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = typeof panel === "object" ? (followUps.find((f) => f.id === panel.id) ?? null) : null;

  // Defaults the create form's customer picker once the customers query resolves —
  // opening the panel alone can't do this if it happens before `customers` has loaded.
  useEffect(() => {
    if (panel !== "create" || customerId !== "") return;
    const firstCustomer = customers[0];
    if (firstCustomer) setCustomerId(firstCustomer.id);
  }, [panel, customers, customerId]);

  function openCreate() {
    setError(null);
    setCustomerId(customers[0]?.id ?? "");
    setType("CALL");
    setFollowUpDate(today());
    setNotes("");
    setPanel("create");
  }

  async function submit() {
    setError(null);
    if (!customerId) {
      setError(t("followUps.chooseACustomer"));
      return;
    }
    try {
      await createFollowUp.mutateAsync({
        id: crypto.randomUUID(),
        customerId,
        type,
        followUpDate,
        notes: notes.trim() || null,
      });
      setPanel("none");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function complete(f: CollectionFollowUpDTO) {
    setError(null);
    try {
      await completeFollowUp.mutateAsync({ id: f.id, outcome: outcome.trim() || t("followUps.followedUp") });
      setPanel("none");
      setOutcome("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function cancel(f: CollectionFollowUpDTO) {
    if (rowPendingId) return;
    setError(null);
    setRowPendingId(f.id);
    try {
      await cancelFollowUp.mutateAsync(f.id);
      setPanel("none");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRowPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all ?? 0 },
    { key: "pending", label: t("followUps.pending"), count: counts.pending ?? 0 },
    { key: "completed", label: t("followUps.completed"), count: counts.completed ?? 0 },
    { key: "cancelled", label: t("docStatus.cancelled"), count: counts.cancelled ?? 0 },
  ];

  const columns: DocumentListColumn<CollectionFollowUpDTO>[] = [
    { key: "customer", header: t("common.customer"), render: (f) => customerName(f.customerId) },
    { key: "type", header: t("followUps.followUpType"), render: (f) => t(TYPE_KEY[f.type]) },
    { key: "date", header: t("followUps.followUpDate"), render: (f) => <span className="mz-num">{f.followUpDate}</span> },
    { key: "owner", header: t("followUps.assignedTo"), render: (f) => f.assignedTo ?? t("followUps.me") },
    { key: "outcome", header: t("followUps.outcome"), render: (f) => f.outcome ?? "—" },
    { key: "status", header: t("common.status"), render: (f) => <StatusPill label={t(STATUS_KEY[f.status])} tone={STATUS_TONE[f.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("followUps.collectionFollowUpsCouldNot")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {error ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <DocumentList<CollectionFollowUpDTO>
        title={t("followUps.collectionFollowUps")}
        description={t("followUps.aRecordOfCollectionContact")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("followUps.newFollowUp")}
          </Button>
        }
        listKey="installment-follow-ups"
        statsCollapsible
        stats={[
          { label: t("followUps.totalFollowUps"), value: <span className="mz-num">{Number(stats.count ?? 0)}</span> },
          { label: t("followUps.pending2"), value: <span className="mz-num">{Number(stats.pending ?? 0)}</span> },
          { label: t("followUps.completed2"), value: <span className="mz-num">{Number(stats.completed ?? 0)}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | FollowUpStatusDTO);
          setPage(1);
        }}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(f) => f.id}
        onRowClick={(f) => setPanel({ id: f.id })}
        rowAction={(f) => {
          // Completing records an outcome, so it opens the panel that asks for one instead of writing a blank result.
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => setPanel({ id: f.id }) },
            ...(f.status === "pending"
              ? [
                  { key: "complete", label: t("followUps.completeFollowUp"), onSelect: () => setPanel({ id: f.id }) },
                  {
                    key: "cancel",
                    label: t("followUps.cancelFollowUp"),
                    tone: "danger" as const,
                    disabled: rowPendingId === f.id,
                    onSelect: () => void cancel(f),
                  },
                ]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("common.rowActionsFor", { name: customerName(f.customerId) })} />;
        }}
        page={currentPage}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{followUps.length}</span> {t("followUps.followUps")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("followUps.noFollowUpsCreatedYet")}
            description={t("followUps.emptyBody")}
            action={{ label: t("followUps.newFollowUp"), onClick: openCreate }}
          />
        }
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title={t("followUps.newFollowUp")}>
        <div className="flex flex-col gap-4 p-5">
          <SelectField label={t("followUps.customer")} value={customerId} onChange={setCustomerId} options={customers.map((c) => ({ value: c.id, label: c.nameAr }))} />
          <SelectField label={t("followUps.followUpType2")} value={type} onChange={(v) => setType(v as FollowUpTypeDTO)} options={Object.entries(TYPE_KEY).map(([value, key]) => ({ value, label: t(key) }))} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink-muted">{t("followUps.followUpDate2")}</span>
            <TextInput type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
          </label>
          <TextField label={t("common.notes")} value={notes} onChange={setNotes} placeholder={t("followUps.leaveEmptyToAssignThe")} />
          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
          <Button variant="primary" onClick={submit}>
            {t("common.add")}
          </Button>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected ? customerName(selected.customerId) : t("followUps.followUps")}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <div className="text-[12.5px] text-ink-muted">
              {t(TYPE_KEY[selected.type])} — {selected.followUpDate}
            </div>
            {selected.notes ? <div className="text-[13px] text-ink">{selected.notes}</div> : null}
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            {selected.status === "pending" ? (
              <>
                <TextField label={t("followUps.outcome")} value={outcome} onChange={setOutcome} placeholder={t("followUps.forExamplePromisedToPay")} />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => complete(selected)}>
                    {t("followUps.completeFollowUp")}
                  </Button>
                  <Button variant="ghost" onClick={() => cancel(selected)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

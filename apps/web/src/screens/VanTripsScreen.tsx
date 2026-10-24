import { useMemo, useState, type FormEvent } from "react";
import {
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  VarianceBeam,
  Chip,
  Card,
  Button,
  SidePanel,
  MoneyInput,
  QtyInput,
  type DocumentListColumn,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import { VanTripCashMovementKindDTO, VanTripCrewRoleDTO, VanTripStatusDTO, type VanDTO, type VanTripDTO } from "@mezan/contracts";
import { useApi } from "../data/ApiContext";
import { ItemPicker, itemOption } from "./ItemPicker";
import { VanTripCountForm, VanTripReconciliationCard } from "./enh/van-reconciliation/VanReconciliation";
import {
  ApiError,
  useBranches,
  useEmployees,
  useItemsByIds,
  useOpenVanTrip,
  useRecordVanCashMovement,
  useSettleVanTrip,
  useTreasuryAccounts,
  useVanTrips,
  useVans,
  useWarehouses,
} from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { employeeDisplayName } from "./hr-employee-name";
import { sumMajor } from "../lib/money";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** رحلات المندوبين (Van/Rep Trips — Field Sales) — docs/archive/catalog/07 §"رحلات المندوبين". List + open-trip form + detail with cash-movement/settle actions. */

const STATUS_KEY: Record<VanTripStatusDTO, AppTranslationKey> = {
  [VanTripStatusDTO.Ongoing]: "vanTrips.statusOngoing",
  [VanTripStatusDTO.AwaitingApproval]: "vanRecon.statusAwaitingApproval",
  [VanTripStatusDTO.Settled]: "vanTrips.statusSettled",
  [VanTripStatusDTO.Cancelled]: "vanTrips.statusCancelled",
};
const STATUS_TONE: Record<VanTripStatusDTO, PillTone> = {
  [VanTripStatusDTO.Ongoing]: "info",
  [VanTripStatusDTO.AwaitingApproval]: "warning",
  [VanTripStatusDTO.Settled]: "success",
  [VanTripStatusDTO.Cancelled]: "neutral",
};
const ROLE_KEY: Record<VanTripCrewRoleDTO, AppTranslationKey> = {
  [VanTripCrewRoleDTO.Driver]: "vanTrips.roleDriver",
  [VanTripCrewRoleDTO.Rep]: "vanTrips.roleRep",
  [VanTripCrewRoleDTO.Assistant]: "vanTrips.roleAssistant",
};
const ROLE_VALUES = Object.values(VanTripCrewRoleDTO);
const KIND_KEY: Record<VanTripCashMovementKindDTO, AppTranslationKey> = {
  [VanTripCashMovementKindDTO.Sale]: "vanTrips.kindSale",
  [VanTripCashMovementKindDTO.Collection]: "vanTrips.kindCollection",
};
const KIND_VALUES = Object.values(VanTripCashMovementKindDTO);

function countable(trip: VanTripDTO): boolean {
  if (trip.status === VanTripStatusDTO.Ongoing) return true;
  return trip.status === VanTripStatusDTO.AwaitingApproval && (trip.settlement?.reconciliation?.steps.length ?? 0) === 0;
}

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

function today(): string {
  return todayIso();
}

interface CrewDraftRow {
  employeeId: string;
  role: VanTripCrewRoleDTO;
}

interface StockDraftRow {
  itemId: string;
  qty: number;
}

interface OpenTripDraft {
  date: string;
  /** The vehicle. Choosing it decides the van warehouse, the van till and the branch. */
  vanId: string;
  sourceWarehouseId: string;
  sourceTreasuryAccountId: string;
  openingCashFloat: number | null;
  crew: CrewDraftRow[];
  loadedStock: StockDraftRow[];
  notes: string;
}

function blankDraft(): OpenTripDraft {
  return {
    date: today(),
    vanId: "",
    sourceWarehouseId: "",
    sourceTreasuryAccountId: "",
    openingCashFloat: 0,
    crew: [],
    loadedStock: [],
    notes: "",
  };
}

function validateDraft(draft: OpenTripDraft, van: VanDTO | null): AppTranslationKey | null {
  if (draft.date.trim() === "") return "vanTrips.dateRequired";
  if (draft.vanId === "" || !van) return "vanTrips.vanRequired";
  if (draft.sourceWarehouseId === "") return "vanTrips.sourceWarehouseRequired";
  if (van.warehouseId === draft.sourceWarehouseId) return "vanTrips.sourceWarehouseSameAsVan";
  if (draft.sourceTreasuryAccountId === "") return "vanTrips.sourceTillRequired";
  if (draft.crew.length === 0) return "vanTrips.crewRequired";
  return null;
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

/** A field the van decided. Read-only on purpose: the registry owns the pair, not the form. */
function CascadedValue({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-[10px_12px]">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[4px] text-[13px] text-ink">{value ?? "—"}</div>
    </div>
  );
}

export function VanTripsScreen() {
  const nameOf = useEntityName();
  const { t, locale } = useAppTranslation();
  const query = useVanTrips();
  const warehousesQuery = useWarehouses();
  const treasuryQuery = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const vansQuery = useVans();
  const employeesQuery = useEmployees();

  const openVanTrip = useOpenVanTrip();
  const recordCashMovement = useRecordVanCashMovement();
  const settleVanTrip = useSettleVanTrip();
  const { session } = useApi();
  const auth = createAuthContext({ userId: session?.userId ?? "anonymous", permissions: session?.permissions ?? [], branchScope: "*", warehouseScope: "*" });
  const mayApprove = can(auth, "field.van_trip.approve");
  const currentUserId = session?.userId ?? null;

  const trips = query.data ?? EMPTY;
  const warehouses = warehousesQuery.data ?? EMPTY;
  const treasuryAccounts = treasuryQuery.data ?? EMPTY;
  const branches = branchesQuery.data ?? EMPTY;
  const vans = (vansQuery.data ?? []).filter((v) => v.active);
  const employees = employeesQuery.data ?? EMPTY;

  const warehouseName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, nameOf(w)]));
    return (id: string) => map.get(id) ?? id;
  }, [warehouses, nameOf]);
  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => map.get(id) ?? id;
  }, [branches]);
  const treasuryName = useMemo(() => {
    const map = new Map(treasuryAccounts.map((a) => [a.id, nameOf(a)]));
    return (id: string) => map.get(id) ?? id;
  }, [treasuryAccounts, nameOf]);
  const employeeName = useMemo(() => {
    const map = new Map(employees.map((e) => [e.id, employeeDisplayName(e, locale)]));
    return (id: string) => map.get(id) ?? id;
  }, [employees, locale]);
  const vanName = useMemo(() => {
    const map = new Map((vansQuery.data ?? []).map((v) => [v.id, v.nameAr]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : null);
  }, [vansQuery.data]);

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | VanTripStatusDTO,
    (next: string) => void,
  ];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<OpenTripDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [crewEmployeeId, setCrewEmployeeId] = useState("");
  const [crewRole, setCrewRole] = useState<VanTripCrewRoleDTO>(VanTripCrewRoleDTO.Driver);
  const [stockItem, setStockItem] = useState<EntityPickerOption | null>(null);
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [stockQty, setStockQty] = useState(1);

  const [movementKind, setMovementKind] = useState<VanTripCashMovementKindDTO>(VanTripCashMovementKindDTO.Sale);
  const [movementAmount, setMovementAmount] = useState<number | null>(null);
  const [movementNotes, setMovementNotes] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);

  const [settleOpen, setSettleOpen] = useState(false);

  const filtered = useMemo(() => {
    let rows = trips;
    if (statusFilter !== "all") rows = rows.filter((trip) => trip.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((trip) => (trip.tripNo ?? trip.id).toLowerCase().includes(q));
    }
    return rows;
  }, [trips, statusFilter, search]);

  const totalCount = trips.length;
  const ongoingCount = trips.filter((trip) => trip.status === VanTripStatusDTO.Ongoing).length;
  const awaitingCount = trips.filter((trip) => trip.status === VanTripStatusDTO.AwaitingApproval).length;
  const settledCount = trips.filter((trip) => trip.status === VanTripStatusDTO.Settled).length;

  const selected = selectedId ? (trips.find((trip) => trip.id === selectedId) ?? null) : null;
  const { byId: itemById } = useItemsByIds([
    ...(selected?.loadedStock.map((line) => line.itemId) ?? []),
    ...(selected?.settlement?.stockCounts.map((line) => line.itemId) ?? []),
  ]);
  const itemName = (id: string) => pickedNames.get(id) ?? itemById.get(id)?.nameAr ?? id;
  const selectedVan = draft.vanId === "" ? null : (vans.find((v) => v.id === draft.vanId) ?? null);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const activeFilterCount = statusFilter === "all" ? 0 : 1;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setCrewEmployeeId("");
    setCrewRole(VanTripCrewRoleDTO.Driver);
    setStockItem(null);
    setStockQty(1);
    setFormOpen(true);
  }

  function addCrewRow() {
    if (crewEmployeeId.trim() === "") return;
    setDraft((d) => ({ ...d, crew: [...d.crew, { employeeId: crewEmployeeId.trim(), role: crewRole }] }));
    setCrewEmployeeId("");
    setCrewRole(VanTripCrewRoleDTO.Driver);
  }

  function removeCrewRow(index: number) {
    setDraft((d) => ({ ...d, crew: d.crew.filter((_, i) => i !== index) }));
  }

  function addStockRow() {
    if (!stockItem) return;
    const itemId = stockItem.id;
    setDraft((d) => ({ ...d, loadedStock: [...d.loadedStock, { itemId, qty: stockQty }] }));
    setStockItem(null);
    setStockQty(1);
  }

  function removeStockRow(index: number) {
    setDraft((d) => ({ ...d, loadedStock: d.loadedStock.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, selectedVan);
    if (error) {
      setFormError(t(error));
      return;
    }
    setFormError(null);
    try {
      // Only the van leaves the browser. Its warehouse, its till and its branch
      // are resolved from the registry SERVER-side — a body that named them
      // itself would be a second opinion the trip does not need.
      await openVanTrip.mutateAsync({
        id: crypto.randomUUID(),
        date: draft.date.trim(),
        vanId: draft.vanId,
        sourceWarehouseId: draft.sourceWarehouseId,
        sourceTreasuryAccountId: draft.sourceTreasuryAccountId,
        openingCashFloat: (draft.openingCashFloat ?? 0).toFixed(6),
        crew: draft.crew.map((c) => ({ employeeId: c.employeeId, role: c.role })),
        loadedStock: draft.loadedStock.length > 0 ? draft.loadedStock.map((s) => ({ itemId: s.itemId, qty: s.qty.toFixed(6) })) : undefined,
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("vanTrips.couldNotOpenTheTrip"));
    }
  }

  function openSettleForm() {
    setSettleOpen(true);
  }

  async function handleRecordMovement(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if ((movementAmount ?? 0) <= 0) {
      setMovementError(t("vanTrips.theAmountMustBeGreater"));
      return;
    }
    setMovementError(null);
    try {
      await recordCashMovement.mutateAsync({
        id: crypto.randomUUID(),
        body: {
          id: crypto.randomUUID(),
          kind: movementKind,
          amount: (movementAmount ?? 0).toFixed(6),
          occurredAt: new Date().toISOString(),
          notes: movementNotes.trim() === "" ? null : movementNotes.trim(),
        },
      });
      setMovementAmount(null);
      setMovementNotes("");
    } catch (err) {
      setMovementError(err instanceof ApiError ? err.message : t("vanTrips.couldNotRecordTheCash"));
    }
  }

  const userLabel = (id: string) => (id === currentUserId ? t("vanRecon.you") : id);

  const columns: DocumentListColumn<VanTripDTO>[] = [
    {
      key: "tripNo",
      header: t("vanTrips.tripNo"),
      render: (trip) => (
        <div>
          <div className="mz-num font-semibold text-ink">{trip.tripNo ?? trip.id}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{trip.date}</div>
        </div>
      ),
    },
    {
      key: "van",
      header: t("vanTrips.van"),
      render: (trip) => (
        <div>
          <div className="text-ink">{vanName(trip.vanId) ?? warehouseName(trip.vanWarehouseId)}</div>
          <div className="text-[11px] text-ink-faint">{warehouseName(trip.vanWarehouseId)}</div>
        </div>
      ),
    },
    {
      key: "crew",
      header: t("vanTrips.crew"),
      render: (trip) => (
        <div className="flex flex-wrap gap-1">
          {trip.crew.map((c, i) => (
            <StatusPill key={i} label={`${employeeName(c.employeeId)} · ${t(ROLE_KEY[c.role])}`} tone="neutral" />
          ))}
        </div>
      ),
    },
    { key: "branch", header: t("common.branch"), render: (trip) => branchName(trip.branchId) },
    { key: "sales", header: t("vanTrips.sales"), render: (trip) => <span className="mz-num">{trip.cashMovements.filter((m) => m.kind === VanTripCashMovementKindDTO.Sale).length}</span> },
    { key: "status", header: t("common.status"), render: (trip) => <StatusPill label={t(STATUS_KEY[trip.status])} tone={STATUS_TONE[trip.status]} /> },
    {
      key: "cash",
      header: t("vanTrips.cashCollected"),
      render: (trip) => <MoneyDisplay value={sumMajor(trip.cashMovements.map((m) => m.amount))} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("vanTrips.couldNotLoadTheVan")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<VanTripDTO>
        title={t("vanTrips.vanTrips")}
        description={t("vanTrips.openAVanTripWith")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("vanTrips.openATrip")}
          </Button>
        }
        listKey="van-trips"
        statsCollapsible
        stats={[
          { label: t("vanTrips.total"), value: <span className="mz-num">{totalCount}</span> },
          { label: t("vanTrips.open"), value: <span className="mz-num">{ongoingCount}</span> },
          { label: t("vanRecon.statusAwaitingApproval"), value: <span className="mz-num">{awaitingCount}</span> },
          { label: t("vanTrips.settled"), value: <span className="mz-num">{settledCount}</span> },
        ]}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("vanTrips.searchByTripNo")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]" role="radiogroup">
            {(
              [
                ["all", t("common.all")],
                [VanTripStatusDTO.Ongoing, t("vanTrips.open")],
                [VanTripStatusDTO.AwaitingApproval, t("vanRecon.statusAwaitingApproval")],
                [VanTripStatusDTO.Settled, t("vanTrips.settled")],
                [VanTripStatusDTO.Cancelled, t("vanTrips.cancelled")],
              ] as const
            ).map(([value, label]) => (
              <Chip
                key={value}
                active={statusFilter === value}
                onClick={() => {
                  setStatusFilter(value);
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
        loading={employeesQuery.isLoading}
        rowKey={(trip) => trip.id}
        onRowClick={(trip) => setSelectedId(trip.id)}
        rowAction={(trip) => {
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("vanTrips.row.view"), onSelect: () => setSelectedId(trip.id) },
            ...(countable(trip)
              ? [
                  {
                    key: "settle",
                    label: t("vanTrips.settleTheTrip"),
                    onSelect: () => {
                      setSelectedId(trip.id);
                      openSettleForm();
                    },
                  },
                ]
              : []),
          ];
          return <RowMenu items={menuItems} label={t("vanTrips.row.actionsFor", { trip: trip.tripNo ?? trip.id })} />;
        }}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("vanTrips.trip")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("vanTrips.noMatchingTrips")}
            description={t("vanTrips.emptyBody")}
            action={{ label: t("vanTrips.openATrip"), onClick: openCreateForm }}
          />
        }
      />

      {/* -------- Trip detail panel -------- */}
      <SidePanel
        open={selected !== null}
        onClose={() => {
          setSelectedId(null);
          setSettleOpen(false);
        }}
        title={selected ? t("vanTrips.panelTitle", { number: selected.tripNo ?? selected.id }) : ""}
      >
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            </div>

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.van")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{warehouseName(selected.vanWarehouseId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.branch")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId)}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.openedOn")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.openedAt.slice(0, 10)}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.settledOn")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.settledAt ? selected.settledAt.slice(0, 10) : "—"}</div>
              </div>
              <div className="border-e border-t border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.openingCash")}</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={toMajor(selected.openingCashFloat)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-t border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.vanTill")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{treasuryName(selected.vanTreasuryAccountId)}</div>
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">{t("vanTrips.crew")}</div>
              <div className="flex flex-col gap-[6px]">
                {selected.crew.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-[13px] text-ink">
                    <span>{employeeName(c.employeeId)}</span>
                    <StatusPill label={t(ROLE_KEY[c.role])} tone="neutral" />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">{t("vanTrips.vanStock")}</div>
              {selected.loadedStock.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">{t("vanTrips.noStockHasBeenLoaded")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-start text-ink-faint">
                        <th className="p-[6px] text-start">{t("common.item")}</th>
                        <th className="p-[6px] text-start">{t("common.qty")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.loadedStock.map((line, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="p-[6px] text-ink">{itemName(line.itemId)}</td>
                          <td className="mz-num p-[6px] text-ink">{toMajor(line.qty)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">{t("vanTrips.cashMovements")}</div>
              {selected.cashMovements.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">{t("vanTrips.noCashMovementsYet")}</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="text-start text-ink-faint">
                        <th className="p-[6px] text-start">{t("common.type")}</th>
                        <th className="p-[6px] text-start">{t("common.amount")}</th>
                        <th className="p-[6px] text-start">{t("common.date")}</th>
                        <th className="p-[6px] text-start">{t("common.notes")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.cashMovements.map((m) => (
                        <tr key={m.id} className="border-t border-border">
                          <td className="p-[6px] text-ink">{t(KIND_KEY[m.kind])}</td>
                          <td className="p-[6px]">
                            <MoneyDisplay value={toMajor(m.amount)} />
                          </td>
                          <td className="mz-num p-[6px] text-ink-muted">{m.occurredAt.slice(0, 10)}</td>
                          <td className="p-[6px] text-ink-muted">{m.notes ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {selected.status === VanTripStatusDTO.Ongoing ? (
              <Card className="p-[13px_15px]">
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("vanTrips.recordACashMovement")}</h3>
                {movementError ? (
                  <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                    {movementError}
                  </div>
                ) : null}
                <form onSubmit={handleRecordMovement} className="flex flex-col gap-[10px]">
                  <SelectField label={t("common.type")} value={movementKind} onChange={(v) => setMovementKind(v as VanTripCashMovementKindDTO)} options={KIND_VALUES.map((value) => ({ value, label: t(KIND_KEY[value]) }))} />
                  <div>
                    <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("common.amount")}</div>
                    <MoneyInput value={movementAmount} onChange={setMovementAmount} aria-label={t("common.amount")} />
                  </div>
                  <TextField label={t("common.notes")} value={movementNotes} onChange={setMovementNotes} />
                  <Button type="submit" variant="primary" disabled={recordCashMovement.isPending}>
                    {t("vanTrips.recordTheMovement")}
                  </Button>
                </form>
              </Card>
            ) : null}

            {countable(selected) && !settleOpen ? (
              <Button variant="primary" onClick={openSettleForm}>
                {selected.status === VanTripStatusDTO.AwaitingApproval ? t("vanRecon.recount") : t("vanTrips.settleTheTrip")}
              </Button>
            ) : null}

            {countable(selected) && settleOpen ? (
              <VanTripCountForm
                key={selected.id}
                trip={selected}
                itemName={itemName}
                pending={settleVanTrip.isPending}
                onCancel={() => setSettleOpen(false)}
                onSubmit={async (body) => {
                  await settleVanTrip.mutateAsync({ id: selected.id, body });
                  setSettleOpen(false);
                }}
              />
            ) : null}

            {selected.settlement && !settleOpen ? (
              <VanTripReconciliationCard
                trip={selected}
                itemName={itemName}
                userName={userLabel}
                mayApprove={mayApprove}
                currentUserId={currentUserId}
              />
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Open trip form -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("vanTrips.openATrip")} description={t("vanTrips.vanTripOpeningDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("vanTrips.date")} value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />

          {/* The cascade (R3.13): the van decides its warehouse, its till and
              its branch, so those three are read-only and stay empty until a
              van is chosen. Nothing here can pair van A's stock with van B's
              cash — the registry says which goes with which, and the server
              resolves the same pair when the trip is opened. */}
          <SelectField
            label={t("vanTrips.van2")}
            value={draft.vanId}
            onChange={(v) => setDraft((d) => ({ ...d, vanId: v }))}
            options={[
              { value: "", label: t("vanTrips.chooseAVan") },
              ...vans.map((van) => ({ value: van.id, label: van.plateNumber ? `${van.nameAr} — ${van.plateNumber}` : van.nameAr })),
            ]}
            hint={t("vanTrips.vanCascadeHint")}
          />

          <div className="grid grid-cols-1 gap-[10px] sm:grid-cols-3">
            <CascadedValue label={t("vanTrips.vanWarehouse")} value={selectedVan ? warehouseName(selectedVan.warehouseId) : null} />
            <CascadedValue label={t("vanTrips.vanTill2")} value={selectedVan ? treasuryName(selectedVan.treasuryAccountId) : null} />
            <CascadedValue label={t("vanTrips.branch")} value={selectedVan ? branchName(selectedVan.branchId) : null} />
          </div>

          <SelectField
            label={t("vanTrips.loadingWarehouse")}
            value={draft.sourceWarehouseId}
            onChange={(v) => setDraft((d) => ({ ...d, sourceWarehouseId: v }))}
            disabled={selectedVan === null}
            options={[
              { value: "", label: t("vanTrips.chooseALoadingWarehouse") },
              ...warehouses.filter((w) => w.id !== selectedVan?.warehouseId).map((w) => ({ value: w.id, label: w.name })),
            ]}
          />
          <SelectField
            label={t("vanTrips.sourceTill")}
            value={draft.sourceTreasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, sourceTreasuryAccountId: v }))}
            disabled={selectedVan === null}
            options={[
              { value: "", label: t("vanTrips.chooseTheSourceTill") },
              ...treasuryAccounts.filter((acc) => acc.id !== selectedVan?.treasuryAccountId).map((acc) => ({ value: acc.id, label: nameOf(acc) })),
            ]}
          />

          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("vanTrips.openingCash")}</div>
            <MoneyInput
              value={draft.openingCashFloat}
              onChange={(v) => setDraft((d) => ({ ...d, openingCashFloat: v }))}
              aria-label={t("vanTrips.openingCash")}
            />
            <div className="mt-[6px] text-[11.5px] text-ink-faint">
              {t("vanTrips.theCashFloatTheRep")}
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("vanTrips.crew2")}</h3>
            <div className="flex flex-col gap-[6px]">
              {draft.crew.map((c, i) => (
                // Keyed by the employee, not the index: the row is removable
                // from the middle of the list, and the picker above already
                // filters out anyone already on the crew, so this is unique.
                <div key={c.employeeId} className="flex items-center justify-between rounded-md border border-border px-[10px] py-[7px] text-[12.5px]">
                  <span className="text-ink">
                    {employeeName(c.employeeId)} — {t(ROLE_KEY[c.role])}
                  </span>
                  <button type="button" onClick={() => removeCrewRow(i)} aria-label={t("vanTrips.remove")} className="text-ink-faint hover:text-danger-ink">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-[10px] flex flex-wrap items-end gap-[8px]">
              {/* A crew member is an EMPLOYEE, so this picks one over the real
                  employee endpoint. It was a text field taking a typed id, so a
                  trip could name a driver who does not work here. */}
              <div className="flex-1">
                <SelectField
                  label={t("vanTrips.chooseAnEmployee")}
                  value={crewEmployeeId}
                  onChange={setCrewEmployeeId}
                  options={[
                    { value: "", label: t("vanTrips.chooseAnEmployee2") },
                    ...employees
                      .filter((e) => !draft.crew.some((c) => c.employeeId === e.id))
                      .map((e) => ({ value: e.id, label: `${employeeDisplayName(e, locale)} (${e.code})` })),
                  ]}
                />
              </div>
              <div className="w-[130px]">
                <SelectField label={t("vanTrips.role")} value={crewRole} onChange={(v) => setCrewRole(v as VanTripCrewRoleDTO)} options={ROLE_VALUES.map((value) => ({ value, label: t(ROLE_KEY[value]) }))} />
              </div>
              <Button type="button" disabled={crewEmployeeId === ""} onClick={addCrewRow}>
                {t("common.add")}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("vanTrips.loadStockOptional")}</h3>
            <div className="flex flex-col gap-[6px]">
              {draft.loadedStock.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border px-[10px] py-[7px] text-[12.5px]">
                  <span className="text-ink">
                    {itemName(s.itemId)} — <span className="mz-num">{s.qty}</span>
                  </span>
                  <button type="button" onClick={() => removeStockRow(i)} aria-label={t("vanTrips.remove")} className="text-ink-faint hover:text-danger-ink">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-[10px] flex flex-wrap items-end gap-[8px]">
              <div className="flex-1">
                <ItemPicker
                  label={t("vanTrips.chooseAnItem")}
                  placeholder={t("vanTrips.chooseAnItem2")}
                  value={stockItem}
                  onChange={(item) => {
                    if (item) setPickedNames((names) => new Map(names).set(item.id, item.nameAr));
                    setStockItem(item ? itemOption(item) : null);
                  }}
                />
              </div>
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("common.qty")}</div>
                <QtyInput value={stockQty} onChange={setStockQty} min={1} aria-label={t("common.qty")} />
              </div>
              <Button type="button" disabled={!stockItem} onClick={addStockRow}>
                {t("common.add")}
              </Button>
            </div>
          </div>

          <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={openVanTrip.isPending}>
              {t("vanTrips.openATrip")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

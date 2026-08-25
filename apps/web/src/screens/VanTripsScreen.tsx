import { useMemo, useState, type FormEvent } from "react";
import {
  DocumentList,
  Money as MoneyDisplay,
  StatusPill,
  VarianceBeam,
  Chip,
  Card,
  Button,
  SidePanel,
  MoneyInput,
  QtyInput,
  type DocumentListColumn,
  type PillTone,
} from "@mezan/ui";
import type { VanTripCrewRoleDTO, VanTripDTO, VanTripCashMovementKindDTO, VanTripStatusDTO } from "@mezan/contracts";
import {
  ApiError,
  useBranches,
  useItems,
  useOpenVanTrip,
  useRecordVanCashMovement,
  useSettleVanTrip,
  useTreasuryAccounts,
  useVanTrips,
  useWarehouses,
} from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** رحلات المندوبين (Van/Rep Trips — Field Sales) — docs/catalog/07 §"رحلات المندوبين". List + open-trip form + detail with cash-movement/settle actions. */

const STATUS_KEY: Record<VanTripStatusDTO, AppTranslationKey> = { ongoing: "vanTrips.statusOngoing", settled: "vanTrips.statusSettled", cancelled: "vanTrips.statusCancelled" };
const STATUS_TONE: Record<VanTripStatusDTO, PillTone> = { ongoing: "info", settled: "success", cancelled: "neutral" };
const ROLE_KEY: Record<VanTripCrewRoleDTO, AppTranslationKey> = { driver: "vanTrips.roleDriver", rep: "vanTrips.roleRep", assistant: "vanTrips.roleAssistant" };
const ROLE_VALUES = Object.keys(ROLE_KEY) as VanTripCrewRoleDTO[];
const KIND_KEY: Record<VanTripCashMovementKindDTO, AppTranslationKey> = { sale: "vanTrips.kindSale", collection: "vanTrips.kindCollection" };
const KIND_VALUES = Object.keys(KIND_KEY) as VanTripCashMovementKindDTO[];

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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
  vanWarehouseId: string;
  sourceWarehouseId: string;
  vanTreasuryAccountId: string;
  sourceTreasuryAccountId: string;
  branchId: string;
  openingCashFloat: number | null;
  crew: CrewDraftRow[];
  loadedStock: StockDraftRow[];
  notes: string;
}

function blankDraft(): OpenTripDraft {
  return {
    date: today(),
    vanWarehouseId: "",
    sourceWarehouseId: "",
    vanTreasuryAccountId: "",
    sourceTreasuryAccountId: "",
    branchId: "",
    openingCashFloat: 0,
    crew: [],
    loadedStock: [],
    notes: "",
  };
}

function validateDraft(draft: OpenTripDraft): AppTranslationKey | null {
  if (draft.date.trim() === "") return "vanTrips.dateRequired";
  if (draft.vanWarehouseId === "") return "vanTrips.vanRequired";
  if (draft.sourceWarehouseId === "") return "vanTrips.sourceWarehouseRequired";
  if (draft.vanWarehouseId === draft.sourceWarehouseId) return "vanTrips.sourceWarehouseSameAsVan";
  if (draft.vanTreasuryAccountId === "") return "vanTrips.vanTillRequired";
  if (draft.sourceTreasuryAccountId === "") return "vanTrips.sourceTillRequired";
  if (draft.branchId === "") return "vanTrips.branchRequired";
  if (draft.crew.length === 0) return "vanTrips.crewRequired";
  return null;
}

export function VanTripsScreen() {
  const { t } = useAppTranslation();
  const query = useVanTrips();
  const warehousesQuery = useWarehouses();
  const treasuryQuery = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const itemsQuery = useItems();

  const openVanTrip = useOpenVanTrip();
  const recordCashMovement = useRecordVanCashMovement();
  const settleVanTrip = useSettleVanTrip();

  const trips = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const branches = branchesQuery.data ?? [];
  const items = itemsQuery.data ?? [];

  const vanWarehouses = useMemo(() => {
    const vans = warehouses.filter((w) => w.type === "VAN");
    return vans.length > 0 ? vans : warehouses;
  }, [warehouses]);

  const warehouseName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [w.id, w.name]));
    return (id: string) => map.get(id) ?? id;
  }, [warehouses]);
  const branchName = useMemo(() => {
    const map = new Map(branches.map((b) => [b.id, b.name]));
    return (id: string) => map.get(id) ?? id;
  }, [branches]);
  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | VanTripStatusDTO>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<OpenTripDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [crewEmployeeId, setCrewEmployeeId] = useState("");
  const [crewRole, setCrewRole] = useState<VanTripCrewRoleDTO>("driver");
  const [stockItemId, setStockItemId] = useState("");
  const [stockQty, setStockQty] = useState(1);

  const [movementKind, setMovementKind] = useState<VanTripCashMovementKindDTO>("sale");
  const [movementAmount, setMovementAmount] = useState<number | null>(null);
  const [movementNotes, setMovementNotes] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);

  const [settleOpen, setSettleOpen] = useState(false);
  const [settleCountedCash, setSettleCountedCash] = useState<number | null>(null);
  const [settleCounts, setSettleCounts] = useState<Record<string, number>>({});
  const [settleError, setSettleError] = useState<string | null>(null);

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
  const ongoingCount = trips.filter((trip) => trip.status === "ongoing").length;
  const settledCount = trips.filter((trip) => trip.status === "settled").length;

  const selected = selectedId ? (trips.find((trip) => trip.id === selectedId) ?? null) : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setCrewEmployeeId("");
    setCrewRole("driver");
    setStockItemId("");
    setStockQty(1);
    setFormOpen(true);
  }

  function addCrewRow() {
    if (crewEmployeeId.trim() === "") return;
    setDraft((d) => ({ ...d, crew: [...d.crew, { employeeId: crewEmployeeId.trim(), role: crewRole }] }));
    setCrewEmployeeId("");
    setCrewRole("driver");
  }

  function removeCrewRow(index: number) {
    setDraft((d) => ({ ...d, crew: d.crew.filter((_, i) => i !== index) }));
  }

  function addStockRow() {
    if (stockItemId === "") return;
    setDraft((d) => ({ ...d, loadedStock: [...d.loadedStock, { itemId: stockItemId, qty: stockQty }] }));
    setStockItemId("");
    setStockQty(1);
  }

  function removeStockRow(index: number) {
    setDraft((d) => ({ ...d, loadedStock: d.loadedStock.filter((_, i) => i !== index) }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft);
    if (error) {
      setFormError(t(error));
      return;
    }
    setFormError(null);
    try {
      await openVanTrip.mutateAsync({
        id: crypto.randomUUID(),
        date: draft.date.trim(),
        branchId: draft.branchId,
        vanWarehouseId: draft.vanWarehouseId,
        vanTreasuryAccountId: draft.vanTreasuryAccountId,
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

  function openSettleForm(trip: VanTripDTO) {
    const initialCounts: Record<string, number> = {};
    for (const line of trip.loadedStock) initialCounts[line.itemId] = toMajor(line.qty);
    setSettleCounts(initialCounts);
    setSettleCountedCash(0);
    setSettleError(null);
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

  async function handleSettle(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSettleError(null);
    try {
      await settleVanTrip.mutateAsync({
        id: selected.id,
        body: {
          countedCash: (settleCountedCash ?? 0).toFixed(6),
          stockCounts: selected.loadedStock.map((line) => ({
            itemId: line.itemId,
            countedQty: (settleCounts[line.itemId] ?? 0).toFixed(6),
          })),
        },
      });
      setSettleOpen(false);
    } catch (err) {
      setSettleError(err instanceof ApiError ? err.message : t("vanTrips.couldNotSettleTheTrip"));
    }
  }

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
    { key: "van", header: t("vanTrips.van"), render: (trip) => warehouseName(trip.vanWarehouseId) },
    { key: "branch", header: t("common.branch"), render: (trip) => branchName(trip.branchId) },
    { key: "sales", header: t("vanTrips.sales"), render: (trip) => <span className="mz-num">{trip.cashMovements.filter((m) => m.kind === "sale").length}</span> },
    { key: "status", header: t("common.status"), render: (trip) => <StatusPill label={t(STATUS_KEY[trip.status])} tone={STATUS_TONE[trip.status]} /> },
    {
      key: "cash",
      header: t("vanTrips.cashCollected"),
      render: (trip) => <MoneyDisplay value={trip.cashMovements.reduce((sum, m) => sum + toMajor(m.amount), 0)} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("vanTrips.couldNotLoadTheVan")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<VanTripDTO>
        eyebrow={t("eyebrow.fieldSales.vanTrips")}
        title={t("vanTrips.vanTrips")}
        description={t("vanTrips.openAVanTripWith")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("vanTrips.openATrip")}
          </Button>
        }
        stats={[
          { label: t("vanTrips.total"), value: <span className="mz-num">{totalCount}</span> },
          { label: t("vanTrips.open"), value: <span className="mz-num">{ongoingCount}</span> },
          { label: t("vanTrips.settled"), value: <span className="mz-num">{settledCount}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("vanTrips.searchByTripNo")}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {(
              [
                ["all", t("common.all")],
                ["ongoing", t("vanTrips.open")],
                ["settled", t("vanTrips.settled")],
                ["cancelled", t("vanTrips.cancelled")],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} active={statusFilter === value} onClick={() => setStatusFilter(value)}>
                {label}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(trip) => trip.id}
        onRowClick={(trip) => setSelectedId(trip.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("vanTrips.trip")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("vanTrips.noMatchingTrips")}</div>}
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
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.vanTreasuryAccountId}</div>
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">{t("vanTrips.crew")}</div>
              <div className="flex flex-col gap-[6px]">
                {selected.crew.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-[13px] text-ink">
                    <span>{c.employeeId}</span>
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
              )}
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">{t("vanTrips.cashMovements")}</div>
              {selected.cashMovements.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">{t("vanTrips.noCashMovementsYet")}</div>
              ) : (
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
              )}
            </Card>

            {selected.status === "ongoing" ? (
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

            {selected.status === "ongoing" && !settleOpen ? (
              <Button variant="primary" onClick={() => openSettleForm(selected)}>
                {t("vanTrips.settleTheTrip")}
              </Button>
            ) : null}

            {selected.status === "ongoing" && settleOpen ? (
              <Card className="p-[13px_15px]">
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("vanTrips.settleTheTrip")}</h3>
                {settleError ? (
                  <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                    {settleError}
                  </div>
                ) : null}
                <form onSubmit={handleSettle} className="flex flex-col gap-[12px]">
                  <div>
                    <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("vanTrips.cashCounted")}</div>
                    <MoneyInput value={settleCountedCash} onChange={setSettleCountedCash} aria-label={t("vanTrips.cashCounted")} />
                  </div>
                  {selected.loadedStock.length > 0 ? (
                    <div className="flex flex-col gap-[8px]">
                      <div className="text-[12.5px] font-semibold text-ink">{t("vanTrips.stockCount")}</div>
                      {selected.loadedStock.map((line) => (
                        <div key={line.itemId} className="flex items-center justify-between gap-[10px]">
                          <span className="text-[12.5px] text-ink">{itemName(line.itemId)}</span>
                          <QtyInput
                            aria-label={t("vanTrips.countedQtyLabel", { item: itemName(line.itemId) })}
                            value={settleCounts[line.itemId] ?? 0}
                            onChange={(v) => setSettleCounts((c) => ({ ...c, [line.itemId]: v }))}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-[9px]">
                    <Button type="button" onClick={() => setSettleOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button type="submit" variant="primary" disabled={settleVanTrip.isPending}>
                      {t("vanTrips.confirmTheSettlement")}
                    </Button>
                  </div>
                </form>
              </Card>
            ) : null}

            {selected.settlement ? (
              <Card className="p-[13px_15px]">
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("vanTrips.settlement")}</h3>
                <div className="grid grid-cols-3 gap-[10px]">
                  <div>
                    <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.expected")}</div>
                    <MoneyDisplay value={toMajor(selected.settlement.expectedCash)} className="mt-[4px] text-[13px] font-bold" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.counted")}</div>
                    <MoneyDisplay value={toMajor(selected.settlement.countedCash)} className="mt-[4px] text-[13px] font-bold" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-ink-faint">{t("vanTrips.difference")}</div>
                    <StatusPill
                      label={String(toMajor(selected.settlement.cashVariance))}
                      tone={
                        toMajor(selected.settlement.cashVariance) === 0
                          ? "neutral"
                          : toMajor(selected.settlement.cashVariance) > 0
                            ? "success"
                            : "danger"
                      }
                      className="mt-[4px]"
                    />
                  </div>
                </div>
                {selected.settlement.stockCounts.length > 0 ? (
                  <table className="mt-[12px] w-full text-[12.5px]">
                    <thead>
                      <tr className="text-start text-ink-faint">
                        <th className="p-[6px] text-start">{t("common.item")}</th>
                        <th className="p-[6px] text-start">{t("vanTrips.expected")}</th>
                        <th className="p-[6px] text-start">{t("vanTrips.counted")}</th>
                        <th className="p-[6px] text-start">{t("vanTrips.difference")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.settlement.stockCounts.map((line, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="p-[6px] text-ink">{itemName(line.itemId)}</td>
                          <td className="mz-num p-[6px] text-ink">{toMajor(line.expectedQty)}</td>
                          <td className="mz-num p-[6px] text-ink">{toMajor(line.countedQty)}</td>
                          <td className="p-[6px]">
                            <VarianceBeam value={toMajor(line.varianceQty)}>
                              <span className="mz-num">{toMajor(line.varianceQty)}</span>
                            </VarianceBeam>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </Card>
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

          <SelectField
            label={t("vanTrips.van2")}
            value={draft.vanWarehouseId}
            onChange={(v) => setDraft((d) => ({ ...d, vanWarehouseId: v }))}
            options={[{ value: "", label: t("vanTrips.chooseAVan") }, ...vanWarehouses.map((w) => ({ value: w.id, label: w.name }))]}
          />
          <SelectField
            label={t("vanTrips.loadingWarehouse")}
            value={draft.sourceWarehouseId}
            onChange={(v) => setDraft((d) => ({ ...d, sourceWarehouseId: v }))}
            options={[{ value: "", label: t("vanTrips.chooseALoadingWarehouse") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
          />
          <SelectField
            label={t("vanTrips.vanTill2")}
            value={draft.vanTreasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, vanTreasuryAccountId: v }))}
            options={[{ value: "", label: t("vanTrips.chooseTheVanTill") }, ...treasuryAccounts.map((acc) => ({ value: acc.id, label: acc.name }))]}
          />
          <SelectField
            label={t("vanTrips.sourceTill")}
            value={draft.sourceTreasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, sourceTreasuryAccountId: v }))}
            options={[{ value: "", label: t("vanTrips.chooseTheSourceTill") }, ...treasuryAccounts.map((acc) => ({ value: acc.id, label: acc.name }))]}
          />
          <SelectField
            label={t("vanTrips.branch")}
            value={draft.branchId}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
            options={[{ value: "", label: t("vanTrips.chooseABranch") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
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
                <div key={i} className="flex items-center justify-between rounded-md border border-border px-[10px] py-[7px] text-[12.5px]">
                  <span className="text-ink">
                    {c.employeeId} — {t(ROLE_KEY[c.role])}
                  </span>
                  <button type="button" onClick={() => removeCrewRow(i)} aria-label={t("vanTrips.remove")} className="text-ink-faint hover:text-danger-ink">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-[10px] flex flex-wrap items-end gap-[8px]">
              <div className="flex-1">
                <TextField label={t("vanTrips.chooseAnEmployee")} value={crewEmployeeId} onChange={setCrewEmployeeId} placeholder={t("vanTrips.employeeId")} />
              </div>
              <div className="w-[130px]">
                <SelectField label={t("vanTrips.role")} value={crewRole} onChange={(v) => setCrewRole(v as VanTripCrewRoleDTO)} options={ROLE_VALUES.map((value) => ({ value, label: t(ROLE_KEY[value]) }))} />
              </div>
              <Button type="button" disabled={crewEmployeeId.trim() === ""} onClick={addCrewRow}>
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
                <SelectField
                  label={t("vanTrips.chooseAnItem")}
                  value={stockItemId}
                  onChange={setStockItemId}
                  options={[{ value: "", label: t("vanTrips.chooseAnItem2") }, ...items.map((i) => ({ value: i.id, label: i.nameAr }))]}
                />
              </div>
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("common.qty")}</div>
                <QtyInput value={stockQty} onChange={setStockQty} min={1} aria-label={t("common.qty")} />
              </div>
              <Button type="button" disabled={stockItemId === ""} onClick={addStockRow}>
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

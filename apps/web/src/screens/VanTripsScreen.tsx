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

/** رحلات المندوبين (Van/Rep Trips — Field Sales) — docs/catalog/07 §"رحلات المندوبين". List + open-trip form + detail with cash-movement/settle actions. */

const STATUS_LABEL: Record<VanTripStatusDTO, string> = { ongoing: "جارية", settled: "مسواة", cancelled: "ملغاة" };
const STATUS_TONE: Record<VanTripStatusDTO, PillTone> = { ongoing: "info", settled: "success", cancelled: "neutral" };
const ROLE_LABEL: Record<VanTripCrewRoleDTO, string> = { driver: "سائق", rep: "مندوب", assistant: "مساعد" };
const ROLE_OPTIONS = (Object.keys(ROLE_LABEL) as VanTripCrewRoleDTO[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
const KIND_LABEL: Record<VanTripCashMovementKindDTO, string> = { sale: "بيع", collection: "تحصيل" };
const KIND_OPTIONS = (Object.keys(KIND_LABEL) as VanTripCashMovementKindDTO[]).map((k) => ({ value: k, label: KIND_LABEL[k] }));

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

function validateDraft(draft: OpenTripDraft): string | null {
  if (draft.date.trim() === "") return "التاريخ مطلوب.";
  if (draft.vanWarehouseId === "") return "الڤان مطلوب.";
  if (draft.sourceWarehouseId === "") return "مخزن التحميل مطلوب.";
  if (draft.vanWarehouseId === draft.sourceWarehouseId) return "لا يمكن أن يكون مخزن التحميل هو نفس الڤان.";
  if (draft.vanTreasuryAccountId === "") return "خزينة الڤان مطلوبة.";
  if (draft.sourceTreasuryAccountId === "") return "خزينة المصدر مطلوبة.";
  if (draft.branchId === "") return "الفرع مطلوب.";
  if (draft.crew.length === 0) return "لا بد من إضافة عضو واحد على الأقل للطاقم.";
  return null;
}

export function VanTripsScreen() {
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
    if (statusFilter !== "all") rows = rows.filter((t) => t.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((t) => (t.tripNo ?? t.id).toLowerCase().includes(q));
    }
    return rows;
  }, [trips, statusFilter, search]);

  const totalCount = trips.length;
  const ongoingCount = trips.filter((t) => t.status === "ongoing").length;
  const settledCount = trips.filter((t) => t.status === "settled").length;

  const selected = selectedId ? (trips.find((t) => t.id === selectedId) ?? null) : null;

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
      setFormError(error);
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
      setFormError(err instanceof ApiError ? err.message : "تعذّر فتح الرحلة.");
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
      setMovementError("المبلغ يجب أن يكون أكبر من صفر.");
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
      setMovementError(err instanceof ApiError ? err.message : "تعذّر تسجيل الحركة النقدية.");
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
      setSettleError(err instanceof ApiError ? err.message : "تعذّر تسوية الرحلة.");
    }
  }

  const columns: DocumentListColumn<VanTripDTO>[] = [
    {
      key: "tripNo",
      header: "رقم الرحلة",
      render: (t) => (
        <div>
          <div className="mz-num font-semibold text-ink">{t.tripNo ?? t.id}</div>
          <div className="mz-num mt-[2px] text-[11px] text-ink-faint">{t.date}</div>
        </div>
      ),
    },
    { key: "van", header: "الڤان", render: (t) => warehouseName(t.vanWarehouseId) },
    { key: "branch", header: "الفرع", render: (t) => branchName(t.branchId) },
    { key: "sales", header: "المبيعات", render: (t) => <span className="mz-num">{t.cashMovements.filter((m) => m.kind === "sale").length}</span> },
    { key: "status", header: "الحالة", render: (t) => <StatusPill label={STATUS_LABEL[t.status]} tone={STATUS_TONE[t.status]} /> },
    {
      key: "cash",
      header: "النقدية المحصلة",
      render: (t) => <MoneyDisplay value={t.cashMovements.reduce((sum, m) => sum + toMajor(m.amount), 0)} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل رحلات المندوبين.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<VanTripDTO>
        eyebrow="Field Sales · Van Trips"
        title="رحلات المندوبين"
        description="فتح رحلة الڤان بطاقم ومخزون وعُهدة نقدية، ثم تسوية النقدية والمخزون عند العودة"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            فتح رحلة
          </Button>
        }
        stats={[
          { label: "الإجمالي", value: <span className="mz-num">{totalCount}</span> },
          { label: "جارية", value: <span className="mz-num">{ongoingCount}</span> },
          { label: "مسواة", value: <span className="mz-num">{settledCount}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم الرحلة..."
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {(
              [
                ["all", "الكل"],
                ["ongoing", "جارية"],
                ["settled", "مسواة"],
                ["cancelled", "ملغاة"],
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
        rowKey={(t) => t.id}
        onRowClick={(t) => setSelectedId(t.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{totalCount}</span> رحلة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد رحلات مطابقة</div>}
      />

      {/* -------- Trip detail panel -------- */}
      <SidePanel
        open={selected !== null}
        onClose={() => {
          setSelectedId(null);
          setSettleOpen(false);
        }}
        title={selected ? `رحلة ${selected.tripNo ?? selected.id}` : ""}
      >
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            </div>

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الڤان</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{warehouseName(selected.vanWarehouseId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الفرع</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{branchName(selected.branchId)}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ الفتح</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.openedAt.slice(0, 10)}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ التسوية</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.settledAt ? selected.settledAt.slice(0, 10) : "—"}</div>
              </div>
              <div className="border-e border-t border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">النقدية الافتتاحية</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={toMajor(selected.openingCashFloat)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-t border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">خزينة الڤان</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.vanTreasuryAccountId}</div>
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">الطاقم</div>
              <div className="flex flex-col gap-[6px]">
                {selected.crew.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-[13px] text-ink">
                    <span>{c.employeeId}</span>
                    <StatusPill label={ROLE_LABEL[c.role]} tone="neutral" />
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-[13px_15px]">
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">مخزون الڤان</div>
              {selected.loadedStock.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">لا يوجد مخزون محمّل.</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-start text-ink-faint">
                      <th className="p-[6px] text-start">الصنف</th>
                      <th className="p-[6px] text-start">الكمية</th>
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
              <div className="mb-[8px] text-[11px] font-semibold text-ink-faint">الحركات النقدية</div>
              {selected.cashMovements.length === 0 ? (
                <div className="text-[12.5px] text-ink-muted">لا توجد حركات نقدية بعد.</div>
              ) : (
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-start text-ink-faint">
                      <th className="p-[6px] text-start">النوع</th>
                      <th className="p-[6px] text-start">المبلغ</th>
                      <th className="p-[6px] text-start">التاريخ</th>
                      <th className="p-[6px] text-start">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.cashMovements.map((m) => (
                      <tr key={m.id} className="border-t border-border">
                        <td className="p-[6px] text-ink">{KIND_LABEL[m.kind]}</td>
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
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">تسجيل حركة نقدية</h3>
                {movementError ? (
                  <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                    {movementError}
                  </div>
                ) : null}
                <form onSubmit={handleRecordMovement} className="flex flex-col gap-[10px]">
                  <SelectField label="النوع" value={movementKind} onChange={(v) => setMovementKind(v as VanTripCashMovementKindDTO)} options={KIND_OPTIONS} />
                  <div>
                    <div className="mb-[6px] text-[12.5px] font-semibold text-ink">المبلغ</div>
                    <MoneyInput value={movementAmount} onChange={setMovementAmount} aria-label="المبلغ" />
                  </div>
                  <TextField label="ملاحظات" value={movementNotes} onChange={setMovementNotes} />
                  <Button type="submit" variant="primary" disabled={recordCashMovement.isPending}>
                    تسجيل الحركة
                  </Button>
                </form>
              </Card>
            ) : null}

            {selected.status === "ongoing" && !settleOpen ? (
              <Button variant="primary" onClick={() => openSettleForm(selected)}>
                تسوية الرحلة
              </Button>
            ) : null}

            {selected.status === "ongoing" && settleOpen ? (
              <Card className="p-[13px_15px]">
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">تسوية الرحلة</h3>
                {settleError ? (
                  <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                    {settleError}
                  </div>
                ) : null}
                <form onSubmit={handleSettle} className="flex flex-col gap-[12px]">
                  <div>
                    <div className="mb-[6px] text-[12.5px] font-semibold text-ink">النقدية المعدودة *</div>
                    <MoneyInput value={settleCountedCash} onChange={setSettleCountedCash} aria-label="النقدية المعدودة *" />
                  </div>
                  {selected.loadedStock.length > 0 ? (
                    <div className="flex flex-col gap-[8px]">
                      <div className="text-[12.5px] font-semibold text-ink">جرد المخزون</div>
                      {selected.loadedStock.map((line) => (
                        <div key={line.itemId} className="flex items-center justify-between gap-[10px]">
                          <span className="text-[12.5px] text-ink">{itemName(line.itemId)}</span>
                          <QtyInput
                            aria-label={`الكمية المعدودة — ${itemName(line.itemId)}`}
                            value={settleCounts[line.itemId] ?? 0}
                            onChange={(v) => setSettleCounts((c) => ({ ...c, [line.itemId]: v }))}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex justify-end gap-[9px]">
                    <Button type="button" onClick={() => setSettleOpen(false)}>
                      إلغاء
                    </Button>
                    <Button type="submit" variant="primary" disabled={settleVanTrip.isPending}>
                      تأكيد التسوية
                    </Button>
                  </div>
                </form>
              </Card>
            ) : null}

            {selected.settlement ? (
              <Card className="p-[13px_15px]">
                <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">التسوية</h3>
                <div className="grid grid-cols-3 gap-[10px]">
                  <div>
                    <div className="text-[11px] font-semibold text-ink-faint">المتوقع</div>
                    <MoneyDisplay value={toMajor(selected.settlement.expectedCash)} className="mt-[4px] text-[13px] font-bold" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-ink-faint">المعدود</div>
                    <MoneyDisplay value={toMajor(selected.settlement.countedCash)} className="mt-[4px] text-[13px] font-bold" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-ink-faint">الفرق</div>
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
                        <th className="p-[6px] text-start">الصنف</th>
                        <th className="p-[6px] text-start">المتوقع</th>
                        <th className="p-[6px] text-start">المعدود</th>
                        <th className="p-[6px] text-start">الفرق</th>
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
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="فتح رحلة" description="بيانات فتح رحلة الڤان">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label="التاريخ *" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />

          <SelectField
            label="الڤان *"
            value={draft.vanWarehouseId}
            onChange={(v) => setDraft((d) => ({ ...d, vanWarehouseId: v }))}
            options={[{ value: "", label: "اختر الڤان..." }, ...vanWarehouses.map((w) => ({ value: w.id, label: w.name }))]}
          />
          <SelectField
            label="مخزن التحميل *"
            value={draft.sourceWarehouseId}
            onChange={(v) => setDraft((d) => ({ ...d, sourceWarehouseId: v }))}
            options={[{ value: "", label: "اختر مخزن التحميل..." }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
          />
          <SelectField
            label="خزينة الڤان *"
            value={draft.vanTreasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, vanTreasuryAccountId: v }))}
            options={[{ value: "", label: "اختر خزينة الڤان..." }, ...treasuryAccounts.map((t) => ({ value: t.id, label: t.name }))]}
          />
          <SelectField
            label="خزينة المصدر *"
            value={draft.sourceTreasuryAccountId}
            onChange={(v) => setDraft((d) => ({ ...d, sourceTreasuryAccountId: v }))}
            options={[{ value: "", label: "اختر خزينة المصدر..." }, ...treasuryAccounts.map((t) => ({ value: t.id, label: t.name }))]}
          />
          <SelectField
            label="الفرع *"
            value={draft.branchId}
            onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
            options={[{ value: "", label: "اختر الفرع..." }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />

          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">النقدية الافتتاحية</div>
            <MoneyInput
              value={draft.openingCashFloat}
              onChange={(v) => setDraft((d) => ({ ...d, openingCashFloat: v }))}
              aria-label="النقدية الافتتاحية"
            />
            <div className="mt-[6px] text-[11.5px] text-ink-faint">
              العهدة النقدية التي يأخذها المندوب — تُحوَّل فعلياً من الخزينة المصدر لخزينة الڤان.
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">الطاقم *</h3>
            <div className="flex flex-col gap-[6px]">
              {draft.crew.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border px-[10px] py-[7px] text-[12.5px]">
                  <span className="text-ink">
                    {c.employeeId} — {ROLE_LABEL[c.role]}
                  </span>
                  <button type="button" onClick={() => removeCrewRow(i)} aria-label="إزالة" className="text-ink-faint hover:text-danger-ink">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-[10px] flex flex-wrap items-end gap-[8px]">
              <div className="flex-1">
                <TextField label="اختر موظفاً" value={crewEmployeeId} onChange={setCrewEmployeeId} placeholder="معرّف الموظف" />
              </div>
              <div className="w-[130px]">
                <SelectField label="الدور" value={crewRole} onChange={(v) => setCrewRole(v as VanTripCrewRoleDTO)} options={ROLE_OPTIONS} />
              </div>
              <Button type="button" disabled={crewEmployeeId.trim() === ""} onClick={addCrewRow}>
                إضافة
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">تحميل مخزون (اختياري)</h3>
            <div className="flex flex-col gap-[6px]">
              {draft.loadedStock.map((s, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-border px-[10px] py-[7px] text-[12.5px]">
                  <span className="text-ink">
                    {itemName(s.itemId)} — <span className="mz-num">{s.qty}</span>
                  </span>
                  <button type="button" onClick={() => removeStockRow(i)} aria-label="إزالة" className="text-ink-faint hover:text-danger-ink">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-[10px] flex flex-wrap items-end gap-[8px]">
              <div className="flex-1">
                <SelectField
                  label="اختر صنفاً"
                  value={stockItemId}
                  onChange={setStockItemId}
                  options={[{ value: "", label: "اختر صنفاً..." }, ...items.map((i) => ({ value: i.id, label: i.nameAr }))]}
                />
              </div>
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">الكمية</div>
                <QtyInput value={stockQty} onChange={setStockQty} min={1} aria-label="الكمية" />
              </div>
              <Button type="button" disabled={stockItemId === ""} onClick={addStockRow}>
                إضافة
              </Button>
            </div>
          </div>

          <TextField label="ملاحظات" value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary" disabled={openVanTrip.isPending}>
              فتح رحلة
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

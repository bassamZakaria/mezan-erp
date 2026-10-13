import { useEffect, useMemo, useState } from "react";
import { HeldDocumentReapproval } from "../shell/ReapprovalNotice";
import { errorMessage } from "../lib/error-message";
import {
  RowActionOutcome,
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
  ConfirmDialog,
} from "@mezan/ui";
import { Money, Qty, distributeLandedCost, landedCostTotalsByType, type AllocatedLandedCostLine } from "@mezan/domain";
import type {
  CostCategoryDTO,
  DocumentStatusDTO,
  LandedCostDistributionMethodDTO,
  LandedCostItemEntryDTO,
  LandedCostTargetDTO,
  LandedCostTypeDTO,
} from "@mezan/contracts";
import { SelectField, NumberField, TextField } from "../settings/form-controls";
import {
  useCancelLandedCost,
  useReverseLandedCost,
  useConfirmLandedCost,
  useCreateLandedCost,
  useItems,
  useLandedCosts,
  useProjects,
  usePurchaseInvoices,
  useWarehouses,
} from "../data/hooks";
import { DOC_STATUS_TONE, documentStatusLabel } from "../doc-status";
import { useScreenIntent } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { sumMajor } from "../lib/money";
import { todayIso } from "../lib/dates";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";
import { ResubmitErrorNotice, ResubmitFamily, ResubmitForApprovalAction, resubmitRowMenuItems, useResubmitForApproval } from "./ResubmitForApprovalAction";

/** التكاليف الإضافية (Landed Costs) — docs/archive/catalog/02. Distributes freight/customs/etc across a confirmed purchase invoice's item costs, by value or by quantity. */

const COST_TYPE_KEY: Record<LandedCostTypeDTO, AppTranslationKey> = {
  SHIPPING: "landedCosts.type.SHIPPING",
  CUSTOMS: "landedCosts.type.CUSTOMS",
  INSURANCE: "landedCosts.type.INSURANCE",
  CLEARANCE: "landedCosts.type.CLEARANCE",
  OTHER: "landedCosts.type.OTHER",
};

const METHOD_KEY: Record<LandedCostDistributionMethodDTO, AppTranslationKey> = {
  BY_VALUE: "landedCosts.method.BY_VALUE",
  BY_QUANTITY: "landedCosts.method.BY_QUANTITY",
  BY_WEIGHT: "landedCosts.method.BY_WEIGHT",
};

/** What each basis actually divides the cost by — the difference is the whole point of the field. */
const METHOD_HINT_KEY: Record<LandedCostDistributionMethodDTO, AppTranslationKey> = {
  BY_VALUE: "landedCosts.methodHint.BY_VALUE",
  BY_QUANTITY: "landedCosts.methodHint.BY_QUANTITY",
  BY_WEIGHT: "landedCosts.methodHint.BY_WEIGHT",
};


const num = (v: string) => Number(v);

const COST_CATEGORY_VALUES = ["materials", "labour", "equipment", "subcontract", "indirect"] as const satisfies readonly CostCategoryDTO[];
const COST_CATEGORY_KEY: Record<CostCategoryDTO, AppTranslationKey> = {
  materials: "costCategory.materials",
  labour: "costCategory.labour",
  equipment: "costCategory.equipment",
  subcontract: "costCategory.subcontract",
  indirect: "costCategory.indirect",
};

interface CostItemDraft {
  key: string;
  costType: LandedCostTypeDTO;
  description: string;
  amount: number;
}
interface TargetDraft {
  key: string;
  itemId: string;
  qty: number;
  unitCost: number;
  weight: number;
  costCategory: CostCategoryDTO | null;
}
let seq = 0;
function blankCostItem(): CostItemDraft {
  seq += 1;
  return { key: `c${seq}`, costType: "SHIPPING", description: "", amount: 0 };
}
function blankTarget(itemId: string, qty: number, unitCost: number): TargetDraft {
  seq += 1;
  return { key: `t${seq}`, itemId, qty, unitCost, weight: 0, costCategory: null };
}

export function LandedCostsScreen() {
  const { t } = useAppTranslation();
  const query = useLandedCosts();
  const invoicesQuery = usePurchaseInvoices();
  const warehousesQuery = useWarehouses();
  const itemsQuery = useItems();
  const projectsQuery = useProjects();
  const createLandedCost = useCreateLandedCost();
  const confirmLandedCost = useConfirmLandedCost();
  const resubmit = useResubmitForApproval(ResubmitFamily.LandedCosts);
  const cancelLandedCost = useCancelLandedCost();
  const reverseLandedCost = useReverseLandedCost();

  const documents = query.data ?? EMPTY;
  const invoices = (invoicesQuery.data ?? []).filter((i) => i.status === "confirmed");
  const warehouses = warehousesQuery.data ?? EMPTY;
  const items = itemsQuery.data ?? EMPTY;
  const projects = projectsQuery.data ?? EMPTY;

  const itemName = useMemo(() => {
    const map = new Map(items.map((i) => [i.id, i.nameAr]));
    return (id: string) => map.get(id) ?? id;
  }, [items]);
  const projectName = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p.nameAr]));
    return (id: string | null) => (id ? (map.get(id) ?? id) : t("common.noProject"));
  }, [projects, t]);
  /** Only a live project can absorb new cost — a project already closed or cancelled stays out of the picker (D-01). */
  const projectOptions: EntityPickerOption[] = useMemo(
    () =>
      projects
        .filter((p) => p.status === "planned" || p.status === "active" || p.status === "on_hold")
        .map((p) => ({ id: p.id, label: p.nameAr, sublabel: p.code })),
    [projects],
  );

  const [panel, setPanel] = useState<"none" | "create" | { id: string }>("none");
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | DocumentStatusDTO,
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [warehouseFilter, setWarehouseFilter] = useUrlParam("warehouse");
  const [methodFilter, setMethodFilter] = useState("");
  const [costTypeFilter, setCostTypeFilter] = useState("");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [fromDate, setFromDate] = useUrlParam("from");
  const [toDate, setToDate] = useUrlParam("to");
  const [warehouseId, setWarehouseId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [method, setMethod] = useState<LandedCostDistributionMethodDTO>("BY_VALUE");
  const [costItems, setCostItems] = useState<CostItemDraft[]>([]);
  const [targets, setTargets] = useState<TargetDraft[]>([]);
  const [project, setProject] = useState<EntityPickerOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Clearing the header project also clears every target's category — a category without a project is meaningless (D-01). */
  function changeProject(opt: EntityPickerOption | null) {
    setProject(opt);
    if (!opt) setTargets((prev) => prev.map((target) => ({ ...target, costCategory: null })));
  }

  // Defaults the create form's invoice/warehouse pickers once their queries resolve —
  // `openCreate` alone can't do this if the panel is opened before `invoices`/`warehouses` load.
  useEffect(() => {
    if (panel !== "create" || invoiceId !== "") return;
    const firstInvoice = invoices[0];
    if (!firstInvoice) return;
    setInvoiceId(firstInvoice.id);
    const firstLine = firstInvoice.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
  }, [panel, invoices, invoiceId]);

  useEffect(() => {
    if (panel !== "create" || warehouseId !== "") return;
    const firstWarehouse = warehouses[0];
    if (firstWarehouse) setWarehouseId(firstWarehouse.id);
  }, [panel, warehouses, warehouseId]);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId) ?? null;
  const invoiceStockLines = useMemo(
    () => (selectedInvoice?.lines ?? []).filter((l) => l.kind === "inventory" && l.itemId !== null),
    [selectedInvoice],
  );

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, confirmed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      if (d.status === "confirmed") c.confirmed += 1;
    }
    return c;
  }, [documents]);

  const filtered = useMemo(() => {
    let rows = statusFilter === "all" ? documents : documents.filter((d) => d.status === statusFilter);
    if (warehouseFilter) rows = rows.filter((d) => d.lines.some((l) => l.warehouseId === warehouseFilter));
    if (methodFilter) rows = rows.filter((d) => (d.lines[0]?.distributionMethod ?? "BY_VALUE") === methodFilter);
    if (costTypeFilter) rows = rows.filter((d) => d.lines.some((l) => l.costItems.some((ci) => ci.costType === costTypeFilter)));
    if (fromDate) rows = rows.filter((d) => d.date >= fromDate);
    if (toDate) rows = rows.filter((d) => d.date <= toDate);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((d) => (d.docNo ?? "").toLowerCase().includes(q) || d.lines.some((l) => (l.sourceInvoiceNumber ?? "").toLowerCase().includes(q)));
    }
    return rows;
  }, [documents, statusFilter, warehouseFilter, methodFilter, costTypeFilter, fromDate, toDate, search]);

  /** Only the filter-bar controls count towards the badge — the status chips and the search box are always visible. */
  const activeFilterCount = [warehouseFilter, costTypeFilter, methodFilter, fromDate, toDate].filter((v) => v !== "").length;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = typeof panel === "object" ? (documents.find((d) => d.id === panel.id) ?? null) : null;
  /**
   * `costItems` is denormalized onto EVERY line, so the document's cost breakdown
   * is read off one line — summing across lines would multiply it by the line count.
   */
  const selectedByType = useMemo(
    () =>
      landedCostTotalsByType(
        (selected?.lines[0]?.costItems ?? []).map((ci) => ({
          costType: ci.costType,
          description: ci.description,
          amount: Money.fromMajor(ci.amount),
        })),
      ),
    [selected],
  );

  const totalCost = costItems.reduce((s, c) => s + (c.amount || 0), 0);

  /** بنود التكلفة grouped by نوع التكلفة (R4.7) — a typed cost line is only useful if the split is visible. */
  const costTypeBreakdown = useMemo(
    () =>
      landedCostTotalsByType(
        costItems
          .filter((c) => c.amount > 0)
          .map((c) => ({ costType: c.costType, description: c.description, amount: Money.fromMajor(String(c.amount)) })),
      ),
    [costItems],
  );

  const preview: AllocatedLandedCostLine[] | null = useMemo(() => {
    const usableCosts = costItems.filter((c) => c.amount > 0);
    if (usableCosts.length === 0 || targets.length === 0) return null;
    try {
      return distributeLandedCost(
        usableCosts.map((c) => ({ costType: c.costType, description: c.description, amount: Money.fromMajor(String(c.amount)) })),
        method,
        targets.map((target) => ({
          itemId: target.itemId,
          warehouseId,
          sourceInvoiceId: invoiceId,
          sourceInvoiceNumber: selectedInvoice?.number ?? null,
          qty: Qty.fromMajor(String(target.qty)),
          unitCost: Money.fromMajor(String(target.unitCost)),
          weight: Qty.fromMajor(String(target.weight || 0)),
        })),
      );
    } catch {
      return null;
    }
  }, [costItems, method, targets, warehouseId, invoiceId, selectedInvoice]);

  // Arriving from a confirmed purchase invoice's row menu, the funding document is already known.
  useScreenIntent((intent) => {
    openCreate(intent.prefill?.invoiceId);
  });

  function openCreate(sourceInvoiceId?: string) {
    setError(null);
    const firstInvoice = invoices.find((i) => i.id === sourceInvoiceId) ?? invoices[0] ?? null;
    setInvoiceId(firstInvoice?.id ?? "");
    setWarehouseId(warehouses[0]?.id ?? "");
    setMethod("BY_VALUE");
    setCostItems([blankCostItem()]);
    const firstLine = firstInvoice?.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
    setProject(null);
    setPanel("create");
  }

  function changeInvoice(id: string) {
    setInvoiceId(id);
    const invoice = invoices.find((i) => i.id === id) ?? null;
    const firstLine = invoice?.lines.find((l) => l.kind === "inventory" && l.itemId !== null);
    setTargets(firstLine?.itemId ? [blankTarget(firstLine.itemId, Number(firstLine.qty), Number(firstLine.unitCost))] : []);
  }

  function changeTargetItem(key: string, itemId: string) {
    const line = invoiceStockLines.find((l) => l.itemId === itemId);
    setTargets((prev) =>
      prev.map((target) => (target.key === key ? { ...target, itemId, qty: line ? Number(line.qty) : target.qty, unitCost: line ? Number(line.unitCost) : target.unitCost } : target)),
    );
  }

  async function submit(confirmAfter: boolean) {
    setError(null);
    if (!invoiceId || !warehouseId) {
      setError(t("landedCosts.error.needInvoice"));
      return;
    }
    const usableCosts = costItems.filter((c) => c.amount > 0);
    const usableTargets = targets.filter((target) => target.itemId !== "" && target.qty > 0);
    if (usableCosts.length === 0 || usableTargets.length === 0) {
      setError(t("landedCosts.error.needLines"));
      return;
    }
    const costItemEntries: LandedCostItemEntryDTO[] = usableCosts.map((c) => ({ costType: c.costType, description: c.description, amount: String(c.amount) }));
    const targetEntries: LandedCostTargetDTO[] = usableTargets.map((target) => ({
      itemId: target.itemId,
      warehouseId,
      sourceInvoiceId: invoiceId,
      sourceInvoiceNumber: selectedInvoice?.number ?? null,
      qty: String(target.qty),
      unitCost: String(target.unitCost),
      weight: String(target.weight || 0),
      costCategory: target.costCategory,
    }));
    try {
      const id = crypto.randomUUID();
      const created = await createLandedCost.mutateAsync({
        id,
        date: todayIso(),
        memo: "",
        distributionMethod: method,
        costItems: costItemEntries,
        targets: targetEntries,
        projectId: project?.id ?? null,
      });
      if (confirmAfter) await confirmLandedCost.mutateAsync(created.id);
      setPanel("none");
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
    }
  }

  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reverseAsked, setReverseAsked] = useState<string | null>(null);

  async function confirmExisting(id: string) {
    setError(null);
    try {
      await confirmLandedCost.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    }
  }

  async function cancelExisting(id: string) {
    setError(null);
    try {
      await cancelLandedCost.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    }
  }

  async function reverseConfirmed(id: string) {
    if (reversingId !== null) return;
    setReverseAsked(null);
    setReversingId(id);
    setError(null);
    try {
      await reverseLandedCost.mutateAsync(id);
    } catch (err) {
      setError(errorMessage(err, t("common.failed")));
      return RowActionOutcome.Refused;
    } finally {
      setReversingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: counts.all },
    { key: "draft", label: t("docStatus.draft"), count: counts.draft },
    { key: "confirmed", label: t("docStatus.confirmed"), count: counts.confirmed },
  ];

  function reversalLink(d: (typeof documents)[number]) {
    const otherId = d.reversedByDocId ?? d.reversesDocId ?? null;
    if (otherId === null) return null;
    const other = documents.find((candidate) => candidate.id === otherId);
    return (
      <button
        type="button"
        className="text-[11.5px] font-semibold text-brand underline-offset-2 hover:underline"
        onClick={(event) => {
          event.stopPropagation();
          setPanel({ id: otherId });
        }}
      >
        {t(d.reversedByDocId ? "landedCosts.reversedByDocument" : "landedCosts.reversesDocument", { number: other?.docNo ?? otherId })}
      </button>
    );
  }

  const columns: DocumentListColumn<(typeof documents)[number]>[] = [
    {
      key: "docNo",
      header: t("landedCosts.col.docNo"),
      render: (d) => (
        <span className="flex flex-col items-start gap-[2px]">
          <span className="mz-num font-semibold text-ink">{d.docNo ?? t("docStatus.draft")}</span>
          {reversalLink(d)}
        </span>
      ),
    },
    { key: "date", header: t("landedCosts.col.documentDate"), render: (d) => <span className="mz-num">{d.date}</span> },
    { key: "absorptionDate", header: t("landedCosts.col.absorptionDate"), render: (d) => <span className="mz-num">{d.absorptionDate ?? "—"}</span> },
    {
      key: "warehouse",
      header: t("common.warehouse"),
      render: (d) => warehouses.find((w) => w.id === d.lines[0]?.warehouseId)?.name ?? "—",
    },
    { key: "method", header: t("landedCosts.col.method"), render: (d) => t(METHOD_KEY[d.lines[0]?.distributionMethod ?? "BY_VALUE"]) },
    {
      key: "linkedInvoices",
      header: t("landedCosts.col.linkedInvoices"),
      render: (d) => {
        const numbers = [...new Set(d.lines.map((l) => l.sourceInvoiceNumber).filter(Boolean))];
        return <span className="mz-num">{numbers.length > 0 ? numbers.join("، ") : "—"}</span>;
      },
    },
    { key: "total", header: t("landedCosts.col.total"), align: "end", render: (d) => <MoneyDisplay value={sumMajor(d.lines.map((l) => l.allocatedAmount))} /> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={documentStatusLabel(d.status, t)} tone={DOC_STATUS_TONE[d.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("landedCosts.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <ResubmitErrorNotice controller={resubmit} />
      <DocumentList<(typeof documents)[number]>
        title={t("landedCosts.title")}
        description={t("landedCosts.description")}
        actions={
          <Button variant="primary" onClick={() => openCreate()}>
            {t("landedCosts.new")}
          </Button>
        }
        listKey="landed-costs"
        statsCollapsible
        stats={[
          { label: t("landedCosts.stat.total"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("landedCosts.stat.confirmed"), value: <span className="mz-num">{counts.confirmed}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | DocumentStatusDTO)}
        columns={columns}
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("landedCosts.searchPlaceholder")}
        filterBarExtra={
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <SelectField
              label={t("common.warehouse")}
              value={warehouseFilter}
              onChange={setWarehouseFilter}
              options={[{ value: "", label: t("common.allWarehouses") }, ...warehouses.map((w) => ({ value: w.id, label: w.name }))]}
            />
            <SelectField
              label={t("landedCosts.field.type")}
              value={costTypeFilter}
              onChange={setCostTypeFilter}
              options={[
                { value: "", label: t("landedCosts.allCostTypes") },
                ...Object.entries(COST_TYPE_KEY).map(([value, key]) => ({ value, label: t(key) })),
              ]}
            />
            <SelectField
              label={t("landedCosts.col.method")}
              value={methodFilter}
              onChange={setMethodFilter}
              options={[
                { value: "", label: t("landedCosts.allMethods") },
                ...Object.entries(METHOD_KEY).map(([value, key]) => ({ value, label: t(key) })),
              ]}
            />
            <TextField label={t("common.fromDate")} value={fromDate} onChange={setFromDate} type="date" />
            <TextField label={t("common.toDate")} value={toDate} onChange={setToDate} type="date" />
          </div>
        }
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        rows={pageRows}
        loading={itemsQuery.isLoading}
        rowKey={(d) => d.id}
        onRowClick={(d) => setPanel({ id: d.id })}
        rowAction={(d) => {
          // Derived from THIS document's state: a draft can still be confirmed or
          // dropped, a confirmed one can only be reversed (R1.3).
          const menuItems: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => setPanel({ id: d.id }) },
            ...(d.status === "draft"
              ? [
                  { key: "confirm", label: t("landedCosts.confirm"), onSelect: () => confirmExisting(d.id) },
                  { key: "cancel", label: t("common.cancel"), onSelect: () => cancelExisting(d.id) },
                ]
              : []),
            ...resubmitRowMenuItems(resubmit, d),
            ...(d.status === "confirmed" ? [{ key: "void", label: t("landedCosts.void"), tone: "danger" as const, disabled: reversingId === d.id, confirm: { title: t("landedCosts.void"), consequence: t("landedCosts.voidConsequence", { doc: d.docNo ?? d.id }), confirmLabel: t("landedCosts.void") }, onSelect: () => reverseConfirmed(d.id) }] : []),
          ];
          return (
            <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
              <RowMenu items={menuItems} label={t("landedCosts.row.actionsFor", { doc: d.docNo ?? d.id })} />
            </div>
          );
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{filtered.length}</span> {t("landedCosts.showingSuffix")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("landedCosts.empty")}
            description={t("landedCosts.emptyHint")}
            action={{ label: t("landedCosts.new"), onClick: () => openCreate() }}
          />
        }
      />

      <SidePanel open={panel === "create"} onClose={() => setPanel("none")} title={t("landedCosts.panel.title")}>
        <div className="flex flex-col gap-4 p-5">
          <SelectField label={t("landedCosts.field.warehouse")} value={warehouseId} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
          <SelectField
            label={t("landedCosts.field.invoice")}
            value={invoiceId}
            onChange={changeInvoice}
            options={invoices.map((i) => ({ value: i.id, label: i.number }))}
          />
          <SelectField
            label={t("landedCosts.field.method")}
            value={method}
            onChange={(v) => setMethod(v as LandedCostDistributionMethodDTO)}
            options={Object.entries(METHOD_KEY).map(([value, key]) => ({ value, label: t(key) }))}
          />
          <p className="-mt-2 text-[11.5px] leading-[1.9] text-ink-muted">{t(METHOD_HINT_KEY[method])}</p>
          <EntityPicker
            label={t("common.project")}
            value={project}
            onChange={changeProject}
            options={projectOptions}
            placeholder={t("common.noProject")}
            emptyMessage={t("common.noProject")}
          />
          {method === "BY_WEIGHT" && targets.every((target) => (target.weight || 0) <= 0) ? (
            <div role="alert" className="rounded-[8px] border border-warning bg-warning-soft px-3 py-2 text-[12.5px] text-warning-ink">
              {t("landedCosts.error.needWeight")}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">{t("landedCosts.costLinesHeading")}</span>
            {costItems.map((c) => (
              <div key={c.key} className="flex flex-col gap-2 rounded-[10px] border border-border p-2.5">
                <TextField label={t("landedCosts.field.description")} value={c.description} onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, description: v } : x)))} />
                <div className="grid grid-cols-2 gap-2">
                  <SelectField
                    label={t("landedCosts.field.type")}
                    value={c.costType}
                    onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, costType: v as LandedCostTypeDTO } : x)))}
                    options={Object.entries(COST_TYPE_KEY).map(([value, key]) => ({ value, label: t(key) }))}
                  />
                  <NumberField label={t("landedCosts.field.amount")} value={c.amount} onChange={(v) => setCostItems((prev) => prev.map((x) => (x.key === c.key ? { ...x, amount: v } : x)))} min={0} />
                </div>
                <div className="flex justify-end">
                  <Button variant="ghost" onClick={() => setCostItems((prev) => prev.filter((x) => x.key !== c.key))} disabled={costItems.length === 1}>
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            <Button variant="default" onClick={() => setCostItems((prev) => [...prev, blankCostItem()])}>
              {t("landedCosts.addCostLine")}
            </Button>
            <div className="text-end text-[13px] font-bold text-ink">
              {t("landedCosts.totalCost")} <MoneyDisplay value={totalCost} />
            </div>
            {costTypeBreakdown.length > 0 ? (
              <div className="rounded-[10px] border border-border bg-surface-2 p-[10px_12px]">
                <div className="mb-[6px] text-[11.5px] font-bold text-ink-muted">{t("landedCosts.byTypeHeading")}</div>
                <ul className="flex flex-col gap-[4px]">
                  {costTypeBreakdown.map((row) => (
                    <li key={row.costType} className="flex items-center justify-between text-[12.5px] text-ink">
                      <span>{t(COST_TYPE_KEY[row.costType])}</span>
                      <MoneyDisplay value={Number(row.amount.toString())} showUnit={false} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-bold text-ink-muted">{t("landedCosts.targetsHeading")}</span>
            {invoiceStockLines.length === 0 ? (
              <div className="rounded-[8px] border border-border px-3 py-2 text-[12.5px] text-ink-muted">{t("landedCosts.noStockItems")}</div>
            ) : null}
            {targets.map((target) => (
              <div key={target.key} className="flex flex-col gap-2 rounded-[10px] border border-border p-2.5">
                <SelectField
                  label={t("common.item")}
                  value={target.itemId}
                  onChange={(v) => changeTargetItem(target.key, v)}
                  options={invoiceStockLines.map((sl) => ({ value: sl.itemId as string, label: itemName(sl.itemId as string) }))}
                />
                {/* A grid, not a fixed-width flex row: the fourth column BY_WEIGHT adds squeezed every number field to ~35px inside the panel. */}
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label={t("common.qty")} value={target.qty} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === target.key ? { ...x, qty: v } : x)))} min={0} />
                  <NumberField label={t("landedCosts.field.currentCost")} value={target.unitCost} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === target.key ? { ...x, unitCost: v } : x)))} min={0} />
                  {method === "BY_WEIGHT" ? (
                    <NumberField label={t("landedCosts.field.weight")} value={target.weight} onChange={(v) => setTargets((prev) => prev.map((x) => (x.key === target.key ? { ...x, weight: v } : x)))} min={0} />
                  ) : null}
                </div>
                <SelectField
                  label={t("common.costCategory")}
                  value={target.costCategory ?? ""}
                  onChange={(v) =>
                    setTargets((prev) =>
                      prev.map((x) => (x.key === target.key ? { ...x, costCategory: v === "" ? null : (v as CostCategoryDTO) } : x)),
                    )
                  }
                  options={[{ value: "", label: t("common.none") }, ...COST_CATEGORY_VALUES.map((c) => ({ value: c, label: t(COST_CATEGORY_KEY[c]) }))]}
                  disabled={project === null}
                />
                <div className="flex justify-end">
                  <Button variant="ghost" onClick={() => setTargets((prev) => prev.filter((x) => x.key !== target.key))} disabled={targets.length === 1}>
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            ))}
            <Button
              variant="default"
              disabled={invoiceStockLines.length === 0}
              onClick={() => {
                const first = invoiceStockLines[0];
                setTargets((prev) => [...prev, blankTarget((first?.itemId as string) ?? "", first ? Number(first.qty) : 1, first ? Number(first.unitCost) : 0)]);
              }}
            >
              {t("landedCosts.addTarget")}
            </Button>
          </div>

          {preview ? (
            <div className="rounded-lg border border-border bg-surface p-[12px]">
              <div className="mb-[8px] text-[12.5px] font-semibold text-ink">{t("landedCosts.previewHeading")}</div>
              <table className="w-full border-collapse text-[12.5px]">
                <tbody>
                  {preview.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-b-0">
                      <td className="py-[7px]">{itemName(p.itemId)}</td>
                      <td className="mz-num py-[7px] text-end">+<MoneyDisplay value={Number(p.allocatedAmount.toString())} showUnit={false} /></td>
                      <td className="mz-num py-[7px] text-end"><MoneyDisplay value={Number(p.newUnitCost.toString())} showUnit={false} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => submit(false)}>
              {t("common.save")}
            </Button>
            <Button variant="primary" onClick={() => submit(true)}>
              {t("landedCosts.saveConfirm")}
            </Button>
          </div>
        </div>
      </SidePanel>

      <SidePanel open={selected !== null} onClose={() => setPanel("none")} title={selected?.docNo ?? t("landedCosts.detailTitle")}>
        {selected ? (
          <div className="flex flex-col gap-4 p-5">
            <StatusPill label={documentStatusLabel(selected.status, t)} tone={DOC_STATUS_TONE[selected.status]} />
            <HeldDocumentReapproval document={selected} pending={confirmLandedCost.isPending} confirm={(id) => confirmLandedCost.mutateAsync(id)} />
            {reversalLink(selected)}
            <div className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[12.5px]">
              <span className="text-ink-muted">{t("landedCosts.field.method")}</span>
              <span className="font-semibold text-ink">{t(METHOD_KEY[selected.lines[0]?.distributionMethod ?? "BY_VALUE"])}</span>
            </div>
            <div className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[12.5px]">
              <span className="text-ink-muted">{t("common.project")}</span>
              <span className="font-semibold text-ink">{projectName(selected.lines[0]?.projectId ?? null)}</span>
            </div>
            {selectedByType.length > 0 ? (
              <div className="rounded-[10px] border border-border bg-surface-2 p-[10px_12px]">
                <div className="mb-[6px] text-[11.5px] font-bold text-ink-muted">{t("landedCosts.byTypeHeading")}</div>
                <ul className="flex flex-col gap-[4px]">
                  {selectedByType.map((row) => (
                    <li key={row.costType} className="flex items-center justify-between text-[12.5px] text-ink">
                      <span>{t(COST_TYPE_KEY[row.costType])}</span>
                      <MoneyDisplay value={Number(row.amount.toString())} showUnit={false} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              {selected.lines.map((l, i) => (
                <div key={i} className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-[13px]">
                  <span>
                    {itemName(l.itemId)}
                    <span className="ms-[6px] text-[11.5px] text-ink-faint">{l.costCategory ? t(COST_CATEGORY_KEY[l.costCategory]) : "—"}</span>
                    {l.distributionMethod === "BY_WEIGHT" ? (
                      <span className="mz-num ms-[6px] text-[11.5px] text-ink-faint">{t("landedCosts.weightOf", { weight: l.weight })}</span>
                    ) : null}
                  </span>
                  <span className="mz-num text-ink-muted">
                    +<MoneyDisplay value={num(l.allocatedAmount)} /> → {t("landedCosts.newUnitCost")} <MoneyDisplay value={num(l.newUnitCost)} />
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 text-[13px] font-bold text-ink">
              <span>{t("landedCosts.totalAllocated")}</span>
              <MoneyDisplay value={sumMajor(selected.lines.map((l) => l.allocatedAmount))} />
            </div>
            {error ? <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
            <ResubmitForApprovalAction family={ResubmitFamily.LandedCosts} document={selected} />
            {selected.status === "draft" ? (
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => confirmExisting(selected.id)}>
                  {t("landedCosts.confirm")}
                </Button>
                <Button variant="default" onClick={() => cancelExisting(selected.id)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : null}
            {selected.status === "confirmed" ? (
              <>
                <Button variant="danger-outline" disabled={reversingId === selected.id} onClick={() => setReverseAsked(selected.id)}>
                  {t("landedCosts.void")}
                </Button>
                <ConfirmDialog
                  open={reverseAsked === selected.id}
                  title={t("landedCosts.void")}
                  consequence={t("landedCosts.voidConsequence", { doc: selected.docNo ?? selected.id })}
                  confirmLabel={t("landedCosts.void")}
                  onConfirm={() => void reverseConfirmed(selected.id)}
                  onCancel={() => setReverseAsked(null)}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </SidePanel>
    </div>
  );
}

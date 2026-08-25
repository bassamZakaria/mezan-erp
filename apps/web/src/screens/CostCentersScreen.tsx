import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FulcrumRule, AccountTree, Button, Card, EntityPicker, IconButton, StatCard, StatusPill, SidePanel, type AccountTreeRow, type EntityPickerOption, type PillTone } from "@mezan/ui";
import { COST_CENTER_TYPE_DEFINITIONS, getCostCenterTypeLabel, isLinked as costCenterIsLinked, type CostCenterType as DomainCostCenterType } from "@mezan/domain";
import type { CostCenterDTO, CostCenterStatusDTO, CostCenterTypeDTO } from "@mezan/contracts";
import { buildCostCenterTree, isDescendantOf, type CostCenterTreeNode } from "../lib/cost-center-tree";
import { useBranches, useCostCenters, useCreateCostCenter, useUpdateCostCenter } from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

/** مراكز التكلفة (Cost Centers) — docs/catalog/04 §"مراكز التكلفة". Tree/list + detail panel, mirroring ChartOfAccountsScreen's tree pattern (no header/detail distinction here — any cost center may have children). */

const STATUS_KEY: Record<CostCenterStatusDTO, AppTranslationKey> = { active: "costCentres.status.active", inactive: "costCentres.status.inactive" };
const STATUS_TONE: Record<CostCenterStatusDTO, PillTone> = { active: "success", inactive: "neutral" };

const ROOT_PARENT_ID = "__root__";

interface FlatRow extends CostCenterDTO {
  level: number;
  hasChildren: boolean;
}

function visibleRows(nodes: readonly CostCenterTreeNode[], level: number, expanded: ReadonlySet<string>): FlatRow[] {
  const out: FlatRow[] = [];
  for (const node of nodes) {
    const { children, ...costCenter } = node;
    out.push({ ...costCenter, level, hasChildren: children.length > 0 });
    if (children.length > 0 && expanded.has(node.id)) {
      out.push(...visibleRows(children, level + 1, expanded));
    }
  }
  return out;
}

interface CostCenterDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: CostCenterTypeDTO;
  parentId: string | null;
  notes: string;
  status: CostCenterStatusDTO;
}

const BLANK_DRAFT: CostCenterDraft = { code: "", nameAr: "", nameEn: "", type: "general", parentId: null, notes: "", status: "active" };

function draftFromCostCenter(cc: CostCenterDTO): CostCenterDraft {
  return { code: cc.code, nameAr: cc.nameAr, nameEn: cc.nameEn ?? "", type: cc.type, parentId: cc.parentId, notes: cc.notes ?? "", status: cc.status };
}

/** Returns a catalogue KEY (with any placeholders), so the caller decides the locale. */
type ValidationError = { key: AppTranslationKey; params?: Record<string, string | number> };

function validateDraft(draft: CostCenterDraft, existing: CostCenterDTO[], editingId: string | null): ValidationError | null {
  const code = draft.code.trim();
  if (code === "") return { key: "costCentres.codeRequired" as const };
  if (!editingId && existing.some((c) => c.code === code)) {
    return { key: "costCentres.codeInUse" as const, params: { code } };
  }
  if (draft.nameAr.trim() === "") return { key: "costCentres.nameRequired" as const };
  if (draft.parentId !== null) {
    if (editingId && draft.parentId === editingId) return { key: "costCentres.circularParent" as const };
    if (!existing.some((c) => c.id === draft.parentId)) return { key: "costCentres.parentMissing" as const };
    if (editingId && isDescendantOf(existing, draft.parentId, editingId)) {
      return { key: "costCentres.circularParent" as const };
    }
  }
  return null;
}

export function CostCentersScreen() {
  const { t } = useAppTranslation();
  const query = useCostCenters();
  const createCostCenter = useCreateCostCenter();
  const updateCostCenter = useUpdateCostCenter();
  const branchesQuery = useBranches();
  const costCenters = query.data ?? [];
  const branches = branchesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CostCenterTypeDTO | "all">("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const expandedInitialized = useRef(false);

  // Expand the whole tree the first time cost centers load — afterwards the
  // user's own expand/collapse choices are left alone.
  useEffect(() => {
    if (!expandedInitialized.current && costCenters.length > 0) {
      expandedInitialized.current = true;
      setExpandedIds(new Set(costCenters.map((c) => c.id)));
    }
  }, [costCenters]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CostCenterDraft>(BLANK_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);

  const tree = useMemo(() => buildCostCenterTree(costCenters), [costCenters]);
  const hasActiveFilter = search.trim() !== "" || typeFilter !== "all";

  const rows: FlatRow[] = useMemo(() => {
    if (!hasActiveFilter) return visibleRows(tree, 0, expandedIds);
    const q = search.trim().toLowerCase();
    return [...costCenters]
      .filter((c) => typeFilter === "all" || c.type === typeFilter)
      .filter((c) => q === "" || c.nameAr.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({ ...c, level: 0, hasChildren: false }));
  }, [tree, costCenters, expandedIds, hasActiveFilter, search, typeFilter]);

  const treeRows: AccountTreeRow[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    typeLabel: getCostCenterTypeLabel(row.type as DomainCostCenterType),
    natureLabel: costCenterIsLinked(row) ? t("costCentres.linked") : t("costCentres.standalone"),
    statusLabel: t(STATUS_KEY[row.status]),
    statusTone: STATUS_TONE[row.status],
    level: row.level,
    hasChildren: row.hasChildren,
    expanded: expandedIds.has(row.id),
  }));

  const allIds = useMemo(() => costCenters.map((c) => c.id), [costCenters]);
  const allExpanded = allIds.length > 0 && allIds.every((id) => expandedIds.has(id));

  const parentOptions: EntityPickerOption[] = useMemo(
    () => [{ id: ROOT_PARENT_ID, label: t("costCentres.rootParent") }, ...costCenters.filter((c) => c.id !== editingId).map((c) => ({ id: c.id, label: `${c.code} — ${c.nameAr}` }))],
    [costCenters, editingId, t],
  );

  const selected = selectedId ? costCenters.find((c) => c.id === selectedId) ?? null : null;
  const parentOfSelected = selected?.parentId ? costCenters.find((c) => c.id === selected.parentId) ?? null : null;
  const childrenOfSelected = selectedId ? costCenters.filter((c) => c.parentId === selectedId) : [];
  const branchOfSelected = selected?.branchId ? branches.find((b) => b.id === selected.branchId) ?? null : null;

  function openCreateForm() {
    setEditingId(null);
    setDraft(BLANK_DRAFT);
    setFormError(null);
    setFormOpen(true);
  }

  function openEditForm(cc: CostCenterDTO) {
    setEditingId(cc.id);
    setDraft(draftFromCostCenter(cc));
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, costCenters, editingId);
    if (error) {
      setFormError(t(error.key, error.params));
      return;
    }
    setFormError(null);
    const nameEn = draft.nameEn.trim() === "" ? null : draft.nameEn.trim();
    const notes = draft.notes.trim() === "" ? null : draft.notes.trim();
    try {
      if (editingId) {
        await updateCostCenter.mutateAsync({
          id: editingId,
          patch: { nameAr: draft.nameAr.trim(), nameEn, type: draft.type, parentId: draft.parentId, notes, status: draft.status },
        });
      } else {
        await createCostCenter.mutateAsync({
          id: crypto.randomUUID(),
          code: draft.code.trim(),
          nameAr: draft.nameAr.trim(),
          nameEn,
          type: draft.type,
          parentId: draft.parentId,
          notes,
        });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("costCentres.theCostCentreCouldNot"));
    }
  }

  const totalCount = costCenters.length;
  const activeCount = costCenters.filter((c) => c.status === "active").length;
  const linkedCount = costCenters.filter((c) => costCenterIsLinked(c)).length;
  const standaloneCount = totalCount - linkedCount;

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("costCentres.costCentresCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="mz-eyebrow">Accounting · Cost Centers</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("costCentres.costCentres")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">
            {t("costCentres.costCentresLetYouSee")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(allIds))}>{allExpanded ? t("costCentres.collapseAll") : t("costCentres.expandAll")}</Button>
          <Button variant="primary" onClick={openCreateForm}>
            {t("costCentres.addCostCentre")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("costCentres.totalCostCentres")} value={<span className="mz-num">{totalCount}</span>} />
        <StatCard label={t("common.active")} value={<span className="mz-num">{activeCount}</span>} />
        <StatCard label={t("costCentres.linked")} value={<span className="mz-num">{linkedCount}</span>} />
        <StatCard label={t("costCentres.standalone")} value={<span className="mz-num">{standaloneCount}</span>} />
      </div>

      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <div className="flex min-w-[240px] flex-1 items-center gap-[9px] rounded-md border border-border bg-surface px-[13px] py-[9px] focus-within:border-brand">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("costCentres.searchByCodeOrName")}
            aria-label={t("costCentres.searchByCodeOrName2")}
            className="w-full border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <select
          aria-label={t("costCentres.filterByType")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as CostCenterTypeDTO | "all")}
          className="rounded-md border border-border bg-surface px-[11px] py-[9px] text-[12.5px] text-ink"
        >
          <option value="all">{t("costCentres.allTypes")}</option>
          {COST_CENTER_TYPE_DEFINITIONS.map((d) => (
            <option key={d.code} value={d.code}>
              {d.labelAr}
            </option>
          ))}
        </select>
      </div>

      <AccountTree
        rows={treeRows}
        onToggle={(id) =>
          setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onRowClick={(id) => setSelectedId(id)}
        rowActions={(row) => (
          <IconButton
            aria-label={`تعديل ${row.nameAr}`}
            onClick={(event) => {
              event.stopPropagation();
              const cc = costCenters.find((c) => c.id === row.id);
              if (cc) openEditForm(cc);
            }}
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px]">
              <path d="M13.5 3.5 16.5 6.5 7 16H4v-3L13.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </IconButton>
        )}
        emptyState={
          <div className="p-8 text-center">
            <p className="text-[13px] font-semibold text-ink">{t("costCentres.noCostCentresYet")}</p>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("costCentres.costCentresLetYouSee")}</p>
            <Button className="mt-[12px]" variant="primary" onClick={openCreateForm}>
              {t("costCentres.addCostCentre")}
            </Button>
          </div>
        }
      />

      <div className="mt-[10px] text-xs text-ink-muted">
        {t("common.show")} <span className="mz-num">{rows.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("costCentres.costCentres2")}
      </div>

      {/* -------- Cost center detail panel -------- */}
      <SidePanel
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected ? `${selected.code} — ${selected.nameAr}` : ""}
        description={selected ? getCostCenterTypeLabel(selected.type as DomainCostCenterType) : undefined}
      >
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
              <span className="inline-flex rounded-sm bg-surface-3 px-[8px] py-[3px] text-[11.5px] font-semibold text-ink-muted">
                {costCenterIsLinked(selected) ? t("costCentres.linked") : t("costCentres.standalone")}
              </span>
              <Button size="sm" onClick={() => openEditForm(selected)}>
                {t("common.edit")}
              </Button>
            </div>

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("costCentres.parentCentre")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{parentOfSelected ? `${parentOfSelected.code} — ${parentOfSelected.nameAr}` : t("costCentres.noParentCentre")}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.branch")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.branchId ? (branchOfSelected?.name ?? selected.branchId) : t("costCentres.notLinked")}</div>
              </div>
            </Card>

            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.notes")}</div>
                <div className="mt-[5px] text-[13px] text-ink">{selected.notes}</div>
              </Card>
            ) : null}

            {childrenOfSelected.length > 0 ? (
              <div>
                <h3 className="mb-[8px] text-[12.5px] font-semibold text-ink-muted">{t("costCentres.childCentres")}{childrenOfSelected.length})</h3>
                <div className="flex flex-col gap-[6px]">
                  {childrenOfSelected.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      onClick={() => setSelectedId(child.id)}
                      className="rounded-md border border-border px-[12px] py-[8px] text-start text-[12.5px] text-ink hover:border-brand"
                    >
                      {child.code} — {child.nameAr}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      {/* -------- Add / edit cost center form -------- */}
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={editingId ? t("costCentres.editCostCentre") : t("costCentres.addCostCentre")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField label={t("costCentres.code")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} disabled={editingId !== null} placeholder="CC-005" />
          <TextField label={t("costCentres.name")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("costCentres.nameInArabic")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <SelectField
            label={t("common.type")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as CostCenterTypeDTO }))}
            options={COST_CENTER_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: d.labelAr }))}
          />
          <EntityPicker
            label={t("costCentres.parentCentre")}
            options={parentOptions}
            value={draft.parentId ? (parentOptions.find((o) => o.id === draft.parentId) ?? null) : (parentOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, parentId: !option || option.id === ROOT_PARENT_ID ? null : option.id }))}
          />
          <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

          {editingId ? (
            <SelectField
              label={t("common.status")}
              value={draft.status}
              onChange={(v) => setDraft((d) => ({ ...d, status: v as CostCenterStatusDTO }))}
              options={[
                { value: "active", label: t("common.active") },
                { value: "inactive", label: t("common.inactive") },
              ]}
            />
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

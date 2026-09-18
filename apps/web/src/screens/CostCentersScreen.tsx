import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  Checkbox,
  DisclosureChevron,
  EntityPicker,
  IconButton,
  SearchInput,
  Select,
  SidePanel,
  StatCard,
  StatusPill,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { COST_CENTER_TYPE_DEFINITIONS, isLinked as costCenterIsLinked, matchesSearch } from "@mezan/domain";
import type { CostCenterDTO, CostCenterStatusDTO, CostCenterTypeDTO } from "@mezan/contracts";
import { buildCostCenterTree, isDescendantOf, type CostCenterTreeNode } from "../lib/cost-center-tree";
import {
  useBranches,
  useCostCenters,
  useCreateCostCenter,
  useCreateCostCentersFromDepartments,
  useImportableDepartments,
  useUpdateCostCenter,
} from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlParam, useUrlSearch } from "../lib/url-state";

/** مراكز التكلفة (Cost Centers) — docs/archive/catalog/04 §"مراكز التكلفة". Tree/list + detail panel, mirroring ChartOfAccountsScreen's tree pattern (no header/detail distinction here — any cost center may have children). */

const STATUS_KEY: Record<CostCenterStatusDTO, AppTranslationKey> = { active: "costCentres.status.active", inactive: "costCentres.status.inactive" };
const STATUS_TONE: Record<CostCenterStatusDTO, PillTone> = { active: "success", inactive: "neutral" };
const TYPE_KEY: Record<CostCenterTypeDTO, AppTranslationKey> = {
  general: "costCentres.type.general",
  department: "costCentres.type.department",
  project: "costCentres.type.project",
  branch: "costCentres.type.branch",
};
const HEAD_CELL =
  "whitespace-nowrap border-b border-border bg-surface-2 px-[15px] py-[11px] text-start text-[11px] font-bold uppercase tracking-[0.2px] text-ink-muted";

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
  const { t, locale } = useAppTranslation();
  /** The record stores both names; rendering `nameAr` unconditionally is what puts Arabic in the English UI (D49). */
  const nameOf = (cc: Pick<CostCenterDTO, "nameAr" | "nameEn">) =>
    locale === "en" && cc.nameEn ? cc.nameEn : cc.nameAr;
  const query = useCostCenters();
  const createCostCenter = useCreateCostCenter();
  const updateCostCenter = useUpdateCostCenter();
  const branchesQuery = useBranches();
  const costCenters = query.data ?? EMPTY;
  const branches = branchesQuery.data ?? [];

  const [searchText, setSearchText, search] = useUrlSearch();
  const [typeFilter, setTypeFilter] = useUrlParam("type", "all") as [
    CostCenterTypeDTO | "all",
    (next: string) => void,
  ];
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

  const importableQuery = useImportableDepartments();
  const importFromDepartments = useCreateCostCentersFromDepartments();
  const importable = importableQuery.data ?? [];
  const [importOpen, setImportOpen] = useState(false);
  const [importSelection, setImportSelection] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const [importDone, setImportDone] = useState<number | null>(null);

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
      .filter((c) => matchesSearch(search, c.nameAr, c.code))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((c) => ({ ...c, level: 0, hasChildren: false }));
  }, [tree, costCenters, expandedIds, hasActiveFilter, search, typeFilter]);

  const allIds = useMemo(() => costCenters.map((c) => c.id), [costCenters]);
  const allExpanded = allIds.length > 0 && allIds.every((id) => expandedIds.has(id));

  const parentOptions: EntityPickerOption[] = useMemo(
    () => [{ id: ROOT_PARENT_ID, label: t("costCentres.rootParent") }, ...costCenters.filter((c) => c.id !== editingId).map((c) => ({ id: c.id, label: `${c.code} — ${locale === "en" && c.nameEn ? c.nameEn : c.nameAr}` }))],
    [costCenters, editingId, locale, t],
  );

  const selected = selectedId ? costCenters.find((c) => c.id === selectedId) ?? null : null;
  const parentOfSelected = selected?.parentId ? costCenters.find((c) => c.id === selected.parentId) ?? null : null;
  const childrenOfSelected = selectedId ? costCenters.filter((c) => c.parentId === selectedId) : [];
  const branchOfSelected = selected?.branchId ? branches.find((b) => b.id === selected.branchId) ?? null : null;

  function openImport() {
    setImportError(null);
    setImportDone(null);
    setImportSelection(new Set());
    setImportOpen(true);
  }

  async function submitImport() {
    if (importSelection.size === 0) return;
    setImportError(null);
    try {
      const result = await importFromDepartments.mutateAsync({ departmentIds: [...importSelection] });
      setImportDone(result.created.length);
      setImportSelection(new Set());
      await importableQuery.refetch();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : t("costCentres.import.failed"));
    }
  }

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("costCentres.costCentresCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("costCentres.costCentres")}</h1>
          <p className="mt-[5px] max-w-[62ch] text-[12.5px] text-ink-muted">
            {t("costCentres.costCentresLetYouSee")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={() => setExpandedIds(allExpanded ? new Set() : new Set(allIds))}>{allExpanded ? t("costCentres.collapseAll") : t("costCentres.expandAll")}</Button>
          <Button onClick={openImport}>{t("costCentres.import.action")}</Button>
          <Button variant="primary" onClick={openCreateForm}>
            {t("costCentres.addCostCentre")}
          </Button>
        </div>
      </div>

      <div className="mb-[18px] grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatCard label={t("costCentres.totalCostCentres")} value={<span className="mz-num">{totalCount}</span>} />
        <StatCard label={t("common.active")} value={<span className="mz-num">{activeCount}</span>} />
        <StatCard label={t("costCentres.linked")} value={<span className="mz-num">{linkedCount}</span>} />
        <StatCard label={t("costCentres.standalone")} value={<span className="mz-num">{standaloneCount}</span>} />
      </div>

      <div className="mb-[14px] flex flex-wrap gap-[10px]">
        <SearchInput
          className="min-w-[240px] flex-1"
          value={searchText}
          onValueChange={setSearchText}
          placeholder={t("costCentres.searchByCodeOrName")}
          aria-label={t("costCentres.searchByCodeOrName2")}
        />
        <Select
          size="sm"
          className="w-[190px]"
          aria-label={t("costCentres.filterByType")}
          value={typeFilter}
          onChange={(value) => setTypeFilter(value as CostCenterTypeDTO | "all")}
          options={[
            { value: "all", label: t("costCentres.allTypes") },
            ...COST_CENTER_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: t(TYPE_KEY[d.code]) })),
          ]}
        />
      </div>

      {/*
        A cost centre is not an account. Reusing the chart-of-accounts tree
        labelled these columns اسم الحساب / الطبيعة over cost-centre data and
        had no room for the parent centre at all (D44); the reference lists
        الكود · الاسم · النوع · مرتبط بـ · المركز الرئيسي · الحالة.
      */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th scope="col" className={HEAD_CELL}>{t("costCentres.col.code")}</th>
                <th scope="col" className={HEAD_CELL}>{t("costCentres.col.name")}</th>
                <th scope="col" className={HEAD_CELL}>{t("costCentres.col.type")}</th>
                <th scope="col" className={HEAD_CELL}>{t("costCentres.col.linkedTo")}</th>
                <th scope="col" className={HEAD_CELL}>{t("costCentres.col.parent")}</th>
                <th scope="col" className={HEAD_CELL}>{t("common.status")}</th>
                <th scope="col" className={HEAD_CELL} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const parent = row.parentId ? costCenters.find((c) => c.id === row.parentId) ?? null : null;
                return (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-surface-2"
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td className="px-[15px] py-[10px] align-middle">
                      <span className="mz-num text-ink-muted">{row.code}</span>
                    </td>
                    <td className="px-[15px] py-[10px] align-middle">
                      <div className="flex items-center gap-[6px]" style={{ paddingInlineStart: row.level * 20 }}>
                        {row.hasChildren ? (
                          <button
                            type="button"
                            aria-expanded={expandedIds.has(row.id)}
                            aria-label={expandedIds.has(row.id) ? t("costCentres.collapseAll") : t("costCentres.expandAll")}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExpanded(row.id);
                            }}
                            className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
                          >
                            <DisclosureChevron collapsed={!expandedIds.has(row.id)} className="h-[9px] w-[9px]" />
                          </button>
                        ) : (
                          <span aria-hidden className="inline-block h-[18px] w-[18px] flex-none" />
                        )}
                        <span className="font-semibold text-ink">{nameOf(row)}</span>
                      </div>
                    </td>
                    <td className="px-[15px] py-[10px] align-middle">
                      <span className="inline-flex rounded-sm bg-surface-3 px-[8px] py-[3px] text-[11.5px] font-semibold text-ink-muted">
                        {t(TYPE_KEY[row.type])}
                      </span>
                    </td>
                    <td className="px-[15px] py-[10px] align-middle text-ink-muted">
                      {costCenterIsLinked(row) ? t("costCentres.linked") : t("costCentres.standalone")}
                    </td>
                    <td className="px-[15px] py-[10px] align-middle text-ink-muted">
                      {parent ? `${parent.code} — ${nameOf(parent)}` : t("costCentres.noParentCentre")}
                    </td>
                    <td className="px-[15px] py-[10px] align-middle">
                      <StatusPill label={t(STATUS_KEY[row.status])} tone={STATUS_TONE[row.status]} />
                    </td>
                    <td className="px-[15px] py-[10px] align-middle text-end">
                      <IconButton
                        aria-label={t("costCentres.editLabel", { name: nameOf(row) })}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditForm(row);
                        }}
                      >
                        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px]">
                          <path d="M13.5 3.5 16.5 6.5 7 16H4v-3L13.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        </svg>
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-[13px] font-semibold text-ink">{t("costCentres.noCostCentresYet")}</p>
              <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("costCentres.costCentresLetYouSee")}</p>
              <Button className="mt-[12px]" variant="primary" onClick={openCreateForm}>
                {t("costCentres.addCostCentre")}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="mt-[10px] text-xs text-ink-muted">
        {t("common.show")} <span className="mz-num">{rows.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("costCentres.costCentres2")}
      </div>

      {/* -------- Cost center detail panel -------- */}
      <SidePanel
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title={selected ? `${selected.code} — ${nameOf(selected)}` : ""}
        description={selected ? t(TYPE_KEY[selected.type]) : undefined}
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
                      {child.code} — {nameOf(child)}
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
          <TextField label={t("costCentres.nameInEnglish")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <SelectField
            label={t("common.type")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as CostCenterTypeDTO }))}
            options={COST_CENTER_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: t(TYPE_KEY[d.code]) }))}
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

      {/* -------- إنشاء من الأقسام (R6.7) -------- */}
      <SidePanel open={importOpen} onClose={() => setImportOpen(false)} title={t("costCentres.import.title")} description={t("costCentres.import.description")}>
        <div className="flex flex-col gap-[14px]">
          {importError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {importError}
            </div>
          ) : null}
          {importDone !== null ? (
            <div role="status" className="rounded-md border border-success bg-success-soft px-[12px] py-[10px] text-[12.5px] text-success-ink">
              {t("costCentres.import.done", { count: importDone })}
            </div>
          ) : null}

          {importable.length === 0 ? (
            <p className="text-[12.5px] text-ink-muted">{t("costCentres.import.empty")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-[9px]">
                <Button size="sm" onClick={() => setImportSelection(new Set(importable.filter((d) => !d.codeInUse).map((d) => d.id)))}>
                  {t("costCentres.import.selectAll")}
                </Button>
                <Button size="sm" onClick={() => setImportSelection(new Set())}>
                  {t("costCentres.import.clear")}
                </Button>
                <span className="text-[12px] text-ink-muted">{t("costCentres.import.selected", { count: importSelection.size })}</span>
              </div>

              <div className="flex flex-col gap-[6px]">
                {importable.map((department) => (
                  <div
                    key={department.id}
                    className="flex items-center justify-between gap-[10px] rounded-md border border-border px-[12px] py-[9px]"
                  >
                    <Checkbox
                      className="items-center"
                      checked={importSelection.has(department.id)}
                      disabled={department.codeInUse}
                      onChange={() =>
                        setImportSelection((prev) => {
                          const next = new Set(prev);
                          if (next.has(department.id)) next.delete(department.id);
                          else next.add(department.id);
                          return next;
                        })
                      }
                      label={`${department.code} — ${locale === "en" ? department.name : department.nameAr ?? department.name}`}
                    />
                    <span className="mz-num text-[11.5px] text-ink-faint">
                      {department.codeInUse ? t("costCentres.import.codeInUse") : department.suggestedCode}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-[6px] flex justify-end gap-[9px]">
                <Button type="button" onClick={() => setImportOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" disabled={importSelection.size === 0 || importFromDepartments.isPending} onClick={submitImport}>
                  {t("costCentres.import.submit")}
                </Button>
              </div>
            </>
          )}
        </div>
      </SidePanel>
    </div>
  );
}

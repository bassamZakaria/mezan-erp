import { useMemo, useState, type FormEvent } from "react";
import {
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  RowMenu,
  StatusPill,
  Card,
  Button,
  SidePanel,
  MoneyInput,
  EntityPicker,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { canTransitionProject, matchesSearch } from "@mezan/domain";
import type { CreateProjectDTO, ProjectDTO, ProjectStatusDTO, ProjectStatusFlagDTO } from "@mezan/contracts";
import { ApiError, useCreateProject, useCustomers, useProjectPnL, useProjects, useUpdateProject, useUsers } from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useWorksContracts } from "../data/contracting-contracts-hooks";
import { useNavigation } from "../navigation";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/** المشاريع والمقاولات (Projects & Contracting) — docs/archive/catalog/07 §"المشاريع والمقاولات". List + detail + new-project panel. */

const STATUS_KEY: Record<ProjectStatusDTO, AppTranslationKey> = {
  planned: "projects.status.planned",
  active: "projects.status.active",
  on_hold: "projects.status.on_hold",
  completed: "projects.status.completed",
  cancelled: "projects.status.cancelled",
};

/** The derived flags the P&L reports per project — never stored, recomputed on every read. */
const PROJECT_FLAG_KEY: Record<ProjectStatusFlagDTO, AppTranslationKey> = {
  onerous_contract: "projects.flag.onerousContract",
  late_penalty_risk: "projects.flag.latePenaltyRisk",
};

const STATUS_TONE: Record<ProjectStatusDTO, PillTone> = {
  planned: "info",
  active: "success",
  on_hold: "warning",
  completed: "success",
  cancelled: "danger",
};

/**
 * Only the statuses the project lifecycle actually allows from where it is —
 * the same `PROJECT_TRANSITIONS` map the server enforces, so the picker can
 * never offer a move the save will refuse. A terminal project (مكتمل / ملغي)
 * offers only its own status back.
 */
function statusOptionsFrom(current: ProjectStatusDTO, t: (key: AppTranslationKey) => string) {
  return (Object.keys(STATUS_KEY) as ProjectStatusDTO[])
    .filter((value) => canTransitionProject(current, value))
    .map((value) => ({ value, label: t(STATUS_KEY[value]) }));
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

const NO_CUSTOMER_ID = "__none__";
const NO_MANAGER_ID = "__none__";

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

interface ProjectDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  customerId: string | null;
  managerId: string | null;
  startDate: string;
  endDate: string;
  budget: number | null;
  siteAddress: string;
  notes: string;
}

function blankDraft(): ProjectDraft {
  return {
    code: "",
    nameAr: "",
    nameEn: "",
    customerId: null,
    managerId: null,
    startDate: "",
    endDate: "",
    budget: 0,
    siteAddress: "",
    notes: "",
  };
}

function validateDraft(draft: ProjectDraft, existing: ProjectDTO[]): { key: AppTranslationKey; params?: Record<string, string> } | null {
  const code = draft.code.trim();
  if (code === "") return { key: "projects.codeRequired" };
  if (existing.some((p) => p.code === code)) return { key: "assetCategories.codeInUse", params: { code } };
  if (draft.nameAr.trim() === "") return { key: "projects.nameRequired" };
  return null;
}

export function ProjectsScreen() {
  const { t } = useAppTranslation();
  const query = useProjects();
  const customersQuery = useCustomers();
  const usersQuery = useUsers();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const pnlQuery = useProjectPnL();

  const projects = query.data ?? EMPTY;
  const pnlByProject = useMemo(() => new Map((pnlQuery.data?.rows ?? []).map((r) => [r.projectId, r])), [pnlQuery.data]);
  const customers = customersQuery.data ?? [];
  const users = usersQuery.data ?? [];

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all");
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ProjectDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<ProjectStatusDTO>("planned");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  function customerName(customerId: string | null): string {
    if (customerId === null) return t("projects.noCustomer");
    return customers.find((c) => c.id === customerId)?.nameAr ?? customerId;
  }

  function managerName(managerId: string | null): string {
    if (managerId === null) return t("projects.noManager");
    return users.find((u) => u.id === managerId)?.nameAr ?? managerId;
  }

  const filtered = useMemo(() => {
    let rows = projects;
    if (statusFilter !== "all") rows = rows.filter((p) => p.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((p) => matchesSearch(search, p.code, p.nameAr));
    }
    return rows;
  }, [projects, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalCount = projects.length;
  const activeCount = projects.filter((p) => p.status === "active").length;
  const plannedCount = projects.filter((p) => p.status === "planned").length;
  const completedCount = projects.filter((p) => p.status === "completed").length;

  const selected = selectedId ? projects.find((p) => p.id === selectedId) ?? null : null;

  const customerOptions: EntityPickerOption[] = [
    { id: NO_CUSTOMER_ID, label: t("projects.noCustomer") },
    ...customers.map((c) => ({ id: c.id, label: `${c.code} — ${c.nameAr}` })),
  ];
  const managerOptions: EntityPickerOption[] = [{ id: NO_MANAGER_ID, label: t("projects.noManager") }, ...users.map((u) => ({ id: u.id, label: u.nameAr }))];

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openDetail(project: ProjectDTO) {
    setSelectedId(project.id);
    setStatusDraft(project.status);
    setStatusError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, projects);
    if (error) {
      setFormError(t(error.key, error.params));
      return;
    }
    setFormError(null);
    const body: CreateProjectDTO = {
      id: crypto.randomUUID(),
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      customerId: draft.customerId,
      managerId: draft.managerId,
      startDate: draft.startDate.trim() === "" ? null : draft.startDate.trim(),
      endDate: draft.endDate.trim() === "" ? null : draft.endDate.trim(),
      budget: (draft.budget ?? 0).toFixed(6),
      siteAddress: draft.siteAddress.trim() === "" ? null : draft.siteAddress.trim(),
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
    };
    try {
      await createProject.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("projects.theProjectCouldNotBe"));
    }
  }

  async function handleStatusSave() {
    if (!selected) return;
    setStatusError(null);
    try {
      await updateProject.mutateAsync({ id: selected.id, patch: { status: statusDraft } });
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : t("projects.theProjectSStatusCould"));
    }
  }

  async function changeStatusFromRow(project: ProjectDTO, status: ProjectStatusDTO) {
    if (pendingId) return;
    setPendingId(project.id);
    setActionError(null);
    try {
      await updateProject.mutateAsync({ id: project.id, patch: { status } });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t("projects.theProjectSStatusCould"));
    } finally {
      setPendingId(null);
    }
  }

  const columns: DocumentListColumn<ProjectDTO>[] = [
    { key: "code", header: t("projects.projectCode"), render: (p) => <span className="mz-num font-semibold text-ink">{p.code}</span> },
    { key: "nameAr", header: t("projects.projectName"), render: (p) => <span className="font-semibold text-ink">{p.nameAr}</span> },
    { key: "customer", header: t("common.customer"), render: (p) => customerName(p.customerId) },
    { key: "manager", header: t("projects.projectManager"), render: (p) => managerName(p.managerId) },
    { key: "budget", header: t("projects.budget"), align: "end", render: (p) => <MoneyDisplay value={toMajor(p.budget)} /> },
    {
      key: "actualCost",
      header: t("projects.actualCost"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        return row ? <MoneyDisplay value={toMajor(row.cost)} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "margin",
      header: t("projects.margin"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        if (!row) return <span className="text-ink-muted">—</span>;
        return <MoneyDisplay value={toMajor(row.margin)} className={Number(row.margin) < 0 ? "text-danger-ink" : "text-success-ink"} />;
      },
    },
    {
      key: "revenueRecognised",
      header: t("projects.revenueRecognised"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        return row ? <MoneyDisplay value={toMajor(row.revenueRecognised)} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "billedToDate",
      header: t("projects.billedToDate"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        return row ? <MoneyDisplay value={toMajor(row.billedToDate)} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "wipBalance",
      header: t("projects.wipBalance"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        return row ? <MoneyDisplay value={toMajor(row.wipBalance)} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "contractPosition",
      header: t("projects.contractPosition"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        if (!row) return <span className="text-ink-muted">—</span>;
        // One column, two accounts: a credit position is التزام العقد and is
        // shown as the negative of the asset it is the other side of.
        return Number(row.contractLiability) > 0 ? (
          <MoneyDisplay value={-toMajor(row.contractLiability)} className="text-danger-ink" />
        ) : (
          <MoneyDisplay value={toMajor(row.contractAsset)} />
        );
      },
    },
    {
      key: "advanceOutstanding",
      header: t("projects.advanceOutstanding"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        return row ? <MoneyDisplay value={toMajor(row.advanceOutstanding)} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "retentionHeld",
      header: t("projects.retentionHeld"),
      align: "end",
      render: (p) => {
        const row = pnlByProject.get(p.id);
        return row ? <MoneyDisplay value={toMajor(row.retentionHeld)} /> : <span className="text-ink-muted">—</span>;
      },
    },
    {
      key: "flags",
      header: t("projects.flags"),
      numeric: false,
      render: (p) => {
        const row = pnlByProject.get(p.id);
        if (!row || row.flags.length === 0) return <span className="text-ink-muted">—</span>;
        return (
          <div className="flex flex-wrap gap-[6px]">
            {row.flags.map((flag) => (
              <StatusPill key={flag} label={t(PROJECT_FLAG_KEY[flag])} tone="danger" />
            ))}
          </div>
        );
      },
    },
    { key: "status", header: t("common.status"), render: (p) => <StatusPill label={t(STATUS_KEY[p.status])} tone={STATUS_TONE[p.status]} /> },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: totalCount },
    ...(Object.keys(STATUS_KEY) as ProjectStatusDTO[]).map((status) => ({
      key: status,
      label: t(STATUS_KEY[status]),
      count: projects.filter((p) => p.status === status).length,
    })),
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("projects.projectsCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      {actionError ? (
        <div role="alert" className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}
      <DocumentList<ProjectDTO>
        title={t("projects.projectsAndContracting")}
        description={t("projects.trackingEachProjectSCost")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("projects.newProject")}
          </Button>
        }
        listKey="projects"
        statsCollapsible
        stats={[
          { label: t("projects.totalProjects"), value: <span className="mz-num">{totalCount}</span> },
          { label: t("common.active"), value: <span className="mz-num">{activeCount}</span> },
          { label: t("projects.planned"), value: <span className="mz-num">{plannedCount}</span> },
          { label: t("projects.completed"), value: <span className="mz-num">{completedCount}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(v) => {
          setSearchText(v);
          setPage(1);
        }}
        searchPlaceholder={t("projects.searchByCodeOrName")}
        columns={columns}
        rows={pageRows}
        loading={usersQuery.isLoading}
        rowKey={(p) => p.id}
        onRowClick={openDetail}
        rowAction={(p) => {
          const items: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => openDetail(p) },
            ...statusOptionsFrom(p.status, t)
              .filter((option) => option.value !== p.status)
              .map((option) => ({
                key: option.value,
                label: option.label,
                tone: option.value === "cancelled" ? ("danger" as const) : ("default" as const),
                disabled: pendingId === p.id,
                onSelect: () => void changeStatusFromRow(p, option.value),
              })),
          ];
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: p.nameAr })} />;
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{totalCount}</span> {t("projects.projects")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("projects.noProjectsCreateTheFirst")}
            description={t("projects.emptyBody")}
            action={{ label: t("projects.newProject"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("projects.panelTitle", { name: selected.nameAr }) : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={t(STATUS_KEY[selected.status])} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.projectCode")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.code}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.nameInEnglish")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.nameEn ?? "—"}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.customer")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{customerName(selected.customerId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.projectManager")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{managerName(selected.managerId)}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.startDate")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.startDate ?? "—"}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.endDate")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.endDate ?? "—"}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.siteAddress")}</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.siteAddress ?? "—"}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("projects.costCentre")}</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.costCenterId}</div>
              </div>
            </Card>
            <Card className="p-[13px_15px]">
              <div className="text-[11px] font-semibold text-ink-faint">{t("projects.budget")}</div>
              <div className="mt-[6px]">
                <MoneyDisplay value={toMajor(selected.budget)} className="text-[18px] font-bold" />
              </div>
            </Card>
            <ProjectContractsCard projectId={selected.id} />
            {(() => {
              const row = pnlByProject.get(selected.id);
              if (!row) return null;
              const categories = ["materials", "labour", "equipment", "subcontract", "indirect", "uncategorised"] as const;
              return (
                <Card className="divide-y divide-border">
                  <div className="grid grid-cols-1 divide-y divide-border">
                    <div className="p-[13px_15px]">
                      <div className="text-[11px] font-semibold text-ink-faint">{t("projects.actualCost")}</div>
                      <div className="mt-[6px]"><MoneyDisplay value={toMajor(row.cost)} className="text-[16px] font-bold" /></div>
                    </div>
                    <div className="p-[13px_15px]">
                      <div className="text-[11px] font-semibold text-ink-faint">{t("projects.margin")}</div>
                      <div className="mt-[6px]"><MoneyDisplay value={toMajor(row.margin)} className={`text-[16px] font-bold ${Number(row.margin) < 0 ? "text-danger-ink" : "text-success-ink"}`} /></div>
                    </div>
                    <div className="p-[13px_15px]">
                      <div className="text-[11px] font-semibold text-ink-faint">{t("projects.budgetRemaining")}</div>
                      <div className="mt-[6px]"><MoneyDisplay value={toMajor(row.budgetRemaining)} className={`text-[16px] font-bold ${Number(row.budgetRemaining) < 0 ? "text-danger-ink" : "text-ink"}`} /></div>
                    </div>
                  </div>
                  <div className="p-[13px_15px]">
                    <div className="text-[11px] font-semibold text-ink-faint">{t("projects.costByCategory")}</div>
                    <dl className="mt-[6px] grid grid-cols-2 gap-x-[16px] gap-y-[4px] text-[12.5px]">
                      {categories.map((c) => (
                        <div key={c} className="flex justify-between gap-[8px]">
                          <dt className="text-ink-muted">{t(`costCategory.${c}`)}</dt>
                          <dd><MoneyDisplay value={toMajor(row.costByCategory[c])} /></dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </Card>
              );
            })()}
            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">{t("common.notes")}</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.notes}</div>
              </Card>
            ) : null}
            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">{t("projects.changeStatus")}</h3>
              {statusError ? (
                <div role="alert" className="mb-[10px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                  {statusError}
                </div>
              ) : null}
              <div className="flex items-end gap-[10px]">
                <div className="flex-1">
                  <SelectField label={t("common.status")} value={statusDraft} onChange={(v) => setStatusDraft(v as ProjectStatusDTO)} options={statusOptionsFrom(selected.status, t)}
                    disabled={statusOptionsFrom(selected.status, t).length <= 1}
                  />
                </div>
                <Button variant="primary" onClick={handleStatusSave}>
                  {t("common.save")}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("projects.newProject")} description={t("projects.theProjectSCoreDetails")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <TextField
            label={t("projects.projectCode2")}
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v }))}
            placeholder="TOWER-A"
            hint={t("projects.usedToCreateTheProject")}
          />
          <TextField label={t("projects.projectName2")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("projects.nameInEnglish")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <EntityPicker
            label={t("common.customer")}
            options={customerOptions}
            value={draft.customerId ? (customerOptions.find((o) => o.id === draft.customerId) ?? null) : (customerOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, customerId: !option || option.id === NO_CUSTOMER_ID ? null : option.id }))}
          />
          <EntityPicker
            label={t("projects.projectManager")}
            options={managerOptions}
            value={draft.managerId ? (managerOptions.find((o) => o.id === draft.managerId) ?? null) : (managerOptions[0] ?? null)}
            onChange={(option) => setDraft((d) => ({ ...d, managerId: !option || option.id === NO_MANAGER_ID ? null : option.id }))}
          />
          <TextField label={t("projects.startDate")} value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label={t("projects.endDate")} value={draft.endDate} onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))} placeholder="YYYY-MM-DD" />
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("projects.budgetEgp")}</div>
            <MoneyInput aria-label={t("projects.budgetEgp")} value={draft.budget} onChange={(v) => setDraft((d) => ({ ...d, budget: v }))} />
          </div>
          <TextField label={t("projects.siteAddress")} value={draft.siteAddress} onChange={(v) => setDraft((d) => ({ ...d, siteAddress: v }))} />
          <TextField label={t("common.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

/**
 * عقود المشروع — the contracts raised against this project, with the value the
 * server derived from each one's BOQ. A project can carry several; the first is
 * the main one.
 */
function ProjectContractsCard({ projectId }: { projectId: string }) {
  const { t } = useAppTranslation();
  const { openScreenAt } = useNavigation();
  const contracts = useWorksContracts({ projectId }).data ?? EMPTY;

  return (
    <Card className="p-[13px_15px]">
      <div className="text-[11px] font-semibold text-ink-faint">{t("worksContracts.title")}</div>
      {contracts.length === 0 ? (
        <div className="mt-[6px] text-[12.5px] text-ink-muted">{t("projects.noContracts")}</div>
      ) : (
        <ul className="mt-[8px] flex flex-col gap-[6px]">
          {contracts.map((contract) => (
            <li key={contract.id} className="flex items-center justify-between gap-[10px]">
              <Button size="sm" onClick={() => openScreenAt("contracting-contracts", [contract.docNo])}>
                <span className="mz-num">{contract.docNo}</span>
              </Button>
              <span className="flex-1 truncate text-[12.5px] text-ink">{contract.titleAr}</span>
              <MoneyDisplay value={toMajor(contract.contractValueAfterVariations)} className="text-[12.5px] font-bold" showUnit={false} />
              <StatusPill
                label={t(`worksContracts.status.${contract.status}` as AppTranslationKey)}
                tone={contract.status === "active" ? "success" : contract.status === "terminated" ? "danger" : "neutral"}
              />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

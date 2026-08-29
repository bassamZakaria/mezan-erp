import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, Card, DocumentList, EmptyState, EntityPicker, SidePanel, StatusPill, type DocumentListColumn, type DocumentListStatusChip, type EntityPickerOption, type PillTone } from "@mezan/ui";
import type { JobTitleDTO } from "@mezan/contracts";
import { TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCreateJobTitle, useDepartments, useEmployees, useJobTitles, useUpdateJobTitle } from "../data/hooks";
import { useAppTranslation } from "../i18n";
import { bilingualName } from "./hr-employee-name";

/** المسميات الوظيفية (Job Titles) — docs/archive/catalog/06 §"المسميات الوظيفية". Department-scoped master data; department is locked once created. */

const PAGE_SIZES = [10, 25, 50, 100] as const;

interface JobTitleDraft {
  departmentId: string;
  name: string;
  nameAr: string;
}

function blankDraft(): JobTitleDraft {
  return { departmentId: "", name: "", nameAr: "" };
}

export function JobTitlesScreen() {
  const { t, locale } = useAppTranslation();
  const query = useJobTitles();
  const departmentsQuery = useDepartments();
  const employeesQuery = useEmployees();
  const createJobTitle = useCreateJobTitle();
  const updateJobTitle = useUpdateJobTitle();
  const jobTitles = query.data ?? [];
  const departments = departmentsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<JobTitleDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNameAr, setEditNameAr] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [editError, setEditError] = useState<string | null>(null);

  const departmentOptions: EntityPickerOption[] = departments.map((d) => ({ id: d.id, label: bilingualName(d, locale) }));

  function departmentName(departmentId: string): string {
    const dept = departments.find((d) => d.id === departmentId);
    return dept ? bilingualName(dept, locale) : departmentId;
  }

  const headcountByJobTitle = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) {
      if (!e.jobTitleId || e.status === "terminated") continue;
      map.set(e.jobTitleId, (map.get(e.jobTitleId) ?? 0) + 1);
    }
    return map;
  }, [employees]);

  const filtered = useMemo(() => {
    let rows = jobTitles;
    if (statusFilter !== "all") rows = rows.filter((j) => (statusFilter === "active" ? j.active : !j.active));
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((j) => j.name.toLowerCase().includes(q) || (j.nameAr ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [jobTitles, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const selected = selectedId ? (jobTitles.find((j) => j.id === selectedId) ?? null) : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(jobTitle: JobTitleDTO) {
    setSelectedId(jobTitle.id);
    setEditName(jobTitle.name);
    setEditNameAr(jobTitle.nameAr ?? "");
    setEditActive(jobTitle.active);
    setEditError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (draft.departmentId === "" || draft.name.trim() === "") {
      setFormError(t("jobTitles.aDepartmentAndAJob"));
      return;
    }
    setFormError(null);
    try {
      await createJobTitle.mutateAsync({
        departmentId: draft.departmentId,
        name: draft.name.trim(),
        nameAr: draft.nameAr.trim() === "" ? null : draft.nameAr.trim(),
      });
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("jobTitles.theJobTitleCouldNot"));
    }
  }

  async function handleEditSave(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (editName.trim() === "") {
      setEditError(t("jobTitles.aJobTitleNameIs"));
      return;
    }
    setEditError(null);
    try {
      await updateJobTitle.mutateAsync({
        id: selected.id,
        body: { name: editName.trim(), nameAr: editNameAr.trim() === "" ? null : editNameAr.trim(), active: editActive },
      });
      setSelectedId(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t("jobTitles.theJobTitleCouldNot2"));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: jobTitles.length },
    { key: "active", label: t("common.active"), count: jobTitles.filter((j) => j.active).length },
    { key: "inactive", label: t("common.inactive"), count: jobTitles.filter((j) => !j.active).length },
  ];

  const columns: DocumentListColumn<JobTitleDTO>[] = [
    { key: "name", header: t("jobTitles.jobTitle"), render: (j) => <span className="font-semibold text-ink">{bilingualName(j, locale)}</span> },
    { key: "department", header: t("jobTitles.department"), render: (j) => departmentName(j.departmentId) },
    { key: "headcount", header: t("jobTitles.employees"), align: "end", render: (j) => <span className="mz-num">{headcountByJobTitle.get(j.id) ?? 0}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (j) => <StatusPill label={j.active ? t("common.active") : t("common.inactive")} tone={(j.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("jobTitles.jobTitlesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<JobTitleDTO>
        title={t("jobTitles.jobTitles")}
        description={t("jobTitles.jobTitlesEachTiedTo")}
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            {t("jobTitles.addJobTitle")}
          </Button>
        }
        listKey="job-titles"
        statsCollapsible
        stats={[
          { label: t("jobTitles.totalJobTitles"), value: <span className="mz-num">{jobTitles.length}</span> },
          { label: t("common.active"), value: <span className="mz-num">{jobTitles.filter((j) => j.active).length}</span> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | "active" | "inactive");
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("jobTitles.searchByName")}
        columns={columns}
        rows={pageRows}
        loading={employeesQuery.isLoading}
        rowKey={(j) => j.id}
        onRowClick={openEdit}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{jobTitles.length}</span> {t("jobTitles.jobTitles2")}
          </>
        }
        emptyState={
          <EmptyState
            title={t("jobTitles.noJobTitlesAddThe")}
            description={t("jobTitles.emptyBody")}
            action={{ label: t("jobTitles.addJobTitle"), onClick: openCreateForm }}
          />
        }
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? t("jobTitles.editJobTitle") : ""}>
        {selected ? (
          <form onSubmit={handleEditSave} className="flex flex-col gap-[14px]">
            {editError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {editError}
              </div>
            ) : null}
            <TextField label={t("jobTitles.department")} value={departmentName(selected.departmentId)} onChange={() => {}} disabled />
            <TextField label={t("jobTitles.jobTitle2")} value={editName} onChange={setEditName} />
            <TextField label={t("jobTitles.nameArabic")} value={editNameAr} onChange={setEditNameAr} />
            <ToggleField label={t("common.active")} checked={editActive} onChange={setEditActive} />
            <div className="mt-[6px] flex justify-end gap-[9px]">
              <Button type="button" onClick={() => setSelectedId(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary">
                {t("jobTitles.saveChanges")}
              </Button>
            </div>
          </form>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("jobTitles.addJobTitle")} description={t("jobTitles.theJobTitleSCore")}>
        <form onSubmit={handleCreate} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label={t("jobTitles.department2")}
            options={departmentOptions}
            value={draft.departmentId ? (departmentOptions.find((o) => o.id === draft.departmentId) ?? null) : null}
            onChange={(option) => setDraft((d) => ({ ...d, departmentId: option?.id ?? "" }))}
          />
          <TextField label={t("jobTitles.jobTitle2")} value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} />
          <TextField label={t("jobTitles.nameArabic")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary">
              {t("common.add")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

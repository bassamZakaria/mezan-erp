import { useEffect, useMemo, useState, type FormEvent } from "react";
import { READ_ONLY_KEEP, ReadOnlyFields } from "../shell/ReadOnlyForm";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
} from "@mezan/ui";
import type { PayrollComponentDTO, PayrollComponentKindDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useAccounts } from "../data/hooks";
import { useCreatePayrollComponent, usePayrollComponents, useUpdatePayrollComponent } from "../data/hr-payroll-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/**
 * مكوّنات الرواتب (Payroll components) — R10.7. The registry a contract's
 * allowance and deduction lines bind to, and the GL account each one posts to:
 * an earning or employer contribution debits its account, a deduction credits
 * it. A component with no account falls back to the run's default.
 */

const KIND_KEY: Record<PayrollComponentKindDTO, AppTranslationKey> = {
  earning: "payrollComponents.earning",
  deduction: "payrollComponents.deduction",
  employer_contribution: "payrollComponents.employerContribution",
};

interface ComponentDraft {
  code: string;
  nameAr: string;
  nameEn: string;
  kind: PayrollComponentKindDTO;
  glAccountId: string;
  active: boolean;
}

function blankDraft(): ComponentDraft {
  return { code: "", nameAr: "", nameEn: "", kind: "earning", glAccountId: "", active: true };
}

const PAGE_SIZES = [10, 25, 50, 100] as const;

function draftOf(component: PayrollComponentDTO): ComponentDraft {
  return {
    code: component.code,
    nameAr: component.nameAr,
    nameEn: component.nameEn ?? "",
    kind: component.kind,
    glAccountId: component.glAccountId ?? "",
    active: component.active,
  };
}

export function PayrollComponentsScreen() {
  const nameOf = useEntityName();
  const { t, locale } = useAppTranslation();
  const query = usePayrollComponents();
  const accountsQuery = useAccounts();
  const createComponent = useCreatePayrollComponent();
  const updateComponent = useUpdatePayrollComponent();

  const components = query.data ?? EMPTY;
  const accounts = accountsQuery.data ?? EMPTY;

  const [kindFilter, setKindFilter] = useUrlParam("kind", "all") as [
    "all" | PayrollComponentKindDTO,
    (next: string) => void,
  ];
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComponentDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const accountOptions: EntityPickerOption[] = useMemo(
    () =>
      accounts
        .filter((account) => !account.isHeader && account.status === "active")
        .map((account) => ({
          id: account.id,
          label: `${account.code} — ${nameOf(account)}`,
        })),
    [accounts, nameOf],
  );

  function accountLabel(id: string | null): string {
    if (!id) return t("payrollComponents.runDefault");
    return accountOptions.find((option) => option.id === id)?.label ?? id;
  }

  const filtered = useMemo(() => {
    let rows = components;
    if (kindFilter !== "all") rows = rows.filter((row) => row.kind === kindFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((row) => row.code.toLowerCase().includes(q) || row.nameAr.includes(search.trim()) || (row.nameEn ?? "").toLowerCase().includes(q));
    }
    return rows;
  }, [components, kindFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  function openCreate() {
    setEditingId(null);
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(component: PayrollComponentDTO) {
    setEditingId(component.id);
    setDraft(draftOf(component));
    setFormError(null);
    setFormOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.nameAr.trim() === "" || (editingId === null && draft.code.trim() === "")) {
      setFormError(t("payrollComponents.aCodeAndAnArabic"));
      return;
    }
    setFormError(null);
    const shared = {
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      glAccountId: draft.glAccountId === "" ? null : draft.glAccountId,
      active: draft.active,
    };
    try {
      if (editingId) {
        await updateComponent.mutateAsync({ id: editingId, body: shared });
      } else {
        await createComponent.mutateAsync({ code: draft.code.trim(), kind: draft.kind, ...shared });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("payrollComponents.theComponentCouldNotBe"));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: components.length },
    ...(Object.keys(KIND_KEY) as PayrollComponentKindDTO[]).map((kind) => ({
      key: kind,
      label: t(KIND_KEY[kind]),
      count: components.filter((row) => row.kind === kind).length,
    })),
  ];

  const columns: DocumentListColumn<PayrollComponentDTO>[] = [
    { key: "code", header: t("payrollComponents.code"), render: (row) => <span className="mz-num font-semibold text-ink">{row.code}</span> },
    {
      key: "name",
      header: t("payrollComponents.componentName"),
      render: (row) => <span className="font-semibold text-ink">{nameOf(row)}</span>,
    },
    { key: "kind", header: t("payrollComponents.kind"), render: (row) => t(KIND_KEY[row.kind]) },
    { key: "account", header: t("payrollComponents.glAccount"), render: (row) => <span className="text-ink">{accountLabel(row.glAccountId)}</span> },
    {
      key: "active",
      header: t("common.status"),
      render: (row) => <StatusPill label={row.active ? t("payrollComponents.active") : t("payrollComponents.inactive")} tone={row.active ? "success" : "neutral"} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("payrollComponents.componentsCouldNotBeLoaded")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<PayrollComponentDTO>
        title={t("payrollComponents.payrollComponents")}
        description={t("payrollComponents.eachEarningAndDeductionOn")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("payrollComponents.addComponent")}
          </Button>
        }
        listKey="payroll-components"
        statsCollapsible
        stats={[
          { label: t("payrollComponents.components"), value: <span className="mz-num">{components.length}</span> },
          {
            label: t("payrollComponents.withoutAnAccount"),
            value: <span className="mz-num">{components.filter((row) => row.glAccountId === null).length}</span>,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={kindFilter}
        onStatusChange={(key) => {
          setKindFilter(key as "all" | PayrollComponentKindDTO);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("payrollComponents.searchByCodeOrName")}
        columns={columns}
        rows={pageRows}
        loading={accountsQuery.isLoading}
        rowKey={(row) => row.id}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{components.length}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("payrollComponents.noComponentsYet")}
            description={t("payrollComponents.emptyBody")}
            action={{ label: t("payrollComponents.addComponent"), onClick: openCreate }}
          />
        }
      />

      <SidePanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? t("payrollComponents.editComponent") : t("payrollComponents.newComponent")}
      >
        <ReadOnlyFields><form onSubmit={submit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label={t("payrollComponents.code")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} disabled={editingId !== null} />
          <TextField label={t("payrollComponents.arabicName")} value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
          <TextField label={t("payrollComponents.englishName")} value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
          <SelectField
            label={t("payrollComponents.kind")}
            value={draft.kind}
            onChange={(v) => setDraft((d) => ({ ...d, kind: v as PayrollComponentKindDTO }))}
            options={(Object.keys(KIND_KEY) as PayrollComponentKindDTO[]).map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) }))}
            disabled={editingId !== null}
          />
          <EntityPicker
            label={t("payrollComponents.glAccount")}
            options={accountOptions}
            value={accountOptions.find((option) => option.id === draft.glAccountId) ?? null}
            onChange={(option) => setDraft((d) => ({ ...d, glAccountId: option?.id ?? "" }))}
            placeholder={t("payrollComponents.runDefault")}
          />
          <ToggleField label={t("payrollComponents.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" {...READ_ONLY_KEEP} onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={createComponent.isPending || updateComponent.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form></ReadOnlyFields>
      </SidePanel>
    </div>
  );
}

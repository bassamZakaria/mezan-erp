import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
} from "@mezan/ui";
import type { GarnishmentDTO } from "@mezan/contracts";
import { SelectField, TextField } from "../settings/form-controls";
import { ApiError, useEmployees } from "../data/hooks";
import { useCreateGarnishment, useGarnishments, useReleaseGarnishment } from "../data/hr-payroll-hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { EMPTY } from "../lib/empty";
import { todayIso } from "../lib/dates";

/**
 * الحجز على الأجر — court-ordered and agreed deductions from wages.
 *
 * Distinct from سلف الموظفين on purpose: an advance is the employer's own money
 * being recovered, a garnishment is a third party's. Payroll takes garnishments
 * FIRST, so an employee with both sees the order satisfied before the loan.
 *
 * The employee field is a picker over the real employee register, never free
 * text — a wage deduction against a name nobody holds is money withheld from
 * nobody.
 */

const KIND_KEY: Record<GarnishmentDTO["kind"], AppTranslationKey> = {
  court_order: "garnishments.courtOrder",
  alimony: "garnishments.alimony",
  debt_settlement: "garnishments.debtSettlement",
  union_dues: "garnishments.unionDues",
  other: "garnishments.other",
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

interface GarnishmentDraft {
  employeeId: string;
  kind: GarnishmentDTO["kind"];
  reference: string;
  labelAr: string;
  totalAmount: string;
  monthlyAmount: string;
  startDate: string;
  endDate: string;
  notes: string;
}

function blankDraft(): GarnishmentDraft {
  return {
    employeeId: "",
    kind: "court_order",
    reference: "",
    labelAr: "",
    totalAmount: "",
    monthlyAmount: "",
    startDate: todayIso(),
    endDate: "",
    notes: "",
  };
}

export function GarnishmentsScreen() {
  const { t } = useAppTranslation();
  const query = useGarnishments();
  const employeesQuery = useEmployees();
  const createOrder = useCreateGarnishment();
  const releaseOrder = useReleaseGarnishment();

  const orders = query.data ?? EMPTY;
  const employees = employeesQuery.data ?? EMPTY;

  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "closed">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<GarnishmentDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  /** Which row is releasing — per-row, so one order's spinner never disables the rest. */
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const employeeOptions: EntityPickerOption[] = useMemo(
    () =>
      employees.map((employee) => ({
        id: employee.id,
        label: `${employee.code} — ${employee.firstNameAr ?? employee.firstName} ${employee.lastNameAr ?? employee.lastName}`.trim(),
      })),
    [employees],
  );

  function employeeLabel(id: string): string {
    return employeeOptions.find((option) => option.id === id)?.label ?? id;
  }

  const filtered = useMemo(() => {
    let rows = orders;
    if (statusFilter === "active") rows = rows.filter((row) => row.active);
    if (statusFilter === "closed") rows = rows.filter((row) => !row.active);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((row) => row.reference.toLowerCase().includes(q) || row.labelAr.includes(search.trim()));
    }
    return rows;
  }, [orders, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.employeeId === "" || draft.reference.trim() === "" || draft.labelAr.trim() === "") {
      setFormError(t("garnishments.employeeReferenceAndLabelRequired"));
      return;
    }
    setFormError(null);
    try {
      await createOrder.mutateAsync({
        employeeId: draft.employeeId,
        kind: draft.kind,
        reference: draft.reference.trim(),
        labelAr: draft.labelAr.trim(),
        totalAmount: draft.totalAmount.trim(),
        monthlyAmount: draft.monthlyAmount.trim(),
        currency: "EGP",
        startDate: draft.startDate,
        endDate: draft.endDate === "" ? null : draft.endDate,
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setFormOpen(false);
      setDraft(blankDraft());
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("garnishments.couldNotSave"));
    }
  }

  async function release(order: GarnishmentDTO) {
    if (releasingId !== null) return;
    setReleasingId(order.id);
    try {
      await releaseOrder.mutateAsync(order.id);
    } finally {
      setReleasingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: orders.length },
    { key: "active", label: t("garnishments.active"), count: orders.filter((row) => row.active).length },
    { key: "closed", label: t("garnishments.closed"), count: orders.filter((row) => !row.active).length },
  ];

  const columns: DocumentListColumn<GarnishmentDTO>[] = [
    { key: "reference", header: t("garnishments.reference"), render: (row) => <span className="mz-num font-semibold text-ink">{row.reference}</span> },
    { key: "employee", header: t("garnishments.employee"), render: (row) => <span className="text-ink">{employeeLabel(row.employeeId)}</span> },
    { key: "kind", header: t("garnishments.kind"), render: (row) => t(KIND_KEY[row.kind]) },
    { key: "labelAr", header: t("garnishments.statement"), render: (row) => row.labelAr },
    { key: "monthlyAmount", header: t("garnishments.monthlyInstalment"), render: (row) => <MoneyDisplay value={Number(row.monthlyAmount)} /> },
    { key: "outstanding", header: t("garnishments.outstanding"), render: (row) => <MoneyDisplay value={Number(row.outstanding)} /> },
    {
      key: "status",
      header: t("common.status"),
      render: (row) => <StatusPill label={row.active ? t("garnishments.active") : t("garnishments.closed")} tone={row.active ? "success" : "neutral"} />,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        row.active ? (
          <Button size="sm" onClick={() => void release(row)} disabled={releasingId === row.id}>
            {t("garnishments.release")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("garnishments.couldNotLoad")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <DocumentList<GarnishmentDTO>
        title={t("garnishments.title")}
        description={t("garnishments.description")}
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            {t("garnishments.addOrder")}
          </Button>
        }
        listKey="hr-garnishments"
        statsCollapsible
        stats={[
          { label: t("garnishments.activeOrders"), value: <span className="mz-num">{orders.filter((row) => row.active).length}</span> },
          {
            label: t("garnishments.totalOutstanding"),
            value: <MoneyDisplay value={orders.filter((r) => r.active).reduce((sum, r) => sum + Number(r.outstanding), 0)} />,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key as "all" | "active" | "closed");
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("garnishments.searchByReferenceOrStatement")}
        columns={columns}
        rows={pageRows}
        loading={query.isLoading || employeesQuery.isLoading}
        rowKey={(row) => row.id}
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
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{orders.length}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("garnishments.noOrdersYet")}
            description={t("garnishments.emptyBody")}
            action={{ label: t("garnishments.addOrder"), onClick: () => setFormOpen(true) }}
          />
        }
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={t("garnishments.newOrder")}>
        <form onSubmit={submit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <EntityPicker
            label={t("garnishments.employee")}
            options={employeeOptions}
            value={employeeOptions.find((option) => option.id === draft.employeeId) ?? null}
            onChange={(option) => setDraft((d) => ({ ...d, employeeId: option?.id ?? "" }))}
            placeholder={t("garnishments.chooseEmployee")}
          />
          <SelectField
            label={t("garnishments.kind")}
            value={draft.kind}
            onChange={(v) => setDraft((d) => ({ ...d, kind: v as GarnishmentDTO["kind"] }))}
            options={(Object.keys(KIND_KEY) as GarnishmentDTO["kind"][]).map((kind) => ({ value: kind, label: t(KIND_KEY[kind]) }))}
          />
          <TextField label={t("garnishments.reference")} value={draft.reference} onChange={(v) => setDraft((d) => ({ ...d, reference: v }))} />
          <TextField label={t("garnishments.statement")} value={draft.labelAr} onChange={(v) => setDraft((d) => ({ ...d, labelAr: v }))} />
          <TextField label={t("garnishments.totalAmount")} value={draft.totalAmount} onChange={(v) => setDraft((d) => ({ ...d, totalAmount: v }))} />
          <TextField
            label={t("garnishments.monthlyInstalment")}
            value={draft.monthlyAmount}
            onChange={(v) => setDraft((d) => ({ ...d, monthlyAmount: v }))}
            hint={t("garnishments.monthlyInstalmentHint")}
          />
          <TextField label={t("garnishments.startDate")} type="date" value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} />
          <TextField label={t("garnishments.endDate")} type="date" value={draft.endDate} onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))} />
          <TextField label={t("garnishments.notes")} value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={createOrder.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

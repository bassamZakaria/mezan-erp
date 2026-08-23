import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  Money as MoneyDisplay,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type PillTone,
} from "@mezan/ui";
import type { PayrollRunDTO, PayrollRunStatusDTO, PayslipDTO } from "@mezan/contracts";
import { PAYROLL_UNIMPLEMENTED_RULES } from "@mezan/domain";
import { NumberField, SelectField } from "../settings/form-controls";
import { ApiError, useBranches, useEmployees, useTreasuryAccounts } from "../data/hooks";
import {
  useApprovePayrollRun,
  useCalculatePayrollRun,
  useCancelPayrollRun,
  useCreatePayrollRun,
  useDisbursePayrollRun,
  usePayrollRun,
  usePayrollRuns,
} from "../data/hr-payroll-hooks";

/** الرواتب (Payroll) — docs/catalog/06 §"الرواتب". A run covers one month: مسودة → محتسب → معتمد (قيد محاسبي متوازن) → مصروف. */

const STATUS_LABEL: Record<PayrollRunStatusDTO, string> = {
  draft: "مسودة",
  calculated: "محتسب",
  approved: "معتمد",
  disbursed: "مصروف",
  cancelled: "ملغى",
};

const STATUS_TONE: Record<PayrollRunStatusDTO, PillTone> = {
  draft: "neutral",
  calculated: "info",
  approved: "warning",
  disbursed: "success",
  cancelled: "danger",
};

const MONTH_LABELS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const LINE_KIND_LABEL = { earning: "استحقاق", deduction: "استقطاع", employer_contribution: "مساهمة صاحب العمل" } as const;

const UNIVERSAL_UNIMPLEMENTED_RULES = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => r.appliesToEveryPayslip);
const SITUATIONAL_UNIMPLEMENTED_RULES = PAYROLL_UNIMPLEMENTED_RULES.filter((r) => !r.appliesToEveryPayslip);

function NetPayQualifierBadge() {
  return (
    <span className="rounded-full border border-info bg-info-soft px-[7px] py-[1px] text-[10.5px] font-semibold text-info-ink">
      قبل الضريبة والتأمينات وبنود قانونية أخرى
    </span>
  );
}

export function PayrollRunsScreen() {
  const query = usePayrollRuns();
  const employeesQuery = useEmployees();
  const treasuryQuery = useTreasuryAccounts();
  const branchesQuery = useBranches();
  const createRun = useCreatePayrollRun();
  const calculateRun = useCalculatePayrollRun();
  const approveRun = useApprovePayrollRun();
  const disburseRun = useDisbursePayrollRun();
  const cancelRun = useCancelPayrollRun();

  const runs = query.data ?? [];
  const employees = employeesQuery.data ?? [];
  const treasuryAccounts = treasuryQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  const now = new Date();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PayrollRunStatusDTO>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [treasuryAccountId, setTreasuryAccountId] = useState("");
  const [branchId, setBranchId] = useState("");

  const detailQuery = usePayrollRun(selectedId);
  const detail = detailQuery.data ?? null;

  function employeeName(employeeId: string): string {
    const e = employees.find((row) => row.id === employeeId);
    if (!e) return employeeId;
    const ar = [e.firstNameAr, e.lastNameAr].filter(Boolean).join(" ").trim();
    return ar || `${e.firstName} ${e.lastName}`;
  }

  const filtered = useMemo(() => {
    let rows = runs;
    if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => r.number.toLowerCase().includes(q) || `${r.year}-${r.month}`.includes(q));
    }
    return rows;
  }, [runs, statusFilter, search]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      const run = await createRun.mutateAsync({ year, month });
      setFormOpen(false);
      setSelectedId(run.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر إنشاء دورة الرواتب.");
    }
  }

  async function runAction(run: PayrollRunDTO, action: "calculate" | "approve" | "cancel") {
    if (pendingId !== null) return;
    setPendingId(run.id);
    setDetailError(null);
    try {
      if (action === "calculate") await calculateRun.mutateAsync(run.id);
      else if (action === "approve") await approveRun.mutateAsync(run.id);
      else await cancelRun.mutateAsync(run.id);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "تعذّر تنفيذ العملية.");
    } finally {
      setPendingId(null);
    }
  }

  async function runDisburse(run: PayrollRunDTO) {
    if (pendingId !== null) return;
    if (treasuryAccountId === "" || branchId === "") {
      setDetailError("اختر الخزينة والفرع قبل الصرف.");
      return;
    }
    setPendingId(run.id);
    setDetailError(null);
    try {
      await disburseRun.mutateAsync({ id: run.id, body: { treasuryAccountId, branchId } });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : "تعذّر صرف الرواتب.");
    } finally {
      setPendingId(null);
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: "الكل", count: runs.length },
    { key: "draft", label: STATUS_LABEL.draft, count: runs.filter((r) => r.status === "draft").length },
    { key: "calculated", label: STATUS_LABEL.calculated, count: runs.filter((r) => r.status === "calculated").length },
    { key: "approved", label: STATUS_LABEL.approved, count: runs.filter((r) => r.status === "approved").length },
    { key: "disbursed", label: STATUS_LABEL.disbursed, count: runs.filter((r) => r.status === "disbursed").length },
    { key: "cancelled", label: STATUS_LABEL.cancelled, count: runs.filter((r) => r.status === "cancelled").length },
  ];

  const columns: DocumentListColumn<PayrollRunDTO>[] = [
    { key: "number", header: "رقم التشغيل", render: (r) => <span className="mz-num font-semibold text-ink">{r.number}</span> },
    {
      key: "period",
      header: "الفترة",
      render: (r) => (
        <span>
          {MONTH_LABELS[r.month - 1]} <span className="mz-num">{r.year}</span>
        </span>
      ),
    },
    { key: "employees", header: "موظفين", align: "end", render: (r) => <span className="mz-num">{r.employeeCount}</span> },
    { key: "gross", header: "إجمالي الراتب", align: "end", render: (r) => <MoneyDisplay value={Number(r.totalGross)} /> },
    { key: "net", header: "صافي الراتب", align: "end", render: (r) => <MoneyDisplay value={Number(r.totalNet)} /> },
    { key: "status", header: "الحالة", render: (r) => <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} /> },
  ];

  const yearTotalGross = runs.filter((r) => r.year === now.getUTCFullYear()).reduce((s, r) => s + Number(r.totalGross), 0);
  const yearTotalNet = runs.filter((r) => r.year === now.getUTCFullYear()).reduce((s, r) => s + Number(r.totalNet), 0);
  const yearDisbursed = runs
    .filter((r) => r.year === now.getUTCFullYear() && r.status === "disbursed")
    .reduce((s, r) => s + Number(r.totalNet), 0);

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل دورات الرواتب.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}

      <DocumentList<PayrollRunDTO>
        eyebrow="HR · Payroll"
        title="الرواتب"
        description="دورة رواتب شهرية: تحتسب من العقود السارية، تخصم أقساط السلف، وتُرحّل قيداً محاسبياً متوازناً عند الاعتماد"
        actions={
          <Button variant="primary" onClick={() => setFormOpen(true)}>
            تشغيل رواتب جديد
          </Button>
        }
        stats={[
          { label: "إجمالي عمليات التشغيل", value: <span className="mz-num">{runs.length}</span> },
          { label: "إجمالي رواتب السنة", value: <MoneyDisplay value={yearTotalGross} /> },
          { label: "صافي رواتب السنة", value: <MoneyDisplay value={yearTotalNet} /> },
          { label: "الصافي المصروف هذا العام", value: <MoneyDisplay value={yearDisbursed} /> },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | PayrollRunStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="ابحث برقم التشغيل أو الفترة..."
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r) => {
          setDetailError(null);
          setSelectedId(r.id);
        }}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{runs.length}</span> دورة
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بيانات</div>}
      />

      <SidePanel open={selectedId !== null} onClose={() => setSelectedId(null)} title={detail ? detail.number : ""}>
        {detail ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[detail.status]} tone={STATUS_TONE[detail.status]} />

            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">الفترة</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">
                  {MONTH_LABELS[detail.month - 1]} <span className="mz-num">{detail.year}</span>
                </div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">عدد الموظفين</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{detail.employeeCount}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">إجمالي الاستحقاقات</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(detail.totalGross)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">إجمالي الاستقطاعات</div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(detail.totalDeductions)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="flex flex-wrap items-center gap-[6px]">
                  <span className="text-[11px] font-semibold text-ink-faint">صافي الرواتب</span>
                  <NetPayQualifierBadge />
                </div>
                <div className="mt-[5px]">
                  <MoneyDisplay value={Number(detail.totalNet)} className="text-[14px] font-bold" />
                </div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">القيد المحاسبي</div>
                <div className="mz-num mt-[5px] text-[12.5px] text-ink">{detail.journalEntryId ?? "—"}</div>
              </div>
            </Card>

            <div role="note" className="rounded-lg border border-info bg-info-soft p-[14px] text-info-ink">
              <h3 className="mb-[6px] font-display text-[13px] font-bold">نطاق الاحتساب — بنود لم تُحتسب في هذه الدورة</h3>
              <p className="text-[12.5px] leading-relaxed">
                الصافي أعلاه احتساب على أساس الاستحقاقات والاستقطاعات التعاقدية فقط. البنود التالية لم تُحتسب لأن كتالوج
                النظام لم يحدد صيغة احتسابها بعد، وتنطبق على جميع موظفي هذه الدورة (
                <span className="mz-num font-semibold">{detail.employeeCount}</span> موظف):
              </p>
              <ul className="mt-[8px] flex flex-col gap-[6px] text-[12px]">
                {UNIVERSAL_UNIMPLEMENTED_RULES.map((rule) => (
                  <li key={rule.code}>
                    <span className="font-semibold">{rule.labelAr}</span> — {rule.detailAr}
                  </li>
                ))}
              </ul>
              {SITUATIONAL_UNIMPLEMENTED_RULES.length > 0 ? (
                <p className="mt-[10px] text-[12px] leading-relaxed">
                  بنود أخرى غير محتسبة تنطبق فقط على موظفين محددين حسب حالة عقودهم — الأجر بالساعة أو باليوم، تكرار الدفع
                  غير الشهري، اختلاف عملة العقد، أو القروض والحجوزات القضائية — ومذكورة عند حدوثها في «ملاحظات الاحتساب»
                  أدناه.
                </p>
              ) : null}
            </div>

            {detail.unpaidLeaveSource === "none" ? (
              <div role="status" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
                لم يُربط مصدر أيام الإجازات بدون أجر — لم تُخصم أي أيام إجازة بدون أجر في هذه الدورة.
              </div>
            ) : null}

            {detail.warnings.length > 0 ? (
              <div className="rounded-lg border border-border p-[14px]">
                <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">ملاحظات الاحتساب</h3>
                <ul className="flex flex-col gap-[5px] text-[12.5px] text-ink-muted">
                  {detail.warnings.map((w, index) => (
                    <li key={index}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">كشوف الرواتب</h3>
              {detail.payslips.length > 0 ? (
                <div className="flex flex-col gap-[12px]">
                  {detail.payslips.map((p: PayslipDTO) => (
                    <div key={p.id} className="rounded-md border border-border p-[12px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-bold text-ink">{employeeName(p.employeeId)}</span>
                        <span className="mz-num text-[11.5px] text-ink-faint">{p.number}</span>
                      </div>
                      <div className="mz-num mt-[3px] text-[11.5px] text-ink-faint">
                        {p.paidDays} / {p.periodDays} يوم
                      </div>
                      <ul className="mt-[8px] flex flex-col gap-[4px]">
                        {p.lines.map((l) => (
                          <li key={l.id} className="flex items-center justify-between text-[12px]">
                            <span className="text-ink-muted">
                              {l.nameAr} <span className="text-ink-faint">({LINE_KIND_LABEL[l.kind]})</span>
                            </span>
                            <MoneyDisplay value={Number(l.amount)} />
                          </li>
                        ))}
                      </ul>
                      <div className="mt-[8px] flex items-center justify-between border-t border-border pt-[8px] text-[12.5px] font-bold text-ink">
                        <span className="flex flex-wrap items-center gap-[6px]">
                          <span>الصافي</span>
                          <NetPayQualifierBadge />
                        </span>
                        <MoneyDisplay value={Number(p.netPay)} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-muted">لم تُحتسب الدورة بعد</p>
              )}
            </div>

            {detailError ? (
              <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
                {detailError}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-[9px]">
              {detail.status === "draft" || detail.status === "calculated" ? (
                <Button variant="primary" disabled={pendingId === detail.id} onClick={() => runAction(detail, "calculate")}>
                  احتساب الرواتب
                </Button>
              ) : null}
              {detail.status === "calculated" ? (
                <Button variant="primary" disabled={pendingId === detail.id} onClick={() => runAction(detail, "approve")}>
                  اعتماد وترحيل القيد
                </Button>
              ) : null}
              {detail.status === "draft" || detail.status === "calculated" ? (
                <Button variant="danger-outline" disabled={pendingId === detail.id} onClick={() => runAction(detail, "cancel")}>
                  إلغاء الدورة
                </Button>
              ) : null}
            </div>

            {detail.status === "approved" ? (
              <div className="flex flex-col gap-[10px] rounded-lg border border-border p-[14px]">
                <h3 className="font-display text-[13px] font-bold text-ink">صرف الرواتب</h3>
                <p className="text-[12px] text-ink-muted">يصدر سند صرف نقدي: مدين رواتب مستحقة (2170) / دائن الخزينة.</p>
                <SelectField
                  label="الخزينة *"
                  value={treasuryAccountId}
                  onChange={setTreasuryAccountId}
                  options={[{ value: "", label: "اختر..." }, ...treasuryAccounts.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))]}
                />
                <SelectField
                  label="الفرع *"
                  value={branchId}
                  onChange={setBranchId}
                  options={[{ value: "", label: "اختر..." }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                />
                <Button variant="primary" disabled={pendingId === detail.id} onClick={() => runDisburse(detail)}>
                  صرف
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="تشغيل رواتب جديد" description="اختر الفترة — ثم احتسب الدورة من الشاشة">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <NumberField label="السنة *" value={year} onChange={(v) => setYear(Number.isNaN(v) ? now.getUTCFullYear() : v)} min={1900} />
          <SelectField
            label="الشهر *"
            value={String(month)}
            onChange={(v) => setMonth(Number(v))}
            options={MONTH_LABELS.map((label, index) => ({ value: String(index + 1), label }))}
          />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              إنشاء
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

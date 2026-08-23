import { useMemo, useState } from "react";
import { DocumentList, DocumentDetail, StatusPill, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { BranchDTO, WarehouseDTO } from "@mezan/contracts";
import { useBranches, useCreateBranch, useWarehouses } from "../data/hooks";
import { TextField, ToggleField, SectionCard } from "./form-controls";

/**
 * الفروع (Branches) — docs/catalog/09 §"إدارة الفروع" list +
 * §"صفحة الفرع — MAIN (Branch detail / Branch 360)" detail, on the real
 * `/branches` API. The Overview tab shows the branch's real warehouses (from
 * `/warehouses`); the remaining Branch-360 tabs (Inventory/Employees/Assets/
 * Activity) have no backing endpoint yet and render as honest stubs.
 */

function branchName(branchId: string, branches: BranchDTO[]): string {
  return branches.find((b) => b.id === branchId)?.name ?? branchId;
}

function StubTab({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-[8px] rounded-lg border border-dashed border-border p-[36px] text-center">
      <StatusPill label="قريباً" tone="info" />
      <p className="text-[12.5px] text-ink-muted">تبويب "{label}" جزء من Branch 360 الكامل — خارج نطاق الأساس الحالي.</p>
    </div>
  );
}

function BranchDetail({ branch, warehouses, onBack }: { branch: BranchDTO; warehouses: WarehouseDTO[]; onBack: () => void }) {
  return (
    <DocumentDetail
      title={`${branch.name} · ${branch.code}`}
      statusLabel={branch.active ? "نشط" : "غير نشط"}
      statusTone={branch.active ? "success" : "neutral"}
      subtitle={branch.isMain ? "الفرع الرئيسي" : "فرع فرعي"}
      actions={<Button onClick={onBack}>رجوع لقائمة الفروع</Button>}
      summary={[
        { label: "كود الفرع", value: branch.code },
        { label: "الهاتف", value: branch.phone ?? "لا توجد" },
        { label: "البريد الإلكتروني", value: branch.email ?? "لا توجد" },
        { label: "العنوان", value: branch.address ?? "لا توجد" },
        { label: "المستودعات", value: <span className="mz-num">{warehouses.length}</span> },
        { label: "الحالة", value: branch.active ? "نشط" : "غير نشط", valueTone: branch.active ? "success" : "default" },
      ]}
      tabs={[
        {
          key: "overview",
          label: "نظرة عامة",
          content: (
            <div className="flex flex-col gap-[16px]">
              <SectionCard title="المستودعات">
                {warehouses.length === 0 ? (
                  <p className="col-span-full text-[12.5px] text-ink-muted">لا توجد مستودعات مرتبطة بهذا الفرع بعد.</p>
                ) : (
                  <div className="col-span-full overflow-x-auto">
                    <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
                      <thead>
                        <tr className="border-b border-border text-ink-muted">
                          <th className="p-[8px] text-start font-semibold">المستودع</th>
                          <th className="p-[8px] text-start font-semibold">الكود</th>
                          <th className="p-[8px] text-end font-semibold">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {warehouses.map((w) => (
                          <tr key={w.id} className="border-b border-border last:border-b-0">
                            <td className="p-[8px] text-ink">{w.name}</td>
                            <td className="mz-num p-[8px] text-ink-muted">{w.code}</td>
                            <td className="p-[8px] text-end">
                              <StatusPill label={w.active ? "نشط" : "غير نشط"} tone={(w.active ? "success" : "neutral") as PillTone} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>
              <div className="rounded-md border border-dashed border-border p-[18px] text-center text-[12.5px] text-ink-muted">
                ستُعرض مؤشرات أداء الفرع (الإيرادات، المصروفات، قيمة المخزون) وحسابات الخزينة هنا فور ربط التقارير المالية والخزينة بالفرع.
              </div>
            </div>
          ),
        },
        { key: "inventory", label: "المخزون", content: <StubTab label="المخزون" /> },
        { key: "employees", label: "الموظفون", content: <StubTab label="الموظفون" /> },
        { key: "assets", label: "الأصول", content: <StubTab label="الأصول" /> },
        { key: "activity", label: "النشاط", content: <StubTab label="النشاط" /> },
      ]}
    />
  );
}

const BLANK_FORM = { code: "", name: "", phone: "", email: "", address: "", isMain: false };

export function BranchesPage() {
  const query = useBranches();
  const warehousesQuery = useWarehouses();
  const createBranch = useCreateBranch();
  const branches = query.data ?? [];
  const warehouses = warehousesQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

  const selected = branches.find((b) => b.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    if (search.trim() === "") return branches;
    const q = search.trim();
    return branches.filter((b) => b.name.includes(q) || b.code.toLowerCase().includes(q.toLowerCase()));
  }, [branches, search]);

  const columns: DocumentListColumn<BranchDTO>[] = [
    { key: "name", header: "اسم الفرع", render: (b) => <span className="font-semibold text-ink">{b.name}</span> },
    { key: "code", header: "رمز الفرع", render: (b) => <span className="mz-num">{b.code}</span> },
    { key: "parent", header: "الفرع الرئيسي", render: (b) => (b.isMain ? "—" : branchName(b.parentBranchId ?? "", branches)) },
    { key: "phone", header: "الهاتف", render: (b) => b.phone ?? "—" },
    {
      key: "status",
      header: "الحالة",
      render: (b) => <StatusPill label={b.active ? "نشط" : "غير نشط"} tone={(b.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  async function submitNewBranch() {
    setError(null);
    if (form.name.trim() === "" || form.code.trim() === "") {
      setError("اسم الفرع ورمزه مطلوبان");
      return;
    }
    try {
      await createBranch.mutateAsync({
        id: crypto.randomUUID(),
        code: form.code.toUpperCase(),
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        isMain: form.isMain,
      });
      setPanelOpen(false);
      setForm(BLANK_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إنشاء الفرع");
    }
  }

  if (selected) {
    return (
      <BranchDetail
        branch={selected}
        warehouses={warehouses.filter((w) => w.branchId === selected.id)}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الفروع.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<BranchDTO>
        eyebrow="Settings · Branches"
        title="الفروع"
        description="إدارة فروع المنشأة — لكل فرع مخزونه وحساباته الخزينة وموظفوه الخاصون"
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            إضافة فرع
          </Button>
        }
        stats={[
          { label: "إجمالي الفروع", value: <span className="mz-num">{branches.length}</span> },
          { label: "الفرع الرئيسي", value: <span className="mz-num">{branches.filter((b) => b.isMain).length}</span> },
          { label: "نشط", value: <span className="mz-num">{branches.filter((b) => b.active).length}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم الفرع أو الرمز…"
        columns={columns}
        rows={filtered}
        rowKey={(b) => b.id}
        onRowClick={(b) => setSelectedId(b.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{branches.length}</span> فرع
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد فروع مطابقة</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إضافة فرع" description="بيانات الفرع الأساسية">
        <div className="flex flex-col gap-[14px]">
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <TextField label="اسم الفرع" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <TextField label="رمز الفرع" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} placeholder="ALEX" />
          <TextField label="الهاتف" type="tel" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
          <TextField label="البريد الإلكتروني" type="email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} />
          <TextField label="العنوان" value={form.address} onChange={(v) => setForm((f) => ({ ...f, address: v }))} />
          <ToggleField label="فرع رئيسي" checked={form.isMain} onChange={(v) => setForm((f) => ({ ...f, isMain: v }))} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
            <Button variant="primary" onClick={() => void submitNewBranch()}>
              حفظ الفرع
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}

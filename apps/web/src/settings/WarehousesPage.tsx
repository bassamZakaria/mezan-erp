import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Chip, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { getWarehouseTypeLabel, WAREHOUSE_TYPE_DEFINITIONS, type WarehouseType } from "@mezan/domain";
import type { BranchDTO, WarehouseDTO } from "@mezan/contracts";
import { useBranches, useCreateWarehouse, useWarehouses } from "../data/hooks";
import { SelectField, TextField, ToggleField } from "./form-controls";

/**
 * المستودعات (Warehouses) — docs/catalog/09 §"إدارة المستودعات". Surfaces
 * all 5 catalog warehouse types (رئيسي / مستودع وسيط / مرتجعات / إنتاج / ڤان)
 * both as a filter row and in the add-warehouse dialog, matching the
 * catalog's captured "Add warehouse" fields.
 */

function branchName(branchId: string, branches: readonly BranchDTO[]): string {
  return branches.find((b) => b.id === branchId)?.name ?? branchId;
}

const TYPE_OPTIONS = WAREHOUSE_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: d.labelAr }));

export function WarehousesPage() {
  const query = useWarehouses();
  const branchesQuery = useBranches();
  const createWarehouse = useCreateWarehouse();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<WarehouseType | "all">("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", branchId: "", type: "MAIN" as WarehouseType, isDefault: false });

  const warehouses = query.data ?? [];
  const branches = branchesQuery.data ?? [];
  const formBranchId = form.branchId || branches[0]?.id || "";

  const filtered = useMemo(() => {
    let rows = warehouses;
    if (typeFilter !== "all") rows = rows.filter((w) => w.type === typeFilter);
    if (search.trim() !== "") {
      const q = search.trim();
      rows = rows.filter((w) => w.name.includes(q) || w.code.toLowerCase().includes(q.toLowerCase()));
    }
    return rows;
  }, [warehouses, typeFilter, search]);

  const columns: DocumentListColumn<WarehouseDTO>[] = [
    { key: "name", header: "اسم المستودع", render: (w) => <span className="font-semibold text-ink">{w.name}</span> },
    { key: "code", header: "رمز المستودع", render: (w) => <span className="mz-num">{w.code}</span> },
    { key: "branch", header: "اسم الفرع", render: (w) => branchName(w.branchId, branches) },
    { key: "type", header: "نوع المستودع", render: (w) => <StatusPill label={getWarehouseTypeLabel(w.type)} tone="info" /> },
    { key: "default", header: "افتراضي", render: (w) => (w.isDefault ? <StatusPill label="افتراضي" tone="success" /> : "—") },
    {
      key: "status",
      header: "الحالة",
      render: (w) => <StatusPill label={w.active ? "نشط" : "غير نشط"} tone={(w.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  async function submitNewWarehouse() {
    setError(null);
    try {
      await createWarehouse.mutateAsync({
        id: crypto.randomUUID(),
        code: form.code.toUpperCase(),
        name: form.name,
        branchId: formBranchId,
        type: form.type,
        isDefault: form.isDefault,
      });
      setPanelOpen(false);
      setForm({ name: "", code: "", branchId: "", type: "MAIN", isDefault: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إنشاء المستودع");
    }
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل المستودعات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<WarehouseDTO>
        eyebrow="Settings · Warehouses"
        title="المستودعات"
        description="خمسة أنواع مستودعات: رئيسي، مستودع وسيط، مرتجعات، إنتاج، وڤان (سيارة توزيع)"
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            إضافة مستودع
          </Button>
        }
        stats={[
          { label: "إجمالي المستودعات", value: <span className="mz-num">{warehouses.length}</span> },
          { label: "نشط", value: <span className="mz-num">{warehouses.filter((w) => w.active).length}</span> },
          { label: "إجمالي الفروع", value: <span className="mz-num">{new Set(warehouses.map((w) => w.branchId)).size}</span> },
        ]}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
              كل الأنواع
            </Chip>
            {WAREHOUSE_TYPE_DEFINITIONS.map((def) => (
              <Chip key={def.code} active={typeFilter === def.code} onClick={() => setTypeFilter(def.code)}>
                {def.labelAr}
              </Chip>
            ))}
          </div>
        }
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم المستودع أو الرمز…"
        columns={columns}
        rows={filtered}
        rowKey={(w) => w.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{warehouses.length}</span> مستودع
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد مستودعات مطابقة</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title="إضافة مستودع" description="بيانات المستودع الأساسية">
        <div className="flex flex-col gap-[14px]">
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <TextField label="اسم المستودع" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <TextField label="رمز المستودع" value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} placeholder="WH-ALEX" />
          <SelectField
            label="اسم الفرع"
            value={formBranchId}
            onChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectField
            label="نوع المستودع"
            value={form.type}
            onChange={(v) => setForm((f) => ({ ...f, type: v as WarehouseType }))}
            options={TYPE_OPTIONS}
          />
          <ToggleField label="مستودع افتراضي للفرع" checked={form.isDefault} onChange={(v) => setForm((f) => ({ ...f, isDefault: v }))} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>إلغاء</Button>
            <Button variant="primary" disabled={createWarehouse.isPending} onClick={() => void submitNewWarehouse()}>
              حفظ المستودع
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}

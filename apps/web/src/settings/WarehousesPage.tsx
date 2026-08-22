import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Chip, Button, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import {
  createWarehouse,
  InvalidWarehouseError,
  getWarehouseTypeLabel,
  WAREHOUSE_TYPE_DEFINITIONS,
  type Warehouse,
  type WarehouseType,
} from "@mezan/domain";
import { sampleBranches, sampleWarehouses, branchName } from "./sample-data";
import { SelectField, TextField, ToggleField } from "./form-controls";

/**
 * المستودعات (Warehouses) — docs/catalog/09 §"إدارة المستودعات". Surfaces
 * all 5 catalog warehouse types (رئيسي / مستودع وسيط / مرتجعات / إنتاج / ڤان)
 * both as a filter row and in the add-warehouse dialog, matching the
 * catalog's captured "Add warehouse" fields.
 */

let nextId = sampleWarehouses.length + 1;

const TYPE_OPTIONS = WAREHOUSE_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: d.labelAr }));

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>(sampleWarehouses);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<WarehouseType | "all">("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", branchId: sampleBranches[0]?.id ?? "", type: "MAIN" as WarehouseType, isDefault: false });

  const filtered = useMemo(() => {
    let rows = warehouses;
    if (typeFilter !== "all") rows = rows.filter((w) => w.type === typeFilter);
    if (search.trim() !== "") {
      const q = search.trim();
      rows = rows.filter((w) => w.name.includes(q) || w.code.toLowerCase().includes(q.toLowerCase()));
    }
    return rows;
  }, [warehouses, typeFilter, search]);

  const columns: DocumentListColumn<Warehouse>[] = [
    { key: "name", header: "اسم المستودع", render: (w) => <span className="font-semibold text-ink">{w.name}</span> },
    { key: "code", header: "رمز المستودع", render: (w) => <span className="mz-num">{w.code}</span> },
    { key: "branch", header: "اسم الفرع", render: (w) => branchName(w.branchId, sampleBranches) },
    { key: "type", header: "نوع المستودع", render: (w) => <StatusPill label={getWarehouseTypeLabel(w.type)} tone="info" /> },
    { key: "default", header: "افتراضي", render: (w) => (w.isDefault ? <StatusPill label="افتراضي" tone="success" /> : "—") },
    {
      key: "status",
      header: "الحالة",
      render: (w) => <StatusPill label={w.active ? "نشط" : "غير نشط"} tone={(w.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  function submitNewWarehouse() {
    setError(null);
    try {
      const warehouse = createWarehouse({
        id: `w${nextId++}`,
        code: form.code.toUpperCase(),
        name: form.name,
        branchId: form.branchId,
        type: form.type,
        isDefault: form.isDefault,
      });
      setWarehouses((prev) => [...prev, warehouse]);
      setPanelOpen(false);
      setForm({ name: "", code: "", branchId: sampleBranches[0]?.id ?? "", type: "MAIN", isDefault: false });
    } catch (err) {
      setError(err instanceof InvalidWarehouseError ? err.message : "تعذر إنشاء المستودع");
    }
  }

  return (
    <>
      <DocumentList<Warehouse>
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
            value={form.branchId}
            onChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
            options={sampleBranches.map((b) => ({ value: b.id, label: b.name }))}
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
            <Button variant="primary" onClick={submitNewWarehouse}>
              حفظ المستودع
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}

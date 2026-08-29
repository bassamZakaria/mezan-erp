import { useEffect, useMemo, useState } from "react";
import { DocumentList, StatusPill, Chip, Card, Button, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import { WAREHOUSE_TYPE_DEFINITIONS, type WarehouseType } from "@mezan/domain";
import type { WarehouseDTO } from "@mezan/contracts";
import { useBranches, useCreateWarehouse, useWarehouses } from "../data/hooks";
import { branchName } from "./branch-name";
import { SelectField, TextField, ToggleField } from "./form-controls";
import { warehouseTypeLabel } from "../domain-labels";
import { useAppTranslation } from "../i18n";
import { useEntityName } from "../lib/entity-names";
import { EMPTY } from "../lib/empty";
import { useUrlParam, useUrlSearch } from "../lib/url-state";

/**
 * المستودعات (Warehouses) — docs/archive/catalog/09 §"إدارة المستودعات". Surfaces
 * all 5 catalog warehouse types (رئيسي / مستودع وسيط / مرتجعات / إنتاج / ڤان)
 * both as a filter row and in the add-warehouse dialog, matching the
 * catalog's captured "Add warehouse" fields.
 */

export function WarehousesPage() {
  const nameOf = useEntityName();
  const { t } = useAppTranslation();
  const typeOptions = WAREHOUSE_TYPE_DEFINITIONS.map((d) => ({ value: d.code, label: warehouseTypeLabel(d.code, t) }));
  const query = useWarehouses();
  const branchesQuery = useBranches();
  const createWarehouseMutation = useCreateWarehouse();
  const warehouses = query.data ?? EMPTY;
  const branches = branchesQuery.data ?? EMPTY;
  const [searchText, setSearchText, search] = useUrlSearch();
  const [typeFilter, setTypeFilter] = useUrlParam("type", "all") as [
    WarehouseType | "all",
    (next: string) => void,
  ];
  const [panelOpen, setPanelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", nameEn: "", code: "", branchId: "", type: "MAIN" as WarehouseType, isDefault: false });

  useEffect(() => {
    if (form.branchId === "" && branches.length > 0) {
      setForm((f) => ({ ...f, branchId: branches[0]!.id }));
    }
  }, [branches, form.branchId]);

  const filtered = useMemo(() => {
    let rows = warehouses;
    if (typeFilter !== "all") rows = rows.filter((w) => w.type === typeFilter);
    if (search.trim() !== "") {
      const q = search.trim();
      rows = rows.filter((w) => w.name.includes(q) || (w.nameEn ?? "").toLowerCase().includes(q.toLowerCase()) || w.code.toLowerCase().includes(q.toLowerCase()));
    }
    return rows;
  }, [warehouses, typeFilter, search]);

  const columns: DocumentListColumn<WarehouseDTO>[] = [
    { key: "name", header: t("warehouses.col.name"), render: (w) => <span className="font-semibold text-ink">{nameOf(w)}</span> },
    { key: "code", header: t("warehouses.col.code"), render: (w) => <span className="mz-num">{w.code}</span> },
    { key: "branch", header: t("warehouses.col.branch"), render: (w) => branchName(w.branchId, branches) },
    { key: "type", header: t("warehouses.col.type"), render: (w) => <StatusPill label={warehouseTypeLabel(w.type, t)} tone="info" /> },
    { key: "default", header: t("warehouses.col.default"), render: (w) => (w.isDefault ? <StatusPill label={t("warehouses.default")} tone="success" /> : "—") },
    {
      key: "status",
      header: t("warehouses.col.status"),
      render: (w) => <StatusPill label={w.active ? t("warehouses.active") : t("warehouses.inactive")} tone={(w.active ? "success" : "neutral") as PillTone} />,
    },
  ];

  async function submitNewWarehouse() {
    setError(null);
    try {
      await createWarehouseMutation.mutateAsync({
        id: crypto.randomUUID(),
        code: form.code.toUpperCase(),
        name: form.name,
        nameEn: form.nameEn.trim() === "" ? null : form.nameEn.trim(),
        branchId: form.branchId,
        type: form.type,
        isDefault: form.isDefault,
      });
      setPanelOpen(false);
      setForm({ name: "", nameEn: "", code: "", branchId: branches[0]?.id ?? "", type: "MAIN", isDefault: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("warehouses.createFailed"));
    }
  }

  if (query.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("warehouses.loadFailed")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
          {t("warehouses.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <>
      <DocumentList<WarehouseDTO>
        title={t("warehouses.title")}
        description={t("warehouses.description")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("warehouses.add")}
          </Button>
        }
        stats={[
          { label: t("warehouses.stat.total"), value: <span className="mz-num">{warehouses.length}</span> },
          { label: t("warehouses.stat.active"), value: <span className="mz-num">{warehouses.filter((w) => w.active).length}</span> },
          { label: t("warehouses.stat.branches"), value: <span className="mz-num">{new Set(warehouses.map((w) => w.branchId)).size}</span> },
        ]}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]" role="radiogroup" aria-label={t("warehouses.allTypes")}>
            <Chip active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
              {t("warehouses.allTypes")}
            </Chip>
            {WAREHOUSE_TYPE_DEFINITIONS.map((def) => (
              <Chip key={def.code} active={typeFilter === def.code} onClick={() => setTypeFilter(def.code)}>
                {warehouseTypeLabel(def.code, t)}
              </Chip>
            ))}
          </div>
        }
        searchValue={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder={t("warehouses.searchPlaceholder")}
        columns={columns}
        rows={filtered}
        rowKey={(w) => w.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("warehouses.showingPrefix")} <span className="mz-num">{filtered.length}</span> {t("warehouses.showingOf")} <span className="mz-num">{warehouses.length}</span> {t("warehouses.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("warehouses.empty")}</div>}
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("warehouses.panel.title")} description={t("warehouses.panel.description")}>
        <div className="flex flex-col gap-[14px]">
          {error ? <StatusPill label={error} tone="danger" /> : null}
          <TextField label={t("warehouses.col.name")} value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} />
          <TextField label={t("warehouses.col.nameEn")} value={form.nameEn} onChange={(v) => setForm((f) => ({ ...f, nameEn: v }))} />
          <TextField label={t("warehouses.col.code")} value={form.code} onChange={(v) => setForm((f) => ({ ...f, code: v }))} placeholder="WH-ALEX" />
          <SelectField
            label={t("warehouses.col.branch")}
            value={form.branchId}
            onChange={(v) => setForm((f) => ({ ...f, branchId: v }))}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectField
            label={t("warehouses.col.type")}
            value={form.type}
            onChange={(v) => setForm((f) => ({ ...f, type: v as WarehouseType }))}
            options={typeOptions}
          />
          <ToggleField label={t("warehouses.field.isDefault")} checked={form.isDefault} onChange={(v) => setForm((f) => ({ ...f, isDefault: v }))} />
          <div className="flex justify-end gap-[9px]">
            <Button onClick={() => setPanelOpen(false)}>{t("warehouses.cancel")}</Button>
            <Button variant="primary" onClick={submitNewWarehouse}>
              {t("warehouses.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </>
  );
}

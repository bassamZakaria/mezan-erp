import { useMemo, useState, type FormEvent } from "react";
import { DocumentList, Money as MoneyDisplay, StatusPill, Card, Button, SidePanel, MoneyInput, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { AssetDTO, AssetScopeDTO, AssetStatusDTO, CreateAssetDTO } from "@mezan/contracts";
import { ApiError, useAssetCategories, useAssets, useBranches, useCreateAsset } from "../data/hooks";
import { NumberField, SelectField, TextField } from "../settings/form-controls";

/** سجل الأصول (Asset Register) — docs/catalog/07 §"سجل الأصول". List + detail + register-asset panel. */

const STATUS_LABEL: Record<AssetStatusDTO, string> = {
  active: "نشط",
  under_maintenance: "تحت الصيانة",
  fully_depreciated: "مهلك بالكامل",
  disposed: "تم التخلص",
};

const STATUS_TONE: Record<AssetStatusDTO, PillTone> = {
  active: "success",
  under_maintenance: "warning",
  fully_depreciated: "info",
  disposed: "danger",
};

const SCOPE_LABEL: Record<AssetScopeDTO, string> = { general: "عام", branch: "فرع", warehouse: "مستودع" };
const SCOPE_OPTIONS = (Object.keys(SCOPE_LABEL) as AssetScopeDTO[]).map((value) => ({ value, label: SCOPE_LABEL[value] }));

function toMajor(scaledDecimalString: string): number {
  return Number(scaledDecimalString);
}

function bookValue(asset: AssetDTO): number {
  return toMajor(asset.acquisitionCost) - toMajor(asset.accumulatedDepreciation);
}

interface AssetDraft {
  nameAr: string;
  nameEn: string;
  code: string;
  categoryId: string;
  scope: AssetScopeDTO;
  branchId: string;
  warehouseId: string;
  acquisitionDate: string;
  acquisitionCost: number | null;
  depreciationStartDate: string;
  usefulLifeMonths: number;
  salvageValue: number | null;
}

function blankDraft(): AssetDraft {
  return {
    nameAr: "",
    nameEn: "",
    code: "",
    categoryId: "",
    scope: "general",
    branchId: "",
    warehouseId: "",
    acquisitionDate: "",
    acquisitionCost: 0,
    depreciationStartDate: "",
    usefulLifeMonths: 60,
    salvageValue: null,
  };
}

function validateDraft(draft: AssetDraft, existing: AssetDTO[]): string | null {
  const code = draft.code.trim();
  if (code === "") return "كود الأصل مطلوب.";
  if (existing.some((a) => a.code === code)) return `الكود "${code}" مستخدم بالفعل — اختر كوداً آخر.`;
  if (draft.nameAr.trim() === "") return "الاسم بالعربية مطلوب.";
  if (draft.categoryId.trim() === "") return "التصنيف مطلوب.";
  if (draft.scope === "branch" && draft.branchId.trim() === "") return "الفرع مطلوب عند اختيار نطاق «فرع».";
  if (draft.acquisitionDate.trim() === "") return "تاريخ الاقتناء مطلوب.";
  if (draft.acquisitionCost === null || draft.acquisitionCost < 0) return "تكلفة الاقتناء مطلوبة ويجب ألا تكون سالبة.";
  if (!Number.isFinite(draft.usefulLifeMonths) || draft.usefulLifeMonths <= 0) return "العمر الإنتاجي (شهور) يجب أن يكون رقماً أكبر من صفر.";
  return null;
}

export function AssetRegisterScreen() {
  const query = useAssets();
  const categoriesQuery = useAssetCategories();
  const branchesQuery = useBranches();
  const createAsset = useCreateAsset();

  const assets = query.data ?? [];
  const categories = categoriesQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AssetDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  function categoryName(categoryId: string): string {
    const category = categories.find((c) => c.id === categoryId);
    return category ? `${category.code} — ${category.nameAr}` : categoryId;
  }

  const filtered = useMemo(() => {
    let rows = assets;
    if (categoryFilter !== "all") rows = rows.filter((a) => a.categoryId === categoryFilter);
    if (branchFilter !== "all") rows = rows.filter((a) => a.branchId === branchFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((a) => a.nameAr.toLowerCase().includes(q) || a.code.toLowerCase().includes(q));
    }
    return rows;
  }, [assets, categoryFilter, branchFilter, search]);

  const totalCount = assets.length;
  const activeCount = assets.filter((a) => a.status === "active").length;
  const fullyDepreciatedCount = assets.filter((a) => a.status === "fully_depreciated").length;

  const selected = selectedId ? assets.find((a) => a.id === selectedId) ?? null : null;

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, assets);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const body: CreateAssetDTO = {
      id: crypto.randomUUID(),
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn.trim(),
      categoryId: draft.categoryId,
      scope: draft.scope,
      branchId: draft.scope === "branch" ? draft.branchId : null,
      warehouseId: draft.scope === "warehouse" ? (draft.warehouseId.trim() === "" ? null : draft.warehouseId.trim()) : null,
      acquisitionDate: draft.acquisitionDate.trim(),
      acquisitionCost: (draft.acquisitionCost ?? 0).toFixed(6),
      depreciationStartDate: draft.depreciationStartDate.trim() === "" ? undefined : draft.depreciationStartDate.trim(),
      usefulLifeMonths: draft.usefulLifeMonths,
      salvageValue: draft.salvageValue === null ? undefined : draft.salvageValue.toFixed(6),
    };
    try {
      await createAsset.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّر تسجيل الأصل.");
    }
  }

  const columns: DocumentListColumn<AssetDTO>[] = [
    { key: "nameAr", header: "الأصل", render: (a) => <span className="font-semibold text-ink">{a.nameAr}</span> },
    { key: "category", header: "التصنيف", render: (a) => categoryName(a.categoryId) },
    { key: "acquisitionDate", header: "تاريخ الاقتناء", render: (a) => <span className="mz-num">{a.acquisitionDate}</span> },
    { key: "acquisitionCost", header: "تكلفة الاقتناء", align: "end", render: (a) => <MoneyDisplay value={toMajor(a.acquisitionCost)} /> },
    { key: "bookValue", header: "القيمة الدفترية", align: "end", render: (a) => <MoneyDisplay value={bookValue(a)} /> },
    { key: "status", header: "الحالة", render: (a) => <StatusPill label={STATUS_LABEL[a.status]} tone={STATUS_TONE[a.status]} /> },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل سجل الأصول.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<AssetDTO>
        eyebrow="Fixed Assets · Register"
        title="سجل الأصول"
        description="السجل المركزي للأصول الثابتة — الاقتناء والتصنيف وإعداد طريقة الإهلاك لكل أصل"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            تسجيل أصل
          </Button>
        }
        stats={[
          { label: "إجمالي الأصول", value: <span className="mz-num">{totalCount}</span> },
          { label: "نشط", value: <span className="mz-num">{activeCount}</span> },
          { label: "مهلك بالكامل", value: <span className="mz-num">{fullyDepreciatedCount}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث في الأصول..."
        filterBarExtra={
          <div className="flex flex-wrap gap-[10px]">
            <div className="min-w-[200px]">
              <SelectField
                label="التصنيف"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[{ value: "all", label: "كل التصنيفات" }, ...categories.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameAr}` }))]}
              />
            </div>
            <div className="min-w-[200px]">
              <SelectField
                label="الفرع"
                value={branchFilter}
                onChange={setBranchFilter}
                options={[{ value: "all", label: "كل الفروع" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </div>
          </div>
        }
        columns={columns}
        rows={filtered}
        rowKey={(a) => a.id}
        onRowClick={(a) => setSelectedId(a.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{totalCount}</span> أصل
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد أصول — لم يتم تسجيل أي أصول بعد</div>}
      />

      <SidePanel open={selected !== null} onClose={() => setSelectedId(null)} title={selected ? `أصل — ${selected.nameAr}` : ""}>
        {selected ? (
          <div className="flex flex-col gap-[16px]">
            <StatusPill label={STATUS_LABEL[selected.status]} tone={STATUS_TONE[selected.status]} />
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">كود الأصل</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.code}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">اسم الأصل</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{selected.nameEn ?? "—"}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">التصنيف</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{categoryName(selected.categoryId)}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">نطاق الأصل</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">{SCOPE_LABEL[selected.scope]}</div>
              </div>
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ الاقتناء</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.acquisitionDate}</div>
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تاريخ بدء الإهلاك</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.depreciationStartDate}</div>
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">العمر الإنتاجي (شهور)</div>
                <div className="mz-num mt-[5px] text-[14px] font-bold text-ink">{selected.usefulLifeMonths}</div>
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">طريقة الإهلاك</div>
                <div className="mt-[5px] text-[14px] font-bold text-ink">القسط الثابت</div>
              </div>
            </Card>
            <Card className="grid grid-cols-2 overflow-hidden">
              <div className="border-e border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">تكلفة الاقتناء</div>
                <MoneyDisplay value={toMajor(selected.acquisitionCost)} className="mt-[5px] text-[14px] font-bold" />
              </div>
              <div className="border-b border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">القيمة المتبقية</div>
                <MoneyDisplay value={toMajor(selected.salvageValue)} className="mt-[5px] text-[14px] font-bold" />
              </div>
              <div className="border-e border-border p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">مجمع الإهلاك</div>
                <MoneyDisplay value={toMajor(selected.accumulatedDepreciation)} className="mt-[5px] text-[14px] font-bold" />
              </div>
              <div className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">القيمة الدفترية</div>
                <MoneyDisplay value={bookValue(selected)} className="mt-[5px] text-[14px] font-bold text-brand" />
              </div>
            </Card>
            {selected.notes ? (
              <Card className="p-[13px_15px]">
                <div className="text-[11px] font-semibold text-ink-faint">ملاحظات</div>
                <div className="mt-[6px] text-[13px] text-ink">{selected.notes}</div>
              </Card>
            ) : null}
          </div>
        ) : null}
      </SidePanel>

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="تسجيل أصل" description="بيانات الأصل الأساسية">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">الهوية والتصنيف</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label="الاسم بالعربية *"
                value={draft.nameAr}
                onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
                placeholder="مثال: سيارة النقل الرئيسية"
              />
              <TextField label="اسم الأصل" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} />
              <TextField label="كود الأصل *" value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} />
              <SelectField
                label="التصنيف *"
                value={draft.categoryId}
                onChange={(v) => setDraft((d) => ({ ...d, categoryId: v }))}
                options={[{ value: "", label: "اختر التصنيف" }, ...categories.map((c) => ({ value: c.id, label: `${c.code} — ${c.nameAr}` }))]}
              />
              <SelectField
                label="نطاق الأصل *"
                value={draft.scope}
                onChange={(v) => setDraft((d) => ({ ...d, scope: v as AssetScopeDTO }))}
                options={SCOPE_OPTIONS}
              />
              {draft.scope === "branch" ? (
                <SelectField
                  label="الفرع *"
                  value={draft.branchId}
                  onChange={(v) => setDraft((d) => ({ ...d, branchId: v }))}
                  options={[{ value: "", label: "اختر الفرع" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
                  hint="أصل مرتبط بفرع محدد (مكتب، نقطة بيع، تجهيزات فرع)"
                />
              ) : null}
              {draft.scope === "warehouse" ? (
                <TextField label="المستودع" value={draft.warehouseId} onChange={(v) => setDraft((d) => ({ ...d, warehouseId: v }))} />
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">الاقتناء</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label="تاريخ الاقتناء *"
                value={draft.acquisitionDate}
                onChange={(v) => setDraft((d) => ({ ...d, acquisitionDate: v }))}
                placeholder="YYYY-MM-DD"
              />
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">تكلفة الاقتناء *</div>
                <MoneyInput aria-label="تكلفة الاقتناء *" value={draft.acquisitionCost} onChange={(v) => setDraft((d) => ({ ...d, acquisitionCost: v }))} />
              </div>
              <TextField
                label="تاريخ بدء الإهلاك"
                value={draft.depreciationStartDate}
                onChange={(v) => setDraft((d) => ({ ...d, depreciationStartDate: v }))}
                placeholder="YYYY-MM-DD"
                hint="يفترض تاريخ الاقتناء تلقائياً إذا تُرك فارغاً"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">الإهلاك والقيمة</h3>
            <div className="flex flex-col gap-[12px]">
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">طريقة الإهلاك</div>
                <div className="rounded-md border border-border bg-surface-2 px-[13px] py-[9px] text-[13px] text-ink-muted">القسط الثابت</div>
              </div>
              <NumberField
                label="العمر الإنتاجي (شهور) *"
                value={draft.usefulLifeMonths}
                onChange={(v) => setDraft((d) => ({ ...d, usefulLifeMonths: v }))}
                min={1}
                step={1}
              />
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">القيمة المتبقية</div>
                <MoneyInput aria-label="القيمة المتبقية" value={draft.salvageValue} onChange={(v) => setDraft((d) => ({ ...d, salvageValue: v }))} />
              </div>
            </div>
          </div>

          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setFormOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              حفظ
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

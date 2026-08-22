import { useState, type FormEvent } from "react";
import { DocumentList, StatusPill, Card, Button, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { AssetCategoryDTO, CreateAssetCategoryDTO } from "@mezan/contracts";
import { ApiError, useAssetCategories, useCreateAssetCategory } from "../data/hooks";
import { NumberField, TextField } from "../settings/form-controls";

/** تصنيفات الأصول (Asset Categories) — docs/catalog/07 §"تصنيفات الأصول". List + add panel; API supports list+create only. */

const DEPRECIATION_METHOD_LABEL = "القسط الثابت";
const STATUS_TONE: Record<"active" | "inactive", PillTone> = { active: "success", inactive: "neutral" };

interface AssetCategoryDraft {
  code: string;
  nameAr: string;
  defaultUsefulLifeMonths: number;
  defaultSalvagePercent: number;
  assetAccountId: string;
  depreciationExpenseAccountId: string;
  accumulatedDepreciationAccountId: string;
  gainOnDisposalAccountId: string;
  lossOnDisposalAccountId: string;
}

function blankDraft(): AssetCategoryDraft {
  return {
    code: "",
    nameAr: "",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 0,
    assetAccountId: "",
    depreciationExpenseAccountId: "",
    accumulatedDepreciationAccountId: "",
    gainOnDisposalAccountId: "",
    lossOnDisposalAccountId: "",
  };
}

function validateDraft(draft: AssetCategoryDraft, existing: AssetCategoryDTO[]): string | null {
  const code = draft.code.trim();
  if (code === "") return "كود التصنيف مطلوب.";
  if (existing.some((c) => c.code === code)) return `الكود "${code}" مستخدم بالفعل — اختر كوداً آخر.`;
  if (draft.nameAr.trim() === "") return "اسم التصنيف مطلوب.";
  if (!Number.isFinite(draft.defaultUsefulLifeMonths) || draft.defaultUsefulLifeMonths <= 0) {
    return "العمر الإنتاجي الافتراضي يجب أن يكون رقماً أكبر من صفر.";
  }
  if (!Number.isFinite(draft.defaultSalvagePercent) || draft.defaultSalvagePercent < 0 || draft.defaultSalvagePercent > 100) {
    return "نسبة القيمة المتبقية الافتراضية يجب أن تكون بين 0 و100.";
  }
  return null;
}

export function AssetCategoriesScreen() {
  const query = useAssetCategories();
  const createAssetCategory = useCreateAssetCategory();
  const categories = query.data ?? [];

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AssetCategoryDraft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);

  const filtered = categories.filter((c) => {
    if (statusFilter === "active" && !c.active) return false;
    if (statusFilter === "inactive" && c.active) return false;
    if (search.trim() === "") return true;
    const q = search.trim().toLowerCase();
    return c.code.toLowerCase().includes(q) || c.nameAr.toLowerCase().includes(q);
  });

  function openCreateForm() {
    setDraft(blankDraft());
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const error = validateDraft(draft, categories);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const body: CreateAssetCategoryDTO = {
      id: crypto.randomUUID(),
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      defaultUsefulLifeMonths: draft.defaultUsefulLifeMonths,
      defaultSalvagePercent: draft.defaultSalvagePercent,
      assetAccountId: draft.assetAccountId.trim() === "" ? null : draft.assetAccountId.trim(),
      depreciationExpenseAccountId: draft.depreciationExpenseAccountId.trim() === "" ? null : draft.depreciationExpenseAccountId.trim(),
      accumulatedDepreciationAccountId: draft.accumulatedDepreciationAccountId.trim() === "" ? null : draft.accumulatedDepreciationAccountId.trim(),
      gainOnDisposalAccountId: draft.gainOnDisposalAccountId.trim() === "" ? null : draft.gainOnDisposalAccountId.trim(),
      lossOnDisposalAccountId: draft.lossOnDisposalAccountId.trim() === "" ? null : draft.lossOnDisposalAccountId.trim(),
    };
    try {
      await createAssetCategory.mutateAsync(body);
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّرت إضافة التصنيف.");
    }
  }

  const columns: DocumentListColumn<AssetCategoryDTO>[] = [
    { key: "code", header: "كود التصنيف", render: (c) => <span className="mz-num font-semibold text-ink">{c.code}</span> },
    { key: "nameAr", header: "الاسم", render: (c) => <span className="font-semibold text-ink">{c.nameAr}</span> },
    { key: "method", header: "طريقة الإهلاك الافتراضية", render: () => DEPRECIATION_METHOD_LABEL },
    { key: "usefulLife", header: "العمر الإنتاجي الافتراضي (شهور)", align: "end", render: (c) => <span className="mz-num">{c.defaultUsefulLifeMonths}</span> },
    {
      key: "status",
      header: "الحالة",
      render: (c) => <StatusPill label={c.active ? "نشط" : "غير نشط"} tone={STATUS_TONE[c.active ? "active" : "inactive"]} />,
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل تصنيفات الأصول.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<AssetCategoryDTO>
        eyebrow="Fixed Assets · Categories"
        title="تصنيفات الأصول"
        description="افتراضيات الإهلاك وربط الحسابات المحاسبية التي ترثها الأصول الجديدة عند تسجيلها"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة تصنيف
          </Button>
        }
        statusChips={[
          { key: "all", label: "الكل", count: categories.length },
          { key: "active", label: "نشط", count: categories.filter((c) => c.active).length },
          { key: "inactive", label: "غير نشط", count: categories.filter((c) => !c.active).length },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => setStatusFilter(key as "all" | "active" | "inactive")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالتصنيف (الكود أو الاسم)..."
        columns={columns}
        rows={filtered}
        rowKey={(c) => c.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{categories.length}</span> تصنيف
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد بيانات</div>}
      />

      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title="إضافة تصنيف" description="بيانات التصنيف الأساسية">
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[10px] font-display text-[13px] font-bold text-ink">التعريف</h3>
            <div className="flex flex-col gap-[12px]">
              <TextField label="كود التصنيف *" value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="FA-01" />
              <TextField label="اسم التصنيف *" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[4px] font-display text-[13px] font-bold text-ink">افتراضيات الإهلاك</h3>
            <p className="mb-[10px] text-[11.5px] text-ink-faint">
              تستخدم هذه القيم تلقائياً عند إنشاء أي أصل ينتمي لهذا التصنيف. يمكن تجاوزها لكل أصل على حدة.
            </p>
            <div className="flex flex-col gap-[12px]">
              <NumberField
                label="العمر الإنتاجي الافتراضي (شهور) *"
                value={draft.defaultUsefulLifeMonths}
                onChange={(v) => setDraft((d) => ({ ...d, defaultUsefulLifeMonths: v }))}
                min={1}
                step={1}
              />
              <NumberField
                label="نسبة القيمة المتبقية الافتراضية (%) *"
                value={draft.defaultSalvagePercent}
                onChange={(v) => setDraft((d) => ({ ...d, defaultSalvagePercent: v }))}
                min={0}
                max={100}
                step={0.5}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-[14px]">
            <h3 className="mb-[4px] font-display text-[13px] font-bold text-ink">ربط الحسابات المحاسبية</h3>
            <p className="mb-[10px] text-[11.5px] text-ink-faint">
              اختيار حسابات دفتر الأستاذ التي تسجل بها قيود الأصل خلال دورة حياته. اتركها فارغة لاستخدام الحسابات الافتراضية.
            </p>
            <div className="flex flex-col gap-[12px]">
              <TextField
                label="كود حساب الأصل الافتراضي"
                value={draft.assetAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, assetAccountId: v }))}
                placeholder="1500"
                hint="اتركه فارغاً لاستخدام الحساب الافتراضي: 1500 — الأصول الثابتة"
              />
              <TextField
                label="كود حساب مصروف الإهلاك الافتراضي"
                value={draft.depreciationExpenseAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, depreciationExpenseAccountId: v }))}
                placeholder="5400"
                hint="اتركه فارغاً لاستخدام الحساب الافتراضي: 5400 — إهلاك الأصول"
              />
              <TextField
                label="كود حساب مجمع الإهلاك الافتراضي"
                value={draft.accumulatedDepreciationAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, accumulatedDepreciationAccountId: v }))}
                placeholder="1590"
                hint="اتركه فارغاً لاستخدام الحساب الافتراضي: 1590 — مجمع إهلاك الأصول"
              />
              <TextField
                label="كود حساب أرباح بيع الأصول الافتراضي"
                value={draft.gainOnDisposalAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, gainOnDisposalAccountId: v }))}
                placeholder="4500"
                hint="اتركه فارغاً لاستخدام الحساب الافتراضي: 4500 — أرباح بيع الأصول"
              />
              <TextField
                label="كود حساب خسائر بيع الأصول الافتراضي"
                value={draft.lossOnDisposalAccountId}
                onChange={(v) => setDraft((d) => ({ ...d, lossOnDisposalAccountId: v }))}
                placeholder="5450"
                hint="اتركه فارغاً لاستخدام الحساب الافتراضي: 5450 — خسارة بيع الأصول"
              />
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

import { useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  DocumentList,
  IconButton,
  SidePanel,
  StatusPill,
  type DocumentListColumn,
} from "@mezan/ui";
import type { ItemSpecificationDTO, ItemSpecificationTypeDTO } from "@mezan/contracts";
import { SelectField, TextField, ToggleField } from "../settings/form-controls";
import {
  useCreateItemSpecification,
  useDeleteItemSpecification,
  useItemSpecifications,
  useUpdateItemSpecification,
} from "../data/item-catalog-hooks";

/**
 * المواصفات — the reusable specification/attribute registry over the item
 * catalog. A tenant defines its own; nothing is seeded, so an empty registry
 * is a real, correct state.
 */

const TYPE_LABEL: Record<ItemSpecificationTypeDTO, string> = {
  select: "قائمة اختيار",
  number: "رقم",
  text: "نص",
};

const TYPE_OPTIONS = (Object.keys(TYPE_LABEL) as ItemSpecificationTypeDTO[]).map((value) => ({
  value,
  label: TYPE_LABEL[value],
}));

interface Draft {
  code: string;
  nameAr: string;
  nameEn: string;
  type: ItemSpecificationTypeDTO;
  values: string;
  unit: string;
  filterable: boolean;
  active: boolean;
}

function blankDraft(): Draft {
  return { code: "", nameAr: "", nameEn: "", type: "select", values: "", unit: "", filterable: false, active: true };
}

function draftOf(specification: ItemSpecificationDTO): Draft {
  return {
    code: specification.code,
    nameAr: specification.nameAr,
    nameEn: specification.nameEn ?? "",
    type: specification.type,
    values: specification.values.join("، "),
    unit: specification.unit ?? "",
    filterable: specification.filterable,
    active: specification.status === "active",
  };
}

function parseValues(raw: string): string[] {
  return raw
    .split(/[،,\n]/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function validate(draft: Draft): string | null {
  if (!/^[A-Z0-9_-]{1,20}$/.test(draft.code.trim())) {
    return "الكود مطلوب — حروف إنجليزية كبيرة أو أرقام أو - أو _ (20 حرفاً كحد أقصى).";
  }
  if (draft.nameAr.trim() === "") return "الاسم بالعربية مطلوب.";
  if (draft.type === "select" && parseValues(draft.values).length === 0) {
    return "قائمة الاختيار تحتاج قيمة واحدة على الأقل.";
  }
  return null;
}

function valuesCell(specification: ItemSpecificationDTO) {
  if (specification.type === "select") {
    if (specification.values.length === 0) return <span className="text-ink-faint">—</span>;
    return (
      <div className="flex flex-wrap gap-[6px]">
        {specification.values.map((value) => (
          <span
            key={value}
            className="rounded-pill border border-border bg-surface-2 px-[9px] py-[2px] text-[11.5px] text-ink-muted"
          >
            {value}
          </span>
        ))}
      </div>
    );
  }
  if (specification.type === "number") {
    return specification.unit ? <span>{specification.unit}</span> : <span className="text-ink-faint">بدون وحدة</span>;
  }
  return <span className="text-ink-faint">—</span>;
}

export function ItemSpecificationsScreen() {
  const query = useItemSpecifications();
  const createSpecification = useCreateItemSpecification();
  const updateSpecification = useUpdateItemSpecification();
  const deleteSpecification = useDeleteItemSpecification();

  const specifications = query.data ?? [];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemSpecificationTypeDTO | "all">("all");
  const [panelOpen, setPanelOpen] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let rows = specifications;
    if (typeFilter !== "all") rows = rows.filter((s) => s.type === typeFilter);
    const q = search.trim();
    if (q !== "") {
      rows = rows.filter((s) => s.code.toLowerCase().includes(q.toLowerCase()) || s.nameAr.includes(q));
    }
    return rows;
  }, [specifications, typeFilter, search]);

  function openCreate() {
    setEditingCode(null);
    setDraft(blankDraft());
    setFormError(null);
    setPanelOpen(true);
  }

  function openEdit(specification: ItemSpecificationDTO) {
    setEditingCode(specification.code);
    setDraft(draftOf(specification));
    setFormError(null);
    setPanelOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const error = validate(draft);
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    const values = draft.type === "select" ? parseValues(draft.values) : [];
    const unit = draft.type === "number" && draft.unit.trim() !== "" ? draft.unit.trim() : null;
    const nameEn = draft.nameEn.trim() === "" ? null : draft.nameEn.trim();
    try {
      if (editingCode) {
        await updateSpecification.mutateAsync({
          code: editingCode,
          patch: {
            nameAr: draft.nameAr.trim(),
            nameEn,
            values,
            unit,
            filterable: draft.filterable,
            status: draft.active ? "active" : "inactive",
          },
        });
      } else {
        await createSpecification.mutateAsync({
          code: draft.code.trim(),
          nameAr: draft.nameAr.trim(),
          nameEn,
          type: draft.type,
          values,
          unit,
          filterable: draft.filterable,
        });
      }
      setPanelOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "تعذّرت العملية.");
    }
  }

  async function remove(specification: ItemSpecificationDTO) {
    if (deletingCode) return;
    setDeletingCode(specification.code);
    setRowError(null);
    try {
      await deleteSpecification.mutateAsync(specification.code);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "تعذّر حذف المواصفة.");
    } finally {
      setDeletingCode(null);
    }
  }

  const columns: DocumentListColumn<ItemSpecificationDTO>[] = [
    {
      key: "nameAr",
      header: "الاسم",
      render: (s) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-[8px] font-semibold text-ink">
            {s.nameAr}
            {s.status === "active" ? null : <StatusPill label="غير نشطة" tone="neutral" />}
          </span>
          <span className="font-mono text-[11.5px] text-ink-faint">{s.code}</span>
        </div>
      ),
    },
    { key: "type", header: "النوع", render: (s) => TYPE_LABEL[s.type] },
    { key: "values", header: "القيم / الوحدة", render: valuesCell },
    {
      key: "filterable",
      header: "قابلة للتصفية في الكتالوج",
      render: (s) => (
        <StatusPill label={s.filterable ? "نعم" : "لا"} tone={s.filterable ? "success" : "neutral"} />
      ),
    },
    {
      key: "usage",
      header: "الاستخدام",
      align: "end",
      render: (s) => <span className="mz-num">{s.usageCount}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (s) => (
        <div className="flex items-center justify-end gap-[6px]">
          <Button size="sm" onClick={() => openEdit(s)}>
            تعديل
          </Button>
          <IconButton
            aria-label={`حذف ${s.nameAr}`}
            disabled={deletingCode !== null || s.usageCount > 0}
            onClick={() => remove(s)}
          >
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
              <path
                d="M4 6h12M8 6V4h4v2m-6 0 .7 9.1A1 1 0 0 0 7.7 16h4.6a1 1 0 0 0 1-.9L14 6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل المواصفات.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div
          role="alert"
          className="mb-[18px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
        >
          {rowError}
        </div>
      ) : null}

      <DocumentList<ItemSpecificationDTO>
        eyebrow="Inventory · Specifications"
        title="المواصفات"
        description="سجل المواصفات القابلة لإعادة الاستخدام — قوائم اختيار وأرقام ونصوص تبني عليها قوالب المنتجات"
        actions={
          <Button variant="primary" onClick={openCreate}>
            مواصفة جديدة
          </Button>
        }
        stats={[
          { label: "إجمالي المواصفات", value: <span className="mz-num">{specifications.length}</span> },
          {
            label: "قابلة للتصفية",
            value: <span className="mz-num">{specifications.filter((s) => s.filterable).length}</span>,
          },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: specifications.length },
          { key: "select", label: TYPE_LABEL.select, count: specifications.filter((s) => s.type === "select").length },
          { key: "number", label: TYPE_LABEL.number, count: specifications.filter((s) => s.type === "number").length },
          { key: "text", label: TYPE_LABEL.text, count: specifications.filter((s) => s.type === "text").length },
        ]}
        activeStatusKey={typeFilter}
        onStatusChange={(key) => setTypeFilter(key as ItemSpecificationTypeDTO | "all")}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث بالكود أو الاسم…"
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.code}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من{" "}
            <span className="mz-num">{specifications.length}</span> مواصفة
          </>
        }
        emptyState={
          <div className="p-8 text-center text-sm text-ink-muted">
            {query.isLoading ? "جارِ التحميل…" : "لا توجد مواصفات — أضف مواصفة جديدة"}
          </div>
        }
      />

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editingCode ? "تعديل المواصفة" : "مواصفة جديدة"}
        description="النوع والكود لا يتغيران بعد الحفظ — قوالب المنتجات ترتبط بهما"
      >
        <form onSubmit={submit} className="flex flex-col gap-[14px] p-5">
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
            >
              {formError}
            </div>
          ) : null}

          <TextField
            label="الكود *"
            value={draft.code}
            onChange={(v) => setDraft((d) => ({ ...d, code: v.toUpperCase() }))}
            disabled={editingCode !== null}
            hint="حروف إنجليزية كبيرة أو أرقام أو - أو _"
          />
          <TextField
            label="الاسم بالعربية *"
            value={draft.nameAr}
            onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
          />
          <TextField
            label="الاسم بالإنجليزية"
            value={draft.nameEn}
            onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))}
          />
          <SelectField
            label="النوع"
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as ItemSpecificationTypeDTO }))}
            options={TYPE_OPTIONS}
            disabled={editingCode !== null}
          />
          {draft.type === "select" ? (
            <TextField
              label="القيم المسموح بها *"
              value={draft.values}
              onChange={(v) => setDraft((d) => ({ ...d, values: v }))}
              placeholder="احمر، اخضر، ازرق"
              hint="افصل بين القيم بفاصلة"
            />
          ) : null}
          {draft.type === "number" ? (
            <TextField
              label="الوحدة"
              value={draft.unit}
              onChange={(v) => setDraft((d) => ({ ...d, unit: v }))}
              placeholder="كجم"
            />
          ) : null}
          <ToggleField
            label="قابلة للتصفية في الكتالوج"
            checked={draft.filterable}
            onChange={(v) => setDraft((d) => ({ ...d, filterable: v }))}
          />
          <ToggleField
            label="نشطة"
            checked={draft.active}
            onChange={(v) => setDraft((d) => ({ ...d, active: v }))}
          />

          <div className="flex justify-end gap-[9px]">
            <Button type="button" onClick={() => setPanelOpen(false)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={createSpecification.isPending || updateSpecification.isPending}
            >
              حفظ
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

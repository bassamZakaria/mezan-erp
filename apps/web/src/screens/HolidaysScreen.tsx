import { useMemo, useState, type FormEvent } from "react";
import { Button, Card, Chip, DocumentList, IconButton, SidePanel, StatusPill, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { HolidayDTO } from "@mezan/contracts";
import { TextField, ToggleField } from "../settings/form-controls";
import { ApiError, useCreateHoliday, useDeleteHoliday, useHolidays, useUpdateHoliday } from "../data/hooks";

/** الإجازات الرسمية (Official Holidays) — docs/catalog/06 §"الإجازات الرسمية". Year-scoped company calendar; recurring holidays repeat every year. */

const CURRENT_YEAR = new Date().getUTCFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1];

interface HolidayDraft {
  date: string;
  nameEn: string;
  nameAr: string;
  recurringAnnual: boolean;
}

function blankDraft(year: number): HolidayDraft {
  return { date: `${year}-01-01`, nameEn: "", nameAr: "", recurringAnnual: false };
}

function TrashIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6m-6.5 0 .6 9a1 1 0 0 0 1 .9h5.8a1 1 0 0 0 1-.9l.6-9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[14px] w-[14px]">
      <path
        d="M13.5 3.5 16 6l-8.5 8.5H5V12L13.5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HolidaysScreen() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const query = useHolidays(year);
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const holidays = query.data ?? [];

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<HolidayDraft>(blankDraft(year));
  const [formError, setFormError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const editing = editingId ? (holidays.find((h) => h.id === editingId) ?? null) : null;

  const recurringCount = useMemo(() => holidays.filter((h) => h.recurringAnnual).length, [holidays]);

  function openCreateForm() {
    setDraft(blankDraft(year));
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(holiday: HolidayDTO) {
    setEditingId(holiday.id);
    setDraft({ date: holiday.date, nameEn: holiday.nameEn, nameAr: holiday.nameAr ?? "", recurringAnnual: holiday.recurringAnnual });
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (draft.date.trim() === "" || draft.nameEn.trim() === "") {
      setFormError("التاريخ والاسم بالإنجليزية مطلوبان.");
      return;
    }
    setFormError(null);
    const body = {
      date: draft.date.trim(),
      nameEn: draft.nameEn.trim(),
      nameAr: draft.nameAr.trim() === "" ? null : draft.nameAr.trim(),
      recurringAnnual: draft.recurringAnnual,
    };
    try {
      if (editingId) {
        await updateHoliday.mutateAsync({ id: editingId, body });
        setEditingId(null);
      } else {
        await createHoliday.mutateAsync(body);
        setFormOpen(false);
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "تعذّرت العملية.");
    }
  }

  async function handleDelete(holiday: HolidayDTO) {
    if (deletingId) return;
    setDeletingId(holiday.id);
    setRowError(null);
    try {
      await deleteHoliday.mutateAsync(holiday.id);
    } catch (err) {
      setRowError(err instanceof ApiError ? err.message : "تعذّر حذف الإجازة.");
    } finally {
      setDeletingId(null);
    }
  }

  const columns: DocumentListColumn<HolidayDTO>[] = [
    { key: "date", header: "التاريخ", render: (h) => <span className="mz-num font-semibold text-ink">{h.date}</span> },
    { key: "name", header: "الاسم", render: (h) => <span className="font-semibold text-ink">{h.nameAr ?? h.nameEn}</span> },
    {
      key: "type",
      header: "النوع",
      render: (h) => <StatusPill label={h.recurringAnnual ? "سنوية" : "لمرة واحدة"} tone={(h.recurringAnnual ? "info" : "neutral") as PillTone} />,
    },
    {
      key: "actions",
      header: "",
      align: "end",
      render: (h) => (
        <div className="flex items-center justify-end gap-[6px]">
          <IconButton aria-label={`تعديل ${h.nameAr ?? h.nameEn}`} onClick={() => openEdit(h)}>
            <EditIcon />
          </IconButton>
          <IconButton aria-label={`حذف ${h.nameAr ?? h.nameEn}`} disabled={deletingId !== null} onClick={() => handleDelete(h)}>
            <TrashIcon />
          </IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل الإجازات الرسمية.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      {rowError ? (
        <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {rowError}
        </div>
      ) : null}

      <div className="mb-[14px] flex flex-wrap gap-[6px]" role="group" aria-label="السنة">
        {YEAR_OPTIONS.map((y) => (
          <Chip key={y} type="button" active={year === y} onClick={() => setYear(y)}>
            <span className="mz-num">{y}</span>
          </Chip>
        ))}
      </div>

      <DocumentList<HolidayDTO>
        eyebrow="HR · Holidays"
        title="الإجازات الرسمية"
        description="التقويم الرسمي للشركة، يُستخدم لاستبعاد الإجازات من حسابات الحضور والإجازات"
        actions={
          <Button variant="primary" onClick={openCreateForm}>
            إضافة إجازة
          </Button>
        }
        stats={[
          { label: "إجمالي الإجازات", value: <span className="mz-num">{holidays.length}</span> },
          { label: "سنوية", value: <span className="mz-num">{recurringCount}</span> },
          { label: "لمرة واحدة", value: <span className="mz-num">{holidays.length - recurringCount}</span> },
        ]}
        columns={columns}
        rows={holidays}
        rowKey={(h) => h.id}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{holidays.length}</span> إجازة لعام <span className="mz-num">{year}</span>
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد إجازات رسمية لهذا العام</div>}
      />

      <SidePanel
        open={formOpen || editingId !== null}
        onClose={() => {
          setFormOpen(false);
          setEditingId(null);
        }}
        title={editing ? "تعديل إجازة" : "إضافة إجازة"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-[14px]">
          {formError ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {formError}
            </div>
          ) : null}
          <TextField label="التاريخ *" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} placeholder="YYYY-MM-DD" />
          <TextField label="الاسم بالإنجليزية *" value={draft.nameEn} onChange={(v) => setDraft((d) => ({ ...d, nameEn: v }))} placeholder="National Day" />
          <TextField label="الاسم بالعربية" value={draft.nameAr} onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))} placeholder="اليوم الوطني" />
          <ToggleField label="إجازة سنوية متكررة" checked={draft.recurringAnnual} onChange={(v) => setDraft((d) => ({ ...d, recurringAnnual: v }))} />
          <div className="mt-[6px] flex justify-end gap-[9px]">
            <Button
              type="button"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              إلغاء
            </Button>
            <Button type="submit" variant="primary">
              {editing ? "حفظ التعديلات" : "إضافة"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </div>
  );
}

import { useMemo, useState } from "react";
import {
  DocumentList,
  DocumentDetail,
  DocumentStatusStepper,
  Money as MoneyDisplay,
  StatusPill,
  Chip,
  Card,
  Button,
  IconButton,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
} from "@mezan/ui";
import { Money } from "@mezan/domain";
import type { CreateGlJournalEntryDTO, JournalEntryStatusDTO } from "@mezan/contracts";
import { useAccounts, useCreateJournalEntry, useJournalEntries, useReverseJournalEntry, type JournalEntryDTO } from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";

/** القيود المحاسبية (Journal Entries) — docs/catalog/04. List + detail + create, on the real GL posting engine (/gl). */

type JournalDoc = JournalEntryDTO;

const STATUS_LABEL: Record<JournalEntryStatusDTO, string> = {
  draft: "مسودة",
  pending: "بانتظار الموافقة",
  posted: "مرحل",
  reversed: "معكوس",
};
const STATUS_TONE: Record<JournalEntryStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  posted: "success",
  reversed: "danger",
};

const STEPPER_STEPS: DocumentStatusStep[] = [
  { key: "draft", label: "مسودة" },
  { key: "pending", label: "بانتظار الموافقة" },
  { key: "posted", label: "مرحل" },
  { key: "reversed", label: "معكوس" },
];

function toMajor(value: string): number {
  return Number(value);
}

function docTotals(doc: JournalDoc): { debit: number; credit: number } {
  return {
    debit: doc.lines.reduce((sum, l) => sum + toMajor(l.debit), 0),
    credit: doc.lines.reduce((sum, l) => sum + toMajor(l.credit), 0),
  };
}

/* -------------------------------------------------------------------- */
/* Create form line state                                               */
/* -------------------------------------------------------------------- */

interface LineDraft {
  key: string;
  accountId: string;
  memo: string;
  debit: number;
  credit: number;
}

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `l${lineSeq}`, accountId: "", memo: "", debit: 0, credit: 0 };
}

export function JournalsScreen() {
  const query = useJournalEntries();
  const accountsQuery = useAccounts();
  const createJournalEntry = useCreateJournalEntry();
  const reverseJournalEntry = useReverseJournalEntry();
  const accounts = accountsQuery.data ?? [];

  const [mode, setMode] = useState<"list" | "create" | "detail">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | JournalEntryStatusDTO>("all");

  const accountLabel = useMemo(() => {
    const map = new Map(accounts.map((a) => [a.id, `${a.code} — ${a.nameAr}`]));
    return (id: string) => map.get(id) ?? id;
  }, [accounts]);

  const documents = query.data ?? [];

  const counts = useMemo(() => {
    const c = { all: documents.length, draft: 0, pending: 0, posted: 0, reversed: 0 };
    for (const d of documents) {
      if (d.status === "draft") c.draft += 1;
      else if (d.status === "pending") c.pending += 1;
      else if (d.status === "posted") c.posted += 1;
      else if (d.status === "reversed") c.reversed += 1;
    }
    return c;
  }, [documents]);

  const filtered = useMemo(() => {
    let rows = documents;
    if (statusFilter !== "all") rows = rows.filter((d) => d.status === statusFilter);
    if (search.trim() !== "") {
      const q = search.trim().toLowerCase();
      rows = rows.filter((d) => (d.entryNo ?? "").toLowerCase().includes(q) || d.memo.toLowerCase().includes(q));
    }
    return rows;
  }, [documents, statusFilter, search]);

  const selected = selectedId ? documents.find((d) => d.id === selectedId) ?? null : null;

  const columns: DocumentListColumn<JournalDoc>[] = [
    {
      key: "entryNo",
      header: "رقم القيد",
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.entryNo ?? "—"}</span>,
    },
    { key: "date", header: "التاريخ", sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    { key: "memo", header: "البيان", render: (d) => <span className="text-ink">{d.memo}</span> },
    { key: "debit", header: "إجمالي المدين", align: "end", render: (d) => <MoneyDisplay value={docTotals(d).debit} /> },
    { key: "status", header: "الحالة", render: (d) => <StatusPill label={STATUS_LABEL[d.status]} tone={STATUS_TONE[d.status]} /> },
  ];

  function openDetail(id: string) {
    setSelectedId(id);
    setMode("detail");
  }

  if (mode === "create") {
    return (
      <CreateJournalView
        onPost={(body) => createJournalEntry.mutateAsync(body)}
        accountOptions={accounts.map((a) => ({ value: a.id, label: `${a.code} — ${a.nameAr}` }))}
        onDone={() => setMode("list")}
      />
    );
  }

  if (mode === "detail" && selected) {
    const totals = docTotals(selected);
    const balanced = Math.abs(totals.debit - totals.credit) < 0.005;
    return (
      <div className="w-full">
        <DocumentDetail
          title={selected.entryNo ?? "قيد يومية"}
          statusLabel={STATUS_LABEL[selected.status]}
          statusTone={STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_STEPS} currentKey={selected.status} tone={selected.status === "reversed" ? "danger" : "brand"} />}
          actions={
            <>
              <Button onClick={() => setMode("list")}>رجوع</Button>
              {selected.status === "posted" ? (
                <Button
                  variant="danger-outline"
                  onClick={async () => {
                    await reverseJournalEntry.mutateAsync({ id: selected.id });
                    setMode("list");
                  }}
                >
                  عكس القيد
                </Button>
              ) : null}
            </>
          }
          summary={[
            { label: "التاريخ", value: <span className="mz-num">{selected.date}</span> },
            { label: "المصدر", value: "يدوي" },
            { label: "عدد البنود", value: <span className="mz-num">{selected.lines.length}</span> },
            { label: "إجمالي المدين", value: <MoneyDisplay value={totals.debit} /> },
            { label: "إجمالي الدائن", value: <MoneyDisplay value={totals.credit} /> },
            { label: "التوازن", value: balanced ? "متوازن ✓" : "غير متوازن", valueTone: balanced ? "success" : "danger" },
          ]}
          tabs={[
            {
              key: "lines",
              label: "بنود القيد",
              content: (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الحساب</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">البيان</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">مدين</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">دائن</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.lines.map((l, i) => (
                          <tr key={i} className="border-b border-border last:border-b-0">
                            <td className="px-[15px] py-[11px] text-ink">{accountLabel(l.accountId)}</td>
                            <td className="px-[15px] py-[11px] text-ink-muted">{l.memo ?? "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{toMajor(l.debit) !== 0 ? <MoneyDisplay value={toMajor(l.debit)} /> : "—"}</td>
                            <td className="px-[15px] py-[11px] text-end">{toMajor(l.credit) !== 0 ? <MoneyDisplay value={toMajor(l.credit)} /> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-surface-2 font-bold">
                          <td className="px-[15px] py-[11px]" colSpan={2}>
                            <StatusPill label={balanced ? "متوازن ✓" : "غير متوازن"} tone={balanced ? "success" : "danger"} />
                          </td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={totals.debit} /></td>
                          <td className="px-[15px] py-[11px] text-end"><MoneyDisplay value={totals.credit} /></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
              ),
            },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">تعذّر تحميل القيود المحاسبية.</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : null}
      <DocumentList<JournalDoc>
        eyebrow="Accounting · Journal Entries"
        title="القيود المحاسبية"
        description="سجل القيود المحاسبية — مسودة ← بانتظار الموافقة ← مرحل ← معكوس، على المحرك المحاسبي الحقيقي"
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            قيد جديد
          </Button>
        }
        stats={[
          { label: "إجمالي القيود", value: <span className="mz-num">{counts.all}</span> },
          { label: "مرحل", value: <span className="mz-num">{counts.posted}</span> },
          { label: "معكوس", value: <span className="mz-num">{counts.reversed}</span> },
          { label: "مسودة", value: <span className="mz-num">{counts.draft}</span> },
        ]}
        statusChips={[
          { key: "all", label: "الكل", count: counts.all },
          { key: "draft", label: "مسودة", count: counts.draft },
          { key: "posted", label: "مرحل", count: counts.posted },
          { key: "reversed", label: "معكوس", count: counts.reversed },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | JournalEntryStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم القيد..."
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            عرض <span className="mz-num">{filtered.length}</span> من <span className="mz-num">{counts.all}</span> قيد
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">لا توجد قيود مطابقة</div>}
      />
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Create view                                                          */
/* -------------------------------------------------------------------- */

function CreateJournalView({
  onPost,
  accountOptions,
  onDone,
}: {
  onPost: (body: CreateGlJournalEntryDTO) => Promise<unknown>;
  accountOptions: { value: string; label: string }[];
  onDone: () => void;
}) {
  const [date, setDate] = useState("2026-08-22");
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine(), blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  // Exact balance check via Money (no float drift) — the same invariant the domain enforces.
  const balanced = Money.fromMajor(String(totalDebit)).equals(Money.fromMajor(String(totalCredit))) && totalDebit > 0;
  const allLinesValid = lines.every((l) => l.accountId !== "" && (l.debit > 0) !== (l.credit > 0));
  const canPost = balanced && allLinesValid && memo.trim() !== "" && !busy;

  const options = useMemo(() => [{ value: "", label: "اختر حساب..." }, ...accountOptions], [accountOptions]);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  async function handlePost() {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await onPost({
        id: crypto.randomUUID(),
        date,
        memo: memo.trim(),
        lines: lines.map((l) => ({
          accountId: l.accountId,
          debit: String(l.debit || 0),
          credit: String(l.credit || 0),
          memo: l.memo.trim() === "" ? null : l.memo.trim(),
        })),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر ترحيل القيد.");
    } finally {
      setBusy(false);
    }
  }

  const difference = Math.abs(totalDebit - totalCredit);

  return (
    <div className="w-full">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <div className="font-lat text-[10.5px] font-semibold uppercase tracking-[1.6px] text-accent-strong">Accounting · New Journal Entry</div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">إنشاء قيد يومي</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>إلغاء</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            ترحيل القيد
          </Button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-2">
            <TextField label="تاريخ القيد *" value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <TextField label="الوصف *" value={memo} onChange={setMemo} placeholder="وصف القيد..." />
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">الحساب</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">البيان</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">مدين</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">دائن</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[8px]">
                        <select
                          aria-label={`الحساب للسطر ${i + 1}`}
                          value={line.accountId}
                          onChange={(e) => updateLine(i, { accountId: e.target.value })}
                          className="w-full min-w-[160px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                        >
                          {options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <input
                          aria-label={`البيان للسطر ${i + 1}`}
                          value={line.memo}
                          onChange={(e) => updateLine(i, { memo: e.target.value })}
                          placeholder="وصف البند..."
                          className="w-full min-w-[120px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-[12.5px] text-ink outline-none focus:border-brand"
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <input
                          type="number"
                          aria-label={`مدين للسطر ${i + 1}`}
                          value={line.debit || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { debit: e.target.valueAsNumber || 0, credit: 0 })}
                          className="mz-num w-[110px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand"
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <input
                          type="number"
                          aria-label={`دائن للسطر ${i + 1}`}
                          value={line.credit || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { credit: e.target.valueAsNumber || 0, debit: 0 })}
                          className="mz-num w-[110px] rounded-md border border-border bg-surface px-[10px] py-[7px] text-end text-[12.5px] text-ink outline-none focus:border-brand"
                        />
                      </td>
                      <td className="px-[12px] py-[8px] text-center">
                        <IconButton aria-label={`حذف السطر ${i + 1}`} disabled={lines.length <= 2} onClick={() => removeLine(i)}>
                          ✕
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border p-[12px]">
              <Button size="sm" onClick={addLine}>
                إضافة سطر
              </Button>
            </div>
          </Card>
        </div>

        {/* Live balance + effects panel */}
        <div className="flex flex-col gap-[16px]">
          <Card className="p-[16px_18px]">
            <h3 className="mb-[12px] font-display text-[14px] font-bold text-ink">التوازن</h3>
            <dl className="flex flex-col gap-[8px] text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">إجمالي المدين</dt>
                <dd><MoneyDisplay value={totalDebit} /></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">إجمالي الدائن</dt>
                <dd><MoneyDisplay value={totalCredit} /></dd>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-[8px]">
                <dt className="text-ink-muted">الفرق</dt>
                <dd className={difference === 0 ? "text-success-ink" : "text-danger-ink"}>
                  <MoneyDisplay value={difference} />
                </dd>
              </div>
            </dl>
            <div className="mt-[12px]">
              <StatusPill label={balanced ? "متوازن ✓" : "غير متوازن"} tone={balanced ? "success" : "danger"} />
            </div>
          </Card>

          <div
            className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
            style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
          >
            <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">تأثيرات هذا المستند</h3>
            <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                يُنشئ قيداً محاسبياً مرحّلاً من {lines.length} بند
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                يُحدّث أرصدة الحسابات في دفتر الأستاذ عند الترحيل
              </li>
              {!balanced ? (
                <li className="flex items-start gap-[8px] text-danger-ink">
                  <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-danger" />
                  القيد غير متوازن — زر الترحيل معطّل حتى يتساوى المدين والدائن
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

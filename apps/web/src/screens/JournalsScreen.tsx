import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentDetail,
  DocumentList,
  DocumentStatusStepper,
  FulcrumRule,
  IconButton,
  Money as MoneyDisplay,
  Select,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type DocumentStatusStep,
  type PillTone,
} from "@mezan/ui";
import { Money } from "@mezan/domain";
import type { CreateGlJournalEntryDTO, JournalEntryStatusDTO } from "@mezan/contracts";
import { useAccounts, useCreateJournalEntry, useJournalEntries, useReverseJournalEntry, type JournalEntryDTO } from "../data/hooks";
import { SelectField, TextField } from "../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { sumMajor } from "../lib/money";

/** القيود المحاسبية (Journal Entries) — docs/catalog/04. List + detail + create, on the real GL posting engine (/gl). */

type JournalDoc = JournalEntryDTO;

const STATUS_KEY: Record<JournalEntryStatusDTO, AppTranslationKey> = {
  draft: "journals.status.draft",
  pending: "journals.status.pending",
  posted: "journals.status.posted",
  reversed: "journals.status.reversed",
};
const STATUS_TONE: Record<JournalEntryStatusDTO, PillTone> = {
  draft: "neutral",
  pending: "warning",
  posted: "success",
  reversed: "danger",
};

/** Keys, not copy — the stepper's labels are built with the translator at render. */
const STEPPER_KEYS = [
  { key: "draft", labelKey: "journals.status.draft" },
  { key: "pending", labelKey: "journals.status.pending" },
  { key: "posted", labelKey: "journals.status.posted" },
  { key: "reversed", labelKey: "journals.status.reversed" },
] as const;

function toMajor(value: string): number {
  return Number(value);
}

function docTotals(doc: JournalDoc): { debit: number; credit: number } {
  return {
    debit: sumMajor(doc.lines.map((l) => l.debit)),
    credit: sumMajor(doc.lines.map((l) => l.credit)),
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
  const { t } = useAppTranslation();
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
      header: t("journals.entryNumber"),
      sortable: true,
      render: (d) => <span className="mz-num font-semibold text-ink">{d.entryNo ?? "—"}</span>,
    },
    { key: "date", header: t("common.date"), sortable: true, render: (d) => <span className="mz-num text-ink-muted">{d.date}</span> },
    { key: "memo", header: t("journals.description"), render: (d) => <span className="text-ink">{d.memo}</span> },
    { key: "debit", header: t("journals.totalDebit"), align: "end", render: (d) => <MoneyDisplay value={docTotals(d).debit} /> },
    { key: "status", header: t("common.status"), render: (d) => <StatusPill label={t(STATUS_KEY[d.status])} tone={STATUS_TONE[d.status]} /> },
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
          title={selected.entryNo ?? t("journals.journalEntry")}
          statusLabel={t(STATUS_KEY[selected.status])}
          statusTone={STATUS_TONE[selected.status]}
          subtitle={<DocumentStatusStepper steps={STEPPER_KEYS.map((step): DocumentStatusStep => ({ key: step.key, label: t(step.labelKey) }))} currentKey={selected.status} tone={selected.status === "reversed" ? "danger" : "brand"} />}
          actions={
            <>
              <Button onClick={() => setMode("list")}>{t("common.back")}</Button>
              {selected.status === "posted" ? (
                <Button
                  variant="danger-outline"
                  onClick={async () => {
                    await reverseJournalEntry.mutateAsync({ id: selected.id });
                    setMode("list");
                  }}
                >
                  {t("journals.reverseEntry")}
                </Button>
              ) : null}
            </>
          }
          summary={[
            { label: t("common.date"), value: <span className="mz-num">{selected.date}</span> },
            { label: t("journals.source"), value: t("journals.manual") },
            { label: t("journals.lines"), value: <span className="mz-num">{selected.lines.length}</span> },
            { label: t("journals.totalDebit"), value: <MoneyDisplay value={totals.debit} /> },
            { label: t("journals.totalCredit"), value: <MoneyDisplay value={totals.credit} /> },
            { label: t("journals.balance"), value: balanced ? t("journals.balanced") : t("journals.outOfBalance"), valueTone: balanced ? "success" : "danger" },
          ]}
          tabs={[
            {
              key: "lines",
              label: t("journals.entryLines"),
              content: (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.account")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.description")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                          <th scope="col" className="border-b border-border bg-surface-2 px-[15px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
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
                            <StatusPill label={balanced ? t("journals.balanced") : t("journals.outOfBalance")} tone={balanced ? "success" : "danger"} />
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
          <p className="text-[13px] font-semibold text-danger-ink">{t("journals.journalEntriesCouldNotBe")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<JournalDoc>
        title={t("journals.journalEntries")}
        description={t("journals.theJournalRegisterDraftAwaiting")}
        actions={
          <Button variant="primary" onClick={() => setMode("create")}>
            {t("journals.newEntry")}
          </Button>
        }
        stats={[
          { label: t("journals.totalEntries"), value: <span className="mz-num">{counts.all}</span> },
          { label: t("docStatus.posted"), value: <span className="mz-num">{counts.posted}</span> },
          { label: t("docStatus.reversed"), value: <span className="mz-num">{counts.reversed}</span> },
          { label: t("docStatus.draft"), value: <span className="mz-num">{counts.draft}</span> },
        ]}
        statusChips={[
          { key: "all", label: t("common.all"), count: counts.all },
          { key: "draft", label: t("docStatus.draft"), count: counts.draft },
          { key: "posted", label: t("docStatus.posted"), count: counts.posted },
          { key: "reversed", label: t("docStatus.reversed"), count: counts.reversed },
        ]}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => setStatusFilter(k as "all" | JournalEntryStatusDTO)}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("journals.searchByEntryNumber")}
        columns={columns}
        rows={filtered}
        rowKey={(d) => d.id}
        onRowClick={(d) => openDetail(d.id)}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{filtered.length}</span> {t("common.of")} <span className="mz-num">{counts.all}</span> {t("journals.entries")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("journals.noMatchingEntries")}</div>}
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
  const { t } = useAppTranslation();
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

  const options = useMemo(() => [{ value: "", label: t("journals.chooseAnAccount") }, ...accountOptions], [accountOptions]);

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
      setError(err instanceof Error ? err.message : t("journals.theEntryCouldNotBe"));
    } finally {
      setBusy(false);
    }
  }

  const difference = Math.abs(totalDebit - totalCredit);

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("journals.createAJournalEntry")}</h1>
        </div>
        <div className="flex items-center gap-[9px]">
          <Button onClick={onDone}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!canPost} onClick={handlePost}>
            {t("journals.postEntry")}
          </Button>
        </div>
      </div>
      <FulcrumRule />

      {error ? (
        <div role="alert" className="mb-[16px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-[16px]">
          <Card className="grid grid-cols-1 gap-[14px] p-[18px] sm:grid-cols-2">
            <TextField label={t("journals.entryDate")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
            <TextField label={t("journals.description2")} value={memo} onChange={setMemo} placeholder={t("journals.describeTheEntry")} />
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.account")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-start text-[11px] font-bold uppercase text-ink-muted">{t("journals.description")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.debit")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px] text-end text-[11px] font-bold uppercase text-ink-muted">{t("common.credit")}</th>
                    <th scope="col" className="border-b border-border bg-surface-2 px-[12px] py-[10px]" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-b border-border last:border-b-0">
                      <td className="px-[12px] py-[8px]">
                        <Select
                          size="sm"
                          className="min-w-[160px]"
                          aria-label={t("journals.lineAccount", { number: i + 1 })}
                          value={line.accountId}
                          onChange={(value) => updateLine(i, { accountId: value })}
                          options={options}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          size="sm"
                          className="min-w-[120px]"
                          aria-label={t("journals.memoLabel", { n: String(i + 1) })}
                          value={line.memo}
                          onChange={(e) => updateLine(i, { memo: e.target.value })}
                          placeholder={t("journals.describeTheLine")}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("journals.debitLabel", { n: String(i + 1) })}
                          value={line.debit || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { debit: e.target.valueAsNumber || 0, credit: 0 })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px]">
                        <TextInput
                          type="number"
                          size="sm"
                          numeric
                          className="w-[110px] text-end"
                          aria-label={t("journals.creditLabel", { n: String(i + 1) })}
                          value={line.credit || ""}
                          min={0}
                          onChange={(e) => updateLine(i, { credit: e.target.valueAsNumber || 0, debit: 0 })}
                        />
                      </td>
                      <td className="px-[12px] py-[8px] text-center">
                        <IconButton aria-label={t("journals.removeLineLabel", { n: String(i + 1) })} disabled={lines.length <= 2} onClick={() => removeLine(i)}>
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
                {t("journals.addLine")}
              </Button>
            </div>
          </Card>
        </div>

        {/* Live balance + effects panel */}
        <div className="flex flex-col gap-[16px]">
          <Card className="p-[16px_18px]">
            <h3 className="mb-[12px] font-display text-[14px] font-bold text-ink">{t("journals.balance")}</h3>
            <dl className="flex flex-col gap-[8px] text-[13px]">
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("journals.totalDebit")}</dt>
                <dd><MoneyDisplay value={totalDebit} /></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-muted">{t("journals.totalCredit")}</dt>
                <dd><MoneyDisplay value={totalCredit} /></dd>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-[8px]">
                <dt className="text-ink-muted">{t("journals.difference")}</dt>
                <dd className={difference === 0 ? "text-success-ink" : "text-danger-ink"}>
                  <MoneyDisplay value={difference} />
                </dd>
              </div>
            </dl>
            <div className="mt-[12px]">
              <StatusPill label={balanced ? t("journals.balanced") : t("journals.outOfBalance")} tone={balanced ? "success" : "danger"} />
            </div>
          </Card>

          <div
            className="rounded-lg border border-[color-mix(in_srgb,var(--brand)_26%,transparent)] p-[16px_18px]"
            style={{ background: "linear-gradient(180deg, var(--brand-soft), color-mix(in srgb, var(--brand-soft) 55%, var(--surface)))" }}
          >
            <h3 className="mb-[8px] font-display text-[13.5px] font-bold text-brand">{t("journals.whatThisDocumentDoes")}</h3>
            <ul className="flex flex-col gap-[7px] text-[12.5px] text-ink">
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {t("journals.postsAJournalEntryOf")} {lines.length} {t("journals.lines2")}
              </li>
              <li className="flex items-start gap-[8px]">
                <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-brand" />
                {t("journals.updatesAccountBalancesInThe")}
              </li>
              {!balanced ? (
                <li className="flex items-start gap-[8px] text-danger-ink">
                  <span aria-hidden className="mt-[7px] h-[5px] w-[5px] flex-none rounded-full bg-danger" />
                  {t("journals.theEntryIsOutOf")}
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

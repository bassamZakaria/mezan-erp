import { useMemo, useState } from "react";
import { DocumentList, StatusPill, Button, Card, SidePanel, type DocumentListColumn, type PillTone } from "@mezan/ui";
import type { SequenceListItemDTO } from "@mezan/contracts";
import { useSequences, useUpdateSequence, useResetSequenceCounter } from "../data/platform-hooks";
import { ApiError } from "../data/hooks";
import { TextField, NumberField, ToggleField } from "./form-controls";
import { sequenceLabel } from "../domain-labels";
import { useAppTranslation } from "../i18n";

/**
 * تسلسلات الترقيم (Numbering Sequences) — `/settings/sequences`. Reads the
 * real numbering engine (`packages/domain/src/numbering`) through `/sequences`:
 * every compiled-in sequence type, its live counter (peeked, never
 * incremented) and the next preview number. Prefix / pad length / fiscal-year
 * reset are editable; the counter itself is read-only in the main form — an
 * explicit, separately-guarded action is required to touch it (see
 * `CounterAdjustPanel` below), matching the no-gap guarantee the engine
 * provides inside a posting transaction.
 */

function editForm(seq: SequenceListItemDTO) {
  return { prefix: seq.prefix, padLength: seq.padLength, annualReset: seq.annualReset };
}

export function SequencesPage() {
  const { t } = useAppTranslation();
  const query = useSequences();
  const updateSequence = useUpdateSequence();
  const resetCounter = useResetSequenceCounter();
  const sequences = query.data ?? [];

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ReturnType<typeof editForm> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);

  const selected = sequences.find((s) => s.code === selectedCode) ?? null;

  const filtered = useMemo(() => {
    if (search.trim() === "") return sequences;
    const q = search.trim().toLowerCase();
    return sequences.filter((s) => s.code.toLowerCase().includes(q) || s.labelAr.includes(search.trim()));
  }, [sequences, search]);

  const annualResetCount = sequences.filter((s) => s.annualReset).length;

  const columns: DocumentListColumn<SequenceListItemDTO>[] = [
    { key: "code", header: t("sequences.col.code"), render: (s) => <span className="mz-num font-semibold text-ink">{s.code}</span> },
    { key: "labelAr", header: t("sequences.col.label"), render: (s) => <span className="text-ink">{sequenceLabel(s, t)}</span> },
    { key: "prefix", header: t("sequences.col.prefix"), render: (s) => <span className="mz-num text-ink-muted">{s.prefix || "—"}</span> },
    { key: "padLength", header: t("sequences.col.padLength"), align: "end", render: (s) => <span className="mz-num">{s.padLength}</span> },
    { key: "currentValue", header: t("sequences.col.currentValue"), align: "end", render: (s) => <span className="mz-num">{s.currentValue}</span> },
    { key: "nextNumber", header: t("sequences.col.nextNumber"), align: "end", render: (s) => <span className="mz-num font-semibold text-brand">{s.nextNumber}</span> },
    {
      key: "annualReset",
      header: t("sequences.col.annualReset"),
      render: (s) => <StatusPill label={s.annualReset ? t("sequences.yes") : t("sequences.no")} tone={(s.annualReset ? "info" : "neutral") as PillTone} />,
    },
  ];

  function openEdit(seq: SequenceListItemDTO) {
    setSelectedCode(seq.code);
    setForm(editForm(seq));
    setError(null);
    setCounterOpen(false);
  }

  function closePanel() {
    setSelectedCode(null);
    setForm(null);
    setError(null);
    setCounterOpen(false);
  }

  async function saveEdit() {
    if (!selected || !form) return;
    setError(null);
    if (form.prefix.trim() === "" || form.padLength < 1) {
      setError(t("sequences.error.prefixRequired"));
      return;
    }
    try {
      await updateSequence.mutateAsync({
        code: selected.code,
        patch: { prefix: form.prefix, padLength: form.padLength, annualReset: form.annualReset },
      });
      closePanel();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sequences.error.saveFailed"));
    }
  }

  return (
    <>
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("sequences.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("sequences.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<SequenceListItemDTO>
        title={t("sequences.title")}
        description={t("sequences.description")}
        stats={[
          { label: t("sequences.stat.total"), value: <span className="mz-num">{sequences.length}</span> },
          { label: t("sequences.stat.annualReset"), value: <span className="mz-num">{annualResetCount}</span> },
        ]}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder={t("sequences.searchPlaceholder")}
        columns={columns}
        rows={filtered}
        rowKey={(s) => s.code}
        onRowClick={openEdit}
        page={1}
        pageCount={1}
        pageSummary={
          <>
            {t("sequences.showingPrefix")} <span className="mz-num">{filtered.length}</span> {t("sequences.showingOf")} <span className="mz-num">{sequences.length}</span> {t("sequences.showingSuffix")}
          </>
        }
        emptyState={<div className="p-8 text-center text-sm text-ink-muted">{t("sequences.empty")}</div>}
      />

      <SidePanel
        open={selected !== null && form !== null}
        onClose={closePanel}
        title={selected ? `${sequenceLabel(selected, t)} · ${selected.code}` : ""}
        description={t("sequences.panel.description")}
      >
        {selected && form ? (
          <div className="flex flex-col gap-[16px]">
            {error ? <StatusPill label={error} tone="danger" /> : null}

            <div className="rounded-md border border-border bg-surface-2 p-[12px_14px]">
              <dl className="flex flex-col gap-[6px] text-[12.5px]">
                <div className="flex items-center justify-between">
                  <dt className="text-ink-muted">{t("sequences.counterCurrent")}</dt>
                  <dd className="mz-num font-semibold text-ink">{selected.currentValue}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-ink-muted">{t("sequences.counterNext")}</dt>
                  <dd className="mz-num font-semibold text-brand">{selected.nextNumber}</dd>
                </div>
              </dl>
              <p className="mt-[8px] text-[11.5px] text-ink-faint">
                {t("sequences.counterReadOnly")}
              </p>
            </div>

            <TextField label={t("sequences.field.prefix")} value={form.prefix} onChange={(v) => setForm((f) => (f ? { ...f, prefix: v } : f))} />
            <NumberField
              label={t("sequences.field.padLength")}
              value={form.padLength}
              min={1}
              max={12}
              onChange={(v) => setForm((f) => (f ? { ...f, padLength: v } : f))}
            />
            <ToggleField
              label={t("sequences.field.annualReset")}
              hint={t("sequences.field.annualResetHint")}
              checked={form.annualReset}
              onChange={(v) => setForm((f) => (f ? { ...f, annualReset: v } : f))}
            />

            <div className="flex justify-end gap-[9px]">
              <Button onClick={closePanel}>{t("sequences.cancel")}</Button>
              <Button variant="primary" onClick={() => void saveEdit()}>
                {t("sequences.save")}
              </Button>
            </div>

            <div className="border-t border-border pt-[14px]">
              {counterOpen ? (
                <CounterAdjustPanel
                  sequence={selected}
                  busy={resetCounter.isPending}
                  onCancel={() => setCounterOpen(false)}
                  onConfirm={async (value) => {
                    await resetCounter.mutateAsync({ code: selected.code, body: { value, confirm: true } });
                    setCounterOpen(false);
                  }}
                />
              ) : (
                <Button variant="danger-outline" size="sm" onClick={() => setCounterOpen(true)}>
                  {t("sequences.editCounter")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </SidePanel>
    </>
  );
}

/**
 * The explicit, guarded counter-change surface — deliberately separate from
 * the prefix/pad-length/annual-reset form above. Requires the operator to
 * type a value AND tick an acknowledgment before the mutation is even
 * enabled; the API additionally refuses any value below the current counter.
 */
function CounterAdjustPanel({
  sequence,
  busy,
  onCancel,
  onConfirm,
}: {
  sequence: SequenceListItemDTO;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (value: number) => Promise<void>;
}) {
  const { t } = useAppTranslation();
  const [value, setValue] = useState(sequence.currentValue);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const belowCurrent = value < sequence.currentValue;
  const canConfirm = ack && !belowCurrent && !busy;

  async function handleConfirm() {
    if (!canConfirm) return;
    setError(null);
    try {
      await onConfirm(value);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("sequences.error.counterFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-[12px] rounded-md border border-danger bg-danger-soft p-[14px]">
      <p className="text-[12.5px] font-semibold text-danger-ink">
        {t("sequences.counterWarning")}
      </p>
      {error ? <StatusPill label={error} tone="danger" /> : null}
      <NumberField label={t("sequences.field.newValue")} value={value} min={sequence.currentValue} onChange={setValue} />
      {belowCurrent ? (
        <p className="text-[11.5px] font-semibold text-danger-ink">
          {t("sequences.belowCurrent", { current: sequence.currentValue })}
        </p>
      ) : null}
      <label className="flex items-start gap-[8px] text-[12px] text-ink">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-[2px]" />
        <span>{t("sequences.counterConfirm")}</span>
      </label>
      <div className="flex justify-end gap-[9px]">
        <Button size="sm" onClick={onCancel}>
          {t("sequences.cancel")}
        </Button>
        <Button size="sm" variant="danger-outline" disabled={!canConfirm} onClick={() => void handleConfirm()}>
          {t("sequences.counterSubmit")}
        </Button>
      </div>
    </div>
  );
}

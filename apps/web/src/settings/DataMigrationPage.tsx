import { useRef, useState, type RefObject } from "react";
import { Button, Card, StatusPill, buildDataMigrationTemplate, parseDataMigrationFile, downloadReportExport, type DataMigrationStepSpec } from "@mezan/ui";
import {
  useDataMigrationStatus,
  useDataMigrationPreview,
  useDataMigrationCommit,
  useHistoricalImportPreview,
  useHistoricalImportCommit,
  type DataMigrationMasterStep,
  type DataMigrationStatusDTO,
  type DataMigrationStepResultDTO,
  type HistoricalImportKind,
  type HistoricalImportDocType,
  type HistoricalImportRowDTO,
  type HistoricalImportResultDTO,
} from "../data/hooks";

/**
 * نقل البيانات (Data Migration wizard) — docs/catalog/09 §"نقل البيانات": the
 * one-time, dependency-ordered go-live import tool. 13 steps, each openable
 * independently ("الترتيب إرشاد مش قفل" — order is guidance, not a lock),
 * each with a downloadable Excel template, a dry-run preview, and an
 * all-or-nothing commit. Steps 1-9 (master data) hit `/data-migration/:step`;
 * steps 10-13 (historical documents) reuse `/sales/historical-import` and
 * `/purchases/historical-import` directly — same settled/partial-balance
 * archive rule, same "inventory untouched" guarantee.
 */

import { STEPS, type HistoricalStepDef, type MasterStepDef, type StepDef } from "./data-migration-steps";

function StepShell({
  title,
  help,
  registeredCount,
  open,
  onToggle,
  onDownloadTemplate,
  fileInputRef,
  onFileChosen,
  isPreviewing,
  isCommitting,
  previewSummary,
  errors,
  canCommit,
  onCommit,
}: {
  title: string;
  help: string;
  registeredCount: number | undefined;
  open: boolean;
  onToggle: () => void;
  onDownloadTemplate: () => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileChosen: (file: File) => void;
  isPreviewing: boolean;
  isCommitting: boolean;
  previewSummary: string | null;
  errors: readonly { rowNumber: number; reasons: readonly string[] }[];
  canCommit: boolean;
  onCommit: () => void;
}) {
  const done = (registeredCount ?? 0) > 0;
  return (
    <Card className="p-[16px_18px]">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-[12px] text-start">
        <div className="flex items-center gap-[10px]">
          {done ? <span aria-label="مكتمل" className="text-success-ink">✓</span> : null}
          <h3 className="font-display text-[14.5px] font-bold text-ink">{title}</h3>
        </div>
        <div className="flex items-center gap-[10px]">
          <StatusPill label={`مسجّل: ${registeredCount ?? 0}`} tone={done ? "success" : "neutral"} />
          <span aria-hidden className="text-ink-faint">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open ? (
        <div className="mt-[14px] flex flex-col gap-[12px] border-t border-border pt-[14px]">
          <p className="max-w-[70ch] text-[12px] text-ink-muted">{help}</p>
          <div className="flex flex-wrap items-center gap-[9px]">
            <Button variant="default" onClick={onDownloadTemplate}>
              تنزيل النموذج
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFileChosen(file);
                e.target.value = "";
              }}
            />
            <Button variant="default" disabled={isPreviewing} onClick={() => fileInputRef.current?.click()}>
              {isPreviewing ? "جارِ التحقق…" : "استيراد"}
            </Button>
            <Button variant="primary" disabled={!canCommit || isCommitting} onClick={onCommit}>
              {isCommitting ? "جارِ التأكيد…" : "تأكيد الاستيراد"}
            </Button>
          </div>
          {previewSummary ? <p className="text-[12.5px] font-semibold text-ink">{previewSummary}</p> : null}
          {errors.length > 0 ? (
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-start">
                    <th className="p-[6px_8px] text-start font-semibold">الصف</th>
                    <th className="p-[6px_8px] text-start font-semibold">السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((err, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="mz-num p-[6px_8px]">{err.rowNumber}</td>
                      <td className="p-[6px_8px]">{err.reasons.join("، ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

function MasterStepCard({ def, open, onToggle, registeredCount }: { def: MasterStepDef; open: boolean; onToggle: () => void; registeredCount: number | undefined }) {
  const preview = useDataMigrationPreview(def.id);
  const commit = useDataMigrationCommit(def.id);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [result, setResult] = useState<DataMigrationStepResultDTO | null>(null);

  async function handleFile(file: File) {
    setResult(null);
    const buffer = await file.arrayBuffer();
    const parsed = await parseDataMigrationFile(buffer, def.spec);
    setRows([...parsed.rows]);
    const previewResult = await preview.mutateAsync(parsed.rows);
    setResult(previewResult);
  }

  async function handleCommit() {
    if (!rows) return;
    const commitResult = await commit.mutateAsync(rows);
    setResult(commitResult);
  }

  return (
    <StepShell
      title={def.title}
      help={def.help}
      registeredCount={registeredCount}
      open={open}
      onToggle={onToggle}
      onDownloadTemplate={async () => downloadReportExport(await buildDataMigrationTemplate(def.spec))}
      fileInputRef={fileInputRef}
      onFileChosen={handleFile}
      isPreviewing={preview.isPending}
      isCommitting={commit.isPending}
      previewSummary={
        result
          ? result.createdIds
            ? `تم استيراد ${result.createdIds.length} سجل بنجاح.`
            : `${result.validCount} صف صالح من إجمالي ${result.validCount + result.errors.length}.`
          : null
      }
      errors={result?.errors ?? []}
      canCommit={!!result && result.errors.length === 0 && !result.createdIds}
      onCommit={handleCommit}
    />
  );
}

function HistoricalStepCard({ def, open, onToggle, registeredCount }: { def: HistoricalStepDef; open: boolean; onToggle: () => void; registeredCount: number | undefined }) {
  const preview = useHistoricalImportPreview(def.importKind);
  const commit = useHistoricalImportCommit(def.importKind);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<HistoricalImportRowDTO[] | null>(null);
  const [result, setResult] = useState<HistoricalImportResultDTO | null>(null);

  function toRows(parsedRows: readonly Record<string, string>[]): HistoricalImportRowDTO[] {
    return parsedRows.map((r) => ({
      rowNumber: Number(r.rowNumber),
      docType: def.docType,
      documentNumber: r.documentNumber ?? "",
      partyId: r.partyId ?? "",
      date: r.date ?? "",
      dueDate: r.dueDate || null,
      itemId: r.itemId || null,
      description: r.description || null,
      qty: r.qty ?? "0",
      unitCost: r.unitCost ?? "0",
      amountPaid: r.amountPaid ?? "0",
    }));
  }

  async function handleFile(file: File) {
    setResult(null);
    const buffer = await file.arrayBuffer();
    const parsed = await parseDataMigrationFile(buffer, def.spec);
    const built = toRows(parsed.rows);
    setRows(built);
    const previewResult = await preview.mutateAsync(built);
    setResult(previewResult);
  }

  async function handleCommit() {
    if (!rows) return;
    const commitResult = await commit.mutateAsync(rows);
    setResult(commitResult);
  }

  return (
    <StepShell
      title={def.title}
      help={def.help}
      registeredCount={registeredCount}
      open={open}
      onToggle={onToggle}
      onDownloadTemplate={async () => downloadReportExport(await buildDataMigrationTemplate(def.spec))}
      fileInputRef={fileInputRef}
      onFileChosen={handleFile}
      isPreviewing={preview.isPending}
      isCommitting={commit.isPending}
      previewSummary={
        result
          ? result.archivedIds
            ? `تم أرشفة ${result.archivedIds.length} مستند بنجاح.`
            : `${result.groups.length} مستند صالح — ${result.errors.length} صف به أخطاء.`
          : null
      }
      errors={result?.errors ?? []}
      canCommit={!!result && result.errors.length === 0 && !result.archivedIds}
      onCommit={handleCommit}
    />
  );
}

export function DataMigrationPage() {
  const status = useDataMigrationStatus();
  const [openStep, setOpenStep] = useState<string | null>(STEPS[0]?.title ?? null);

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h1 className="font-display text-[21px] font-bold text-ink">نقل البيانات</h1>
        <p className="mt-[6px] max-w-[80ch] text-[13px] text-ink-muted">
          دي الخطوات اللي بتنقل بيها بيانات شركتك على النظام. رتّبناها بالترتيب اللي لازم تمشي بيه، لأن كل خطوة بتعتمد
          على اللي قبلها. تقدر تفتح أي خطوة في أي وقت — الترتيب إرشاد مش قفل.
        </p>
      </div>

      <div className="flex flex-col gap-[10px]">
        {STEPS.map((def) =>
          def.kind === "master" ? (
            <MasterStepCard
              key={def.id}
              def={def}
              open={openStep === def.title}
              onToggle={() => setOpenStep((cur) => (cur === def.title ? null : def.title))}
              registeredCount={status.data?.[def.statusKey]}
            />
          ) : (
            <HistoricalStepCard
              key={def.title}
              def={def}
              open={openStep === def.title}
              onToggle={() => setOpenStep((cur) => (cur === def.title ? null : def.title))}
              registeredCount={status.data?.[def.statusKey]}
            />
          ),
        )}
      </div>

      <p className="text-[11.5px] text-ink-faint">
        استيراد الجرد وتحويل المخزون مش هنا — دول أدوات تشغيل يومي، بتلاقيهم جوه ورقة الجرد نفسها وشاشة التحويل.
      </p>
    </div>
  );
}

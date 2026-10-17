import { createHash, randomUUID } from "node:crypto";
import { closeSync, createReadStream, mkdtempSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { Zip, ZipDeflate } from "fflate";
import {
  CSV_BOM,
  EVIDENCE_PACK_FORMAT,
  EVIDENCE_SIGNATURE_ALGORITHM,
  EVIDENCE_SIGNATURE_NOTICE,
  EvidenceFileName,
  SEQUENCE_DEFINITIONS,
  SequenceSourceCoverage,
  WILDCARD_PERMISSION,
  applySequenceOverride,
  buildSequenceGapReport,
  buildTrialBalanceSnapshot,
  can,
  csvLine,
  dayBefore,
  detectSodConflicts,
  evidenceSigningIdentity,
  isErasedUser,
  parseSequenceNumber,
  recordSensitiveEvent,
  serializeEvidenceManifest,
  signEvidenceManifest,
  type Account,
  type AuditEvent,
  type AuditSink,
  type CounterAdjustment,
  type DeletedNumber,
  type EvidenceAuditChainVerdict,
  type EvidenceFileEntry,
  type EvidenceManifest,
  type FiscalPeriod,
  type LedgerRepository,
  type Money,
  type NumberedDocumentRecord,
  type SequenceCounterState,
  type SequenceDefinition,
  type SequenceGapReport,
  type SequenceOverride,
  type UnitOfWork,
} from "@mezan/domain";
import {
  EVIDENCE_PACK_HISTORY_LIMIT,
  EVIDENCE_PACK_MAX_SPAN_DAYS,
  EvidencePackRefusal,
  evidencePeriodSchema,
  type EvidencePackRecordDTO,
  type EvidencePeriodDTO,
  type EvidencePublicKeyDTO,
  type SequenceGapReportDTO,
} from "@mezan/contracts";
import type { AuditChainVerification, EvidencePackStore, SequenceCounterRow } from "@mezan/persistence";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { refuseBranchScopedCaller } from "./branch-scope-refusal.js";
import { redactCost } from "./audit-routes.js";
import { reconcileControls, type ReconciliationControl } from "./reconciliation-routes.js";
import { AgingLadderSide, agingLadderTable, type ReportTable, type ReportsRoutesDeps } from "./reports-routes.js";
import type { SealedPeriodCloseSummary } from "./period-close-routes.js";

export enum EvidencePermission {
  SequenceGaps = "audit.sequence_gaps.view",
  View = "audit.evidence_pack.view",
  Build = "audit.evidence_pack.build",
}

const VIEW_COST_PERMISSION = "sales.invoice.view_cost";
const ZIP_CONTENT_TYPE = "application/zip";
const DAY_MS = 24 * 60 * 60 * 1000;
const SPKI_ED25519_PREFIX_HEX = "302a300506032b6570032100";
const PACK_ENTITY = "EVIDENCE_PACK";
const PACK_BUILT_ACTION = "EVIDENCE_PACK_BUILT";
const PACK_FAILED_ACTION = "EVIDENCE_PACK_BUILD_FAILED";

export interface EvidencePackRoutesDeps {
  readonly store: EvidencePackStore;
  readonly signingSeed: () => string;
  readonly companyName: () => Promise<string>;
  readonly uow: UnitOfWork;
  readonly audit: AuditSink;
  readonly auditChain: () => Promise<AuditChainVerification | null>;
  readonly accounts: { list(): Promise<readonly Account[]> };
  readonly accountBalances: (bounds: { toDate: string }) => Promise<ReadonlyMap<string, Money>>;
  readonly ledger: Pick<LedgerRepository, "accountBalance">;
  readonly reconciliationControls: (asOfDate?: string) => Promise<readonly ReconciliationControl[]>;
  readonly reports: ReportsRoutesDeps;
  readonly sequenceCounters: () => Promise<readonly SequenceCounterRow[]>;
  readonly sequenceOverrides: () => Promise<ReadonlyMap<string, SequenceOverride>>;
  readonly branchCodes: () => Promise<ReadonlyMap<string, string>>;
  readonly fiscalPeriods: () => Promise<readonly FiscalPeriod[]>;
  readonly closeSummaries: (periodId: string) => Promise<readonly SealedPeriodCloseSummary[] | null>;
  readonly definitions?: readonly SequenceDefinition[];
  readonly tmpDir?: string;
}

function periodOf(c: Context): EvidencePeriodDTO | Response {
  const parsed = evidencePeriodSchema.safeParse({ from: c.req.query("from"), to: c.req.query("to") });
  if (!parsed.success) return c.json({ error: EvidencePackRefusal.InvalidPeriod, message: "حدّد فترة صحيحة: من تاريخ وإلى تاريخ.", details: parsed.error.flatten() }, 400);
  return parsed.data;
}

function periodFromBody(c: Context, body: unknown): EvidencePeriodDTO | Response {
  const parsed = evidencePeriodSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: EvidencePackRefusal.InvalidPeriod, message: "حدّد فترة صحيحة: من تاريخ وإلى تاريخ.", details: parsed.error.flatten() }, 400);
  const span = (Date.parse(`${parsed.data.to}T00:00:00Z`) - Date.parse(`${parsed.data.from}T00:00:00Z`)) / DAY_MS;
  if (span > EVIDENCE_PACK_MAX_SPAN_DAYS) {
    return c.json({ error: EvidencePackRefusal.PeriodTooLong, message: `الفترة لا تتجاوز ${EVIDENCE_PACK_MAX_SPAN_DAYS} يومًا في حزمة واحدة.` }, 400);
  }
  return parsed.data;
}

function publicKeyPem(publicKeyHex: string): string {
  const der = Buffer.from(`${SPKI_ED25519_PREFIX_HEX}${publicKeyHex}`, "hex").toString("base64");
  return `-----BEGIN PUBLIC KEY-----\n${der}\n-----END PUBLIC KEY-----\n`;
}

const DELETED_NUMBER_SOURCE = "audit";

export async function computeSequenceGapReport(deps: EvidencePackRoutesDeps, window: EvidencePeriodDTO): Promise<SequenceGapReport> {
  const definitions = deps.definitions ?? SEQUENCE_DEFINITIONS;
  const [counterRows, overrides, branchCodes] = await Promise.all([deps.sequenceCounters(), deps.sequenceOverrides(), deps.branchCodes()]);
  const effective = new Map<string, { def: SequenceDefinition; prefixes: string[] }>();
  for (const base of definitions) {
    const def = applySequenceOverride(base, overrides.get(base.code) ?? null);
    effective.set(base.code, { def, prefixes: [...new Set([def.prefix, base.prefix])] });
  }

  const documentsByCode = new Map<string, NumberedDocumentRecord[]>();
  for (const doc of deps.store.numberedDocuments()) {
    for (const [code, { def, prefixes }] of effective) {
      if (!parseSequenceNumber(doc.number, { prefixes, suffix: def.suffix ?? "", padLength: def.padLength })) continue;
      documentsByCode.set(code, [...(documentsByCode.get(code) ?? []), doc]);
      break;
    }
  }

  const counters: SequenceCounterState[] = [];
  for (const row of counterRows) {
    const entry = effective.get(row.code);
    if (!entry) continue;
    const [periodKey = "", scope = null] = row.period.split("@") as [string?, string?];
    const period = periodKey === "" ? null : Number.parseInt(periodKey, 10);
    counters.push({
      code: row.code,
      labelAr: entry.def.labelAr,
      period: Number.isNaN(period) ? null : period,
      scope: scope ?? null,
      branchCode: scope ? (branchCodes.get(scope) ?? scope) : null,
      issued: row.value,
      format: { prefixes: entry.prefixes, suffix: entry.def.suffix ?? "", padLength: entry.def.padLength },
      coverage: (documentsByCode.get(row.code)?.length ?? 0) > 0 ? SequenceSourceCoverage.Documents : SequenceSourceCoverage.CounterOnly,
    });
  }

  const adjustments: CounterAdjustment[] = deps.store.counterAdjustments().map((a) => ({ ...a }));
  const deletions: DeletedNumber[] = [];
  for (const removal of deps.store.deletedNumbers()) {
    for (const candidate of removal.candidates) {
      for (const [code, { def, prefixes }] of effective) {
        if (parseSequenceNumber(candidate, { prefixes, suffix: def.suffix ?? "", padLength: def.padLength })) {
          deletions.push({ code, number: candidate, at: removal.at, actor: removal.actor || DELETED_NUMBER_SOURCE });
          break;
        }
      }
    }
  }

  return buildSequenceGapReport({ window, counters, documentsByCode, adjustments, deletions });
}

function toGapDTO(report: SequenceGapReport): SequenceGapReportDTO {
  return report as unknown as SequenceGapReportDTO;
}

interface PackFile {
  push(cells: readonly (string | number | boolean | null | undefined)[]): void;
  text(content: string): void;
  close(): EvidenceFileEntry;
}

class PackWriter {
  private readonly fd: number;
  private readonly zip: Zip;
  private failure: Error | null = null;
  private finished = false;
  readonly entries: EvidenceFileEntry[] = [];

  constructor(readonly file: string) {
    this.fd = openSync(file, "wx", 0o600);
    // INVARIANT: written synchronously as fflate emits, so the archive never accumulates in memory and no await happens while a SQLite cursor is open.
    this.zip = new Zip((err, chunk, final) => {
      if (err) {
        this.failure = err;
        return;
      }
      writeSync(this.fd, chunk);
      if (final) this.finished = true;
    });
  }

  open(name: EvidenceFileName, csv: boolean): PackFile {
    const entry = new ZipDeflate(name, { level: 6 });
    this.zip.add(entry);
    const hash = createHash("sha256");
    let bytes = 0;
    let rows = 0;
    const write = (text: string) => {
      const chunk = Buffer.from(text, "utf8");
      hash.update(chunk);
      bytes += chunk.length;
      entry.push(chunk);
    };
    if (csv) write(CSV_BOM);
    return {
      push: (cells) => {
        write(csvLine(cells));
        rows += 1;
      },
      text: (content) => write(content),
      close: () => {
        entry.push(new Uint8Array(0), true);
        const done: EvidenceFileEntry = { name, sha256: hash.digest("hex"), bytes, rows: csv ? Math.max(0, rows - 1) : rows };
        this.entries.push(done);
        return done;
      },
    };
  }

  raw(name: EvidenceFileName, content: Uint8Array): void {
    const entry = new ZipDeflate(name, { level: 6 });
    this.zip.add(entry);
    entry.push(content, true);
  }

  finish(): void {
    this.zip.end();
    closeSync(this.fd);
    if (this.failure) throw this.failure;
    if (!this.finished) throw new Error("the evidence archive did not finish writing");
  }

  abort(): void {
    try {
      closeSync(this.fd);
    } catch {
      // Already closed by finish().
    }
  }
}

function writeReportTable(pack: PackWriter, name: EvidenceFileName, table: ReportTable): void {
  const file = pack.open(name, true);
  file.push(table.columns.map((column) => column.header));
  if (table.outcome.ok) {
    for (const row of table.outcome.rows) file.push(table.columns.map((column) => column.value(row)));
    const totals = table.outcome.grandTotals;
    file.push(table.columns.map((column, index) => (index === 0 ? "الإجمالي / Total" : (totals[column.key] ?? ""))));
    const tie = table.outcome.reconciliation;
    if (tie) {
      file.push([tie.labelAr, tie.reportTotal, tie.referenceTotal, tie.diff, tie.withinTolerance ? "مطابق / tied" : "غير مطابق / NOT TIED"]);
      for (const item of tie.reconcilingItems ?? []) file.push([JSON.stringify(item)]);
    }
  } else {
    file.push(["تعذّر إنتاج التقرير / report could not be produced", JSON.stringify(table.outcome.errors)]);
  }
  file.close();
}

function readMe(manifestFormat: string, company: string, period: EvidencePeriodDTO, keyId: string, publicKeyHex: string): string {
  return [
    `Mezan audit evidence pack — ${company}`,
    `Period / الفترة: ${period.from} → ${period.to}`,
    `Format: ${manifestFormat}`,
    "",
    "HOW TO VERIFY / طريقة التحقق",
    "1. Obtain this installation's evidence public key from the Mezan screen «حزمة أدلة المراجعة» (or from the company in writing). Do NOT trust the key printed inside this archive on its own: whoever could alter the files could alter it too.",
    `   Key id in this pack: ${keyId}`,
    `   Public key (hex) in this pack: ${publicKeyHex}`,
    "2. manifest.sig is the base64 Ed25519 signature over the exact bytes of manifest.json. Verify it with the public key from step 1, e.g.:",
    "     pnpm evidence:verify <pack.zip> <public-key-hex>",
    "   or with OpenSSL 3: base64 -d manifest.sig > manifest.sig.bin && openssl pkeyutl -verify -pubin -inkey evidence-public-key.pem -rawin -in manifest.json -sigfile manifest.sig.bin",
    "3. Recompute SHA-256 of every file listed in manifest.json (shasum -a 256 <file>) and compare.",
    "",
    "١. احصل على المفتاح العام من شاشة «حزمة أدلة المراجعة» في ميزان أو من المنشأة كتابيًا، ولا تعتمد على المفتاح المطبوع داخل الحزمة وحده.",
    "٢. ملف manifest.sig توقيع Ed25519 (base64) على البايتات الحرفية لملف manifest.json؛ تحقّق منه بالمفتاح العام.",
    "٣. احسب بصمة SHA-256 لكل ملف مدرج في manifest.json وقارنها.",
    "",
    EVIDENCE_SIGNATURE_NOTICE,
    "",
  ].join("\r\n");
}

export function createEvidencePackRoutes(deps: EvidencePackRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/sequence-gaps", gate(EvidencePermission.SequenceGaps), async (c) => {
    const refusal = refuseBranchScopedCaller(c);
    if (refusal) return refusal;
    const window = periodOf(c);
    if (window instanceof Response) return window;
    return c.json(toGapDTO(await computeSequenceGapReport(deps, window)));
  });

  app.get("/evidence-packs/public-key", gate(EvidencePermission.View), async (c) => {
    const { publicKeyHex, keyId } = await evidenceSigningIdentity(deps.signingSeed());
    const body: EvidencePublicKeyDTO = { algorithm: EVIDENCE_SIGNATURE_ALGORITHM, keyId, publicKeyHex, publicKeyPem: publicKeyPem(publicKeyHex), format: EVIDENCE_PACK_FORMAT };
    return c.json(body);
  });

  app.get("/evidence-packs", gate(EvidencePermission.View), (c) => {
    const records: EvidencePackRecordDTO[] = [...deps.store.list(EVIDENCE_PACK_HISTORY_LIMIT)];
    return c.json(records);
  });

  app.post("/evidence-packs", gate(EvidencePermission.Build), async (c) => {
    const refusal = refuseBranchScopedCaller(c);
    if (refusal) return refusal;
    const period = periodFromBody(c, await c.req.json().catch(() => null));
    if (period instanceof Response) return period;
    const auth = getAuthContext(c);
    const actor = auth?.userId ?? "unknown";
    const seeCost = auth ? can(auth, VIEW_COST_PERMISSION) : false;

    const dir = mkdtempSync(path.join(deps.tmpDir ?? tmpdir(), "mezan-evidence-"));
    const file = path.join(dir, "pack.zip");
    const packId = randomUUID();
    let pack: PackWriter | null = null;
    try {
      const [company, actorUser, identity, chain] = await Promise.all([
        deps.companyName(),
        deps.uow.users.findById(actor),
        evidenceSigningIdentity(deps.signingSeed()),
        deps.auditChain(),
      ]);
      const verdict: EvidenceAuditChainVerdict = chain
        ? { ok: chain.ok, checkedRows: chain.checked, firstBrokenRowId: chain.brokenRowId, reason: chain.reason }
        : { ok: false, checkedRows: 0, firstBrokenRowId: null, reason: "UNSUPPORTED" };

      const [accounts, opening, closing, controls, receivables, payables, gaps, users, roles, periods] = await Promise.all([
        deps.accounts.list(),
        deps.accountBalances({ toDate: dayBefore(period.from) }),
        deps.accountBalances({ toDate: period.to }),
        deps.reconciliationControls(period.to),
        agingLadderTable(deps.reports, c, AgingLadderSide.Customers, period.to),
        agingLadderTable(deps.reports, c, AgingLadderSide.Suppliers, period.to),
        computeSequenceGapReport(deps, period),
        deps.uow.users.list(),
        deps.uow.roles.list(),
        deps.fiscalPeriods(),
      ]);
      const reconciliation = await reconcileControls(deps.ledger, controls, period.to);
      const periodsInWindow = periods.filter((p) => p.endDate >= period.from && p.startDate <= period.to);
      const summaries = (await Promise.all(periodsInWindow.map(async (p) => ({ period: p, sealed: (await deps.closeSummaries(p.id)) ?? [] })))).flatMap(({ period: p, sealed }) => sealed.map((s) => ({ period: p, ...s })));

      pack = new PackWriter(file);
      const readme = pack.open(EvidenceFileName.ReadMe, false);
      readme.text(readMe(EVIDENCE_PACK_FORMAT, company, period, identity.keyId, identity.publicKeyHex));
      readme.close();

      const snapshot = buildTrialBalanceSnapshot(accounts, opening, closing);
      const tb = pack.open(EvidenceFileName.TrialBalance, true);
      tb.push(["رمز الحساب / Code", "اسم الحساب / Name", "Name (EN)", `رصيد أول المدة / Opening ${dayBefore(period.from)}`, "حركة الفترة / Movement", `رصيد آخر المدة / Closing ${period.to}`, "Debit closing", "Credit closing"]);
      for (const row of snapshot.rows) {
        const debit = row.closing.scaled > 0n ? row.closing.toString() : "0";
        const credit = row.closing.scaled < 0n ? row.closing.negate().toString() : "0";
        tb.push([row.code, row.nameAr, row.nameEn, row.opening.toString(), row.movement.toString(), row.closing.toString(), debit, credit]);
      }
      tb.push(["الإجمالي / Total", "", "", "", "", "", snapshot.totals.closingDebit.toString(), snapshot.totals.closingCredit.toString()]);
      tb.close();

      const accountName = new Map(accounts.map((a) => [a.id, a]));
      const gl = pack.open(EvidenceFileName.GeneralLedger, true);
      gl.push(["date", "entry_no", "entry_id", "status", "source", "source_doc_type", "source_doc_number", "line_no", "account_code", "account_name", "debit", "credit", "memo", "line_memo", "branch_id", "cost_center_id", "project_id", "party_id", "currency", "fx_rate", "tax_rate_percent"]);
      for (const line of deps.store.glLines(period.from, period.to)) {
        const account = accountName.get(line.accountId);
        gl.push([line.date, line.entryNo, line.entryId, line.status, line.source, line.sourceDocType, line.sourceDocNumber, line.lineNo, account?.code ?? line.accountId, account?.nameAr ?? "", line.debit, line.credit, line.memo, line.lineMemo, line.branchId, line.costCenterId, line.projectId, line.partyId, line.currency, line.fxRate, line.taxRatePercent]);
      }
      gl.close();

      const recon = pack.open(EvidenceFileName.SubLedgerReconciliation, true);
      recon.push(["key", "البيان / Label", "control_account", `sub-ledger ${period.to}`, `GL ${period.to}`, "difference", "matched"]);
      for (const row of reconciliation.rows) recon.push([row.key, row.label, row.controlAccountId, row.subLedgerBalance.toString(), row.glBalance.toString(), row.difference.toString(), row.matched]);
      recon.push(["all_matched", reconciliation.allMatched]);
      recon.close();

      writeReportTable(pack, EvidenceFileName.ReceivablesAging, receivables);
      writeReportTable(pack, EvidenceFileName.PayablesAging, payables);

      const seq = pack.open(EvidenceFileName.SequenceGaps, true);
      seq.push(["sequence", "التسلسل / Label", "series", "period", "scope", "coverage", "issued", "documents_found", "row_kind", "first_number", "last_number", "count", "explanation", "reference", "in_period"]);
      for (const series of gaps.series) {
        const base = [series.code, series.labelAr, series.series, series.period, series.scope, series.coverage, series.issued, series.documentsFound];
        seq.push([...base, "summary", "", "", series.missingCount, `voided=${series.voidedCount}; unexplained=${series.unexplainedCount}; anomalies=${series.anomalies.length}`, "", ""]);
        for (const gap of series.gaps) seq.push([...base, "gap", gap.firstNumber, gap.lastNumber, gap.count, gap.explanation, gap.reference, gap.inWindow]);
        for (const voided of series.voided) seq.push([...base, "voided", voided.number, voided.number, 1, voided.status, voided.source, voided.inWindow]);
        for (const anomaly of series.anomalies) seq.push([...base, anomaly.kind, anomaly.number, anomaly.number, anomaly.occurrences, anomaly.kind, anomaly.sources.join(" "), ""]);
      }
      seq.close();

      const auditFile = pack.open(EvidenceFileName.AuditExtract, true);
      auditFile.push(["id", "timestamp", "stream", "module", "entity_type", "entity_id", "action", "actor", "branch_id", "severity", "details", "row_hash"]);
      for (const row of deps.store.auditEvents(period.from, period.to)) {
        const details = seeCost ? row.details : redactCost(row as unknown as AuditEvent).details;
        auditFile.push([row.id, row.timestamp, row.stream, row.module, row.entityType, row.entityId, row.action, row.actor, row.branchId, row.severity, details ? JSON.stringify(details) : "", row.rowHash]);
      }
      auditFile.close();

      const chainFile = pack.open(EvidenceFileName.AuditChainVerdict, true);
      chainFile.push(["verified_at", "ok", "checked_rows", "unchained_rows", "first_broken_row_id", "reason"]);
      chainFile.push([new Date().toISOString(), verdict.ok, verdict.checkedRows, chain?.unchained ?? "", verdict.firstBrokenRowId, verdict.reason]);
      chainFile.close();

      const roleById = new Map(roles.map((r) => [r.id, r]));
      const sod = pack.open(EvidenceFileName.SegregationOfDuties, true);
      sod.push(["subject", "id", "name", "email", "status", "role_code", "company_admin", "access_expires_at", "conflict_rule", "conflict_ar", "conflict_en", "permissions_side_a", "permissions_side_b"]);
      for (const user of users) {
        if (isErasedUser(user)) continue;
        const role = user.roleId ? roleById.get(user.roleId) : undefined;
        const grant = user.isCompanyAdmin ? [WILDCARD_PERMISSION] : (role?.permissions ?? []);
        const conflicts = detectSodConflicts(grant);
        const common = ["user", user.id, user.nameAr, user.email, user.status, role?.code ?? "", user.isCompanyAdmin, user.accessExpiresAt ?? ""];
        if (conflicts.length === 0) sod.push([...common, "", "", "", "", ""]);
        for (const conflict of conflicts) sod.push([...common, conflict.ruleId, conflict.labelAr, conflict.labelEn, conflict.matchedA.join(" "), conflict.matchedB.join(" ")]);
      }
      for (const role of roles) {
        for (const conflict of detectSodConflicts(role.permissions)) {
          sod.push(["role", role.id, role.name, "", "", role.code, false, "", conflict.ruleId, conflict.labelAr, conflict.labelEn, conflict.matchedA.join(" "), conflict.matchedB.join(" ")]);
        }
      }
      sod.close();

      const close = pack.open(EvidenceFileName.PeriodCloseSummaries, true);
      close.push(["period_id", "year", "period", "start", "end", "period_status", "summary_id", "closed_by", "closed_at", "override_reason", "failed_checks", "closing_debit", "closing_credit", "movement_debit", "movement_credit", "accounts", "sha256", "seal_valid"]);
      for (const { period: p, summary, sealValid } of summaries) {
        close.push([p.id, p.year, p.periodNumber, p.startDate, p.endDate, p.status, summary.id, summary.closedBy, summary.closedAt, summary.overrideReason, summary.failedChecks.join(" "), summary.totals.closingDebit.toString(), summary.totals.closingCredit.toString(), summary.totals.movementDebit.toString(), summary.totals.movementCredit.toString(), summary.trialBalance.length, summary.sha256, sealValid]);
      }
      for (const p of periodsInWindow) if (!summaries.some((s) => s.period.id === p.id)) close.push([p.id, p.year, p.periodNumber, p.startDate, p.endDate, p.status, "", "", "", "", "", "", "", "", "", "", "", ""]);
      close.close();

      const manifest: EvidenceManifest = {
        format: EVIDENCE_PACK_FORMAT,
        packId,
        companyName: company,
        period: { from: period.from, to: period.to },
        generatedAt: new Date().toISOString(),
        generatedBy: { userId: actor, name: actorUser?.nameAr ?? actor },
        signing: { algorithm: EVIDENCE_SIGNATURE_ALGORITHM, keyId: identity.keyId, publicKeyHex: identity.publicKeyHex },
        auditChain: verdict,
        files: [...pack.entries],
        notice: EVIDENCE_SIGNATURE_NOTICE,
      };
      const manifestBytes = serializeEvidenceManifest(manifest);
      const signature = await signEvidenceManifest(manifestBytes, deps.signingSeed());
      pack.raw(EvidenceFileName.Manifest, manifestBytes);
      pack.raw(EvidenceFileName.Signature, new TextEncoder().encode(`${signature}\n`));
      pack.finish();

      const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
      const totalBytes = statSync(file).size;
      deps.store.record({
        id: packId,
        periodFrom: period.from,
        periodTo: period.to,
        builtBy: actor,
        builtByName: manifest.generatedBy.name,
        builtAt: manifest.generatedAt,
        manifestSha256,
        keyId: identity.keyId,
        fileCount: manifest.files.length,
        totalBytes,
        auditChainOk: verdict.ok,
      });
      await recordSensitiveEvent(deps.audit, {
        module: "audit",
        entityType: PACK_ENTITY,
        entityId: packId,
        action: PACK_BUILT_ACTION,
        actor,
        severity: "WARNING",
        details: { from: period.from, to: period.to, manifestSha256, keyId: identity.keyId, files: manifest.files.map((f) => ({ name: f.name, sha256: f.sha256, rows: f.rows })), auditChainOk: verdict.ok, costRedacted: !seeCost },
      });

      const stream = createReadStream(file);
      const cleanup = () => rmSync(dir, { recursive: true, force: true });
      stream.once("close", cleanup);
      stream.once("error", cleanup);
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: 200,
        headers: {
          "content-type": ZIP_CONTENT_TYPE,
          "content-length": String(totalBytes),
          "content-disposition": `attachment; filename="mezan-evidence-${period.from}_${period.to}.zip"`,
          "x-evidence-pack-id": packId,
          "x-evidence-manifest-sha256": manifestSha256,
          "cache-control": "no-store",
        },
      });
    } catch (err) {
      pack?.abort();
      rmSync(dir, { recursive: true, force: true });
      console.error("[evidence] building the pack failed", err);
      await recordSensitiveEvent(deps.audit, {
        module: "audit",
        entityType: PACK_ENTITY,
        entityId: packId,
        action: PACK_FAILED_ACTION,
        actor,
        severity: "WARNING",
        details: { from: period.from, to: period.to },
      }).catch(() => undefined);
      return c.json({ error: EvidencePackRefusal.BuildFailed, message: "تعذّر إعداد حزمة الأدلة. أعد المحاولة أو راجع سجل الخادم." }, 500);
    }
  });

  return app;
}

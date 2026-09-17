import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  DocumentDetail,
  DocumentList,
  DocumentStatusStepper,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type EntityPickerOption,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { PreviewSubCertificateDTO, SubCertificateDTO, SubCertificateDerivedStatusDTO } from "@mezan/contracts";
import { TextAreaField, TextField } from "../../../settings/form-controls";
import { useSubPage, useNavigation } from "../../../navigation";
import { useApi } from "../../../data/ApiContext";
import { useProjects } from "../../../data/hooks";
import {
  useSubCertificate,
  useSubCertificatePreview,
  useSubCertificateTransition,
  useSubCertificates,
  useSubcontracts,
  useCreateSubCertificate,
  useUpdateSubCertificate,
} from "../../../data/contracting-subcontracts-hooks";
import { DeductionsBlock } from "../certificates/CertificatesScreen";
import { useAppTranslation } from "../../../i18n";
import { majorOf, sumMajor } from "../../../lib/money";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { unitLabel } from "../../../lib/boq-unit-label";
import { formatPercent } from "../../../lib/percent";
import { SUB_CERTIFICATE_STATUS_KEY, SUB_CERTIFICATE_STATUS_TONE, SUB_CERTIFICATE_STEPS, trimScale } from "./subcontract-common";
import { SubCertificatePrintPage } from "./SubCertificatePrintPage";

/**
 * مستخلصات مقاولي الباطن — the mirror of the client certificate, measured
 * against the SUBCONTRACT's own lines and capped by what the consultant has
 * already certified to the employer on the matching client BOQ line
 * (design §03 "THE MIRROR", D-04, D-05).
 *
 * Every column but «هذا المستخلص» is the server's, and the whole deductions
 * block comes back from `/preview` while the surveyor types.
 */

function monthStart(): string {
  const today = todayIso();
  return `${today.slice(0, 8)}01`;
}

export function SubcontractCertificatesScreen() {
  const { t } = useAppTranslation();
  const subPage = useSubPage();
  const [firstSegment, secondSegment] = subPage.segments;

  const certificatesQuery = useSubCertificates();
  const certificates = certificatesQuery.data ?? EMPTY;
  const projects = useProjects().data ?? EMPTY;

  const { session } = useApi();
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayPrepare = can(authContext, "contracting.certificate.prepare");

  const [statusFilter, setStatusFilter] = useState<SubCertificateDerivedStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const projectName = (id: string) => projects.find((p) => p.id === id)?.nameAr ?? id;

  const filtered = useMemo(() => {
    const needle = search.trim();
    return certificates.filter(
      (c) =>
        (statusFilter === "all" || c.derivedStatus === statusFilter) &&
        (needle === "" ||
          c.docNo.includes(needle) ||
          c.subcontractDocNo.includes(needle) ||
          c.supplierNameAr.includes(needle) ||
          projectName(c.projectId).includes(needle)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certificates, statusFilter, search, projects]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selected = firstSegment
    ? (certificates.find((c) => c.docNo === firstSegment || c.id === firstSegment) ?? null)
    : null;

  if (firstSegment === "new") {
    return <NewSubCertificatePage onDone={(docNo) => subPage.open(docNo)} onCancel={() => subPage.close()} />;
  }

  if (firstSegment && selected && secondSegment === "print") {
    return <SubCertificatePrintPage certificateId={selected.id} onBack={() => subPage.open(selected.docNo)} />;
  }

  if (firstSegment && selected) {
    return (
      <SubCertificateDetailPage
        certificateId={selected.id}
        onBack={() => subPage.close()}
        onPrint={() => subPage.open(selected.docNo, "print")}
      />
    );
  }

  if (firstSegment && !certificatesQuery.isLoading && !selected) {
    return (
      <EmptyState
        title={t("subCertificates.notFound")}
        description={t("subCertificates.notFoundHint")}
        action={{ label: t("common.back"), onClick: () => subPage.close() }}
      />
    );
  }

  const columns: DocumentListColumn<SubCertificateDTO>[] = [
    {
      key: "docNo",
      header: t("subCertificates.column.docNo"),
      render: (c) => (
        <span className="mz-num font-semibold">
          {c.docNo} · {c.serial}
        </span>
      ),
    },
    { key: "subcontract", header: t("subCertificates.column.subcontract"), render: (c) => c.subcontractDocNo },
    { key: "supplier", header: t("subCertificates.column.supplier"), render: (c) => c.supplierNameAr },
    { key: "project", header: t("subCertificates.column.project"), render: (c) => projectName(c.projectId) },
    {
      key: "period",
      header: t("subCertificates.column.period"),
      render: (c) => (
        <span className="mz-num" dir="ltr">
          {c.periodFrom} → {c.periodTo}
        </span>
      ),
    },
    {
      key: "netCertified",
      header: t("subCertificates.column.netCertified"),
      align: "end",
      render: (c) => <MoneyValue value={majorOf(c.computed.netCertified)} showUnit={false} />,
      total: (rows) => <MoneyValue value={sumMajor(rows.map((r) => r.computed.netCertified))} showUnit={false} />,
    },
    {
      key: "status",
      header: t("subCertificates.column.status"),
      render: (c) => (
        <StatusPill label={t(SUB_CERTIFICATE_STATUS_KEY[c.derivedStatus])} tone={SUB_CERTIFICATE_STATUS_TONE[c.derivedStatus]} />
      ),
    },
  ];

  const countOf = (status: SubCertificateDerivedStatusDTO) => certificates.filter((c) => c.derivedStatus === status).length;

  return (
    <DocumentList<SubCertificateDTO>
      title={t("subCertificates.title")}
      description={t("subCertificates.description")}
      actions={
        mayPrepare ? (
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("subCertificates.new")}
          </Button>
        ) : null
      }
      stats={[
        {
          label: t("subCertificates.stat.netCertified"),
          value: <MoneyValue value={sumMajor(certificates.map((c) => c.computed.thisCertificateNetCertified))} showUnit={false} />,
        },
        { label: t("subCertificates.stat.awaitingApproval"), value: <span className="mz-num">{countOf("certified")}</span> },
        { label: t("subCertificates.stat.invoiced"), value: <span className="mz-num">{countOf("invoiced")}</span> },
      ]}
      statusChips={[
        { key: "all", label: t("common.all"), count: certificates.length },
        { key: "draft", label: t("subCertificates.status.draft"), count: countOf("draft") },
        { key: "measured", label: t("subCertificates.status.measured"), count: countOf("measured") },
        { key: "certified", label: t("subCertificates.status.certified"), count: countOf("certified") },
        { key: "approved_for_payment", label: t("subCertificates.status.approvedForPayment"), count: countOf("approved_for_payment") },
        { key: "invoiced", label: t("subCertificates.status.invoiced"), count: countOf("invoiced") },
      ]}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as SubCertificateDerivedStatusDTO | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("subCertificates.searchPlaceholder")}
      columns={columns}
      rows={pageRows}
      rowKey={(c) => c.id}
      loading={certificatesQuery.isLoading}
      loadFailed={certificatesQuery.isError}
      onRowClick={(c) => subPage.open(c.docNo)}
      page={currentPage}
      pageCount={pageCount}
      onPageChange={setPage}
      emptyState={
        <EmptyState
          title={t("subCertificates.empty")}
          description={t("subCertificates.emptyHint")}
          {...(mayPrepare ? { action: { label: t("subCertificates.new"), onClick: () => subPage.open("new") } } : {})}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* مستخلص باطن جديد                                                     */
/* ------------------------------------------------------------------ */

function NewSubCertificatePage({ onDone, onCancel }: { onDone: (docNo: string) => void; onCancel: () => void }) {
  const { t } = useAppTranslation();
  const subcontracts = useSubcontracts({ status: "active" }).data ?? EMPTY;
  const create = useCreateSubCertificate();

  const [subcontract, setSubcontract] = useState<EntityPickerOption | null>(null);
  const [periodFrom, setPeriodFrom] = useState(monthStart());
  const [periodTo, setPeriodTo] = useState(todayIso());
  const [executionDate, setExecutionDate] = useState(todayIso());
  const [isFinal, setIsFinal] = useState(false);
  const [notes, setNotes] = useState("");
  const [work, setWork] = useState<Record<string, string>>({});
  const [manual, setManual] = useState({
    penaltiesCumulative: "0",
    suspendedCumulative: "0",
    employerMaterialsCumulative: "0",
    waterElectricityCumulative: "0",
  });
  const [employerMaterialsTouched, setEmployerMaterialsTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = subcontracts.find((s) => s.id === subcontract?.id) ?? null;
  const subcontractLines = selected?.lines ?? EMPTY;

  const previewBody: PreviewSubCertificateDTO | null = subcontract
    ? {
        subcontractId: subcontract.id,
        periodFrom,
        periodTo,
        executionDate,
        isFinal,
        workLines: subcontractLines.map((l) => ({ subcontractLineId: l.id, thisPeriodQty: work[l.id]?.trim() || "0" })),
        ...manual,
      }
    : null;
  const preview = useSubCertificatePreview(previewBody);

  useEffect(() => {
    if (!employerMaterialsTouched && preview.data) {
      setManual((prev) => ({ ...prev, employerMaterialsCumulative: trimScale(preview.data!.employerMaterialsPrefill) || "0" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data?.employerMaterialsPrefill]);

  async function save() {
    setError(null);
    if (!subcontract || !previewBody) {
      setError(t("subCertificates.missingSubcontract"));
      return;
    }
    try {
      const created = await create.mutateAsync({
        id: `SMST-${Date.now()}`,
        ...previewBody,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      onDone(created.docNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subCertificates.saveFailed"));
    }
  }

  const rows = preview.data?.workLines ?? EMPTY;

  return (
    <div className="w-full">
      <div className="mb-[14px] flex items-center justify-between gap-[12px]">
        <h1 className="font-display text-xl font-bold text-ink">{t("subCertificates.new")}</h1>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>

      {error ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}

      <Card className="mb-[16px] p-[16px_18px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("subCertificates.section.header")}</h2>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <EntityPicker
            label={t("subCertificates.field.subcontract")}
            value={subcontract}
            onChange={setSubcontract}
            options={subcontracts.map((s) => ({ id: s.id, label: s.titleAr, sublabel: `${s.docNo} · ${s.supplierNameAr}` }))}
            placeholder={t("subCertificates.pickSubcontract")}
            emptyMessage={t("subCertificates.noActiveSubcontracts")}
          />
          <TextField label={t("subCertificates.field.periodFrom")} value={periodFrom} onChange={setPeriodFrom} type="date" />
          <TextField label={t("subCertificates.field.periodTo")} value={periodTo} onChange={setPeriodTo} type="date" />
          <TextField
            label={t("subCertificates.field.executionDate")}
            value={executionDate}
            onChange={setExecutionDate}
            type="date"
            hint={t("subCertificates.hint.executionDate")}
          />
        </div>
        <div className="mt-[12px] flex flex-wrap items-center gap-[14px]">
          <Checkbox label={t("subCertificates.field.isFinal")} checked={isFinal} onChange={(e) => setIsFinal(e.target.checked)} />
          {preview.data ? (
            <span className="mz-num text-[12.5px] font-semibold text-ink">
              {t("subCertificates.serialPreview", { serial: String(preview.data.serial) })}
            </span>
          ) : null}
        </div>
        <div className="mt-[12px]">
          <TextAreaField label={t("common.notes")} value={notes} onChange={setNotes} rows={2} />
        </div>
      </Card>

      {subcontract ? (
        <>
          <Card className="mb-[16px] p-[16px_18px]">
            <h2 className="mb-[4px] text-[13px] font-bold text-ink">{t("subCertificates.section.workLines")}</h2>
            <p className="mb-[12px] text-[11.5px] text-ink-muted">{t("subCertificates.serverDerivedHint")}</p>
            {subcontractLines.length === 0 ? (
              <EmptyState title={t("subCertificates.noLines")} description={t("subCertificates.noLinesHint")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="p-[7px_8px] text-start">{t("subCertificates.col.item")}</th>
                      <th className="p-[7px_8px] text-start">{t("subCertificates.col.unit")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.contractedQty")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.clientCeiling")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.previous")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.thisPeriod")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.cumulative")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.completion")}</th>
                      <th className="p-[7px_8px] text-end">{t("subCertificates.col.value")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subcontractLines.map((line) => {
                      const row = rows.find((r) => r.subcontractLineId === line.id);
                      const overCeiling = row && Number(row.cumulativeQty) > Number(row.clientCertifiedCumulativeQty);
                      return (
                        <tr key={line.id} className="border-b border-border">
                          <td className="p-[7px_8px]">
                            <span className="mz-num text-ink-muted">{line.code}</span> {line.descriptionAr}
                          </td>
                          <td className="p-[7px_8px]">{unitLabel(line.unit, t)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row?.contractedQty)}</td>
                          <td className={`mz-num p-[7px_8px] text-end ${overCeiling ? "font-bold text-danger-ink" : "text-ink-muted"}`}>
                            {trimScale(row?.clientCertifiedCumulativeQty)}
                          </td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row?.previousCumulativeQty)}</td>
                          <td className="p-[7px_8px] text-end">
                            <TextInput
                              value={work[line.id] ?? ""}
                              onChange={(e) => setWork((prev) => ({ ...prev, [line.id]: e.target.value }))}
                              aria-label={t("subCertificates.col.thisPeriod")}
                              className="w-[96px] text-end"
                            />
                          </td>
                          <td className={`mz-num p-[7px_8px] text-end font-semibold ${overCeiling ? "text-danger-ink" : ""}`}>
                            {trimScale(row?.cumulativeQty)}
                          </td>
                          <td className="mz-num p-[7px_8px] text-end">{formatPercent(row?.completionPercent) || "—"}%</td>
                          <td className="mz-num p-[7px_8px] text-end">
                            {row ? <MoneyValue value={majorOf(row.cumulativeValue)} showUnit={false} /> : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="mb-[16px] p-[16px_18px]">
            <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("subCertificates.section.manual")}</h2>
            <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
              <TextField
                label={t("subCertificates.deduction.penalties")}
                value={manual.penaltiesCumulative}
                onChange={(v) => setManual((p) => ({ ...p, penaltiesCumulative: v }))}
                hint={t("subCertificates.hint.cumulativeAmount")}
              />
              <TextField
                label={t("subCertificates.deduction.suspended")}
                value={manual.suspendedCumulative}
                onChange={(v) => setManual((p) => ({ ...p, suspendedCumulative: v }))}
              />
              <TextField
                label={t("subCertificates.deduction.employerMaterials")}
                value={manual.employerMaterialsCumulative}
                onChange={(v) => {
                  setEmployerMaterialsTouched(true);
                  setManual((p) => ({ ...p, employerMaterialsCumulative: v }));
                }}
                hint={t("subCertificates.hint.employerMaterialsPrefill")}
              />
              <TextField
                label={t("subCertificates.deduction.waterElectricity")}
                value={manual.waterElectricityCumulative}
                onChange={(v) => setManual((p) => ({ ...p, waterElectricityCumulative: v }))}
              />
            </div>
          </Card>

          {preview.data && preview.data.refusals.length > 0 ? (
            <Card className="mb-[16px] border-danger p-[14px_16px]">
              <h3 className="mb-[6px] text-[12.5px] font-bold text-danger-ink">{t("subCertificates.refusalsTitle")}</h3>
              <ul className="flex flex-col gap-[4px]">
                {preview.data.refusals.map((reason) => (
                  <li key={reason} className="text-[12px] text-danger-ink">
                    {reason}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {preview.data ? <DeductionsBlock computed={preview.data.computed} /> : null}
        </>
      ) : null}

      <div className="flex justify-end gap-[9px]">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={create.isPending || !subcontract}>
          {t("subCertificates.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* تفاصيل مستخلص الباطن                                                  */
/* ------------------------------------------------------------------ */

function SubCertificateDetailPage({
  certificateId,
  onBack,
  onPrint,
}: {
  certificateId: string;
  onBack: () => void;
  onPrint: () => void;
}) {
  const { t } = useAppTranslation();
  const { openScreenAt } = useNavigation();
  const query = useSubCertificate(certificateId);
  const transition = useSubCertificateTransition();
  const update = useUpdateSubCertificate();
  const projects = useProjects().data ?? EMPTY;
  const [approvedAt, setApprovedAt] = useState(todayIso());
  const [signedAt, setSignedAt] = useState(todayIso());
  const [cancelReason, setCancelReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftQty, setDraftQty] = useState<Record<string, string> | null>(null);

  const { session } = useApi();
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });

  const certificate = query.data;
  if (!certificate) {
    return query.isLoading ? null : (
      <EmptyState
        title={t("subCertificates.notFound")}
        description={t("subCertificates.notFoundHint")}
        action={{ label: t("common.back"), onClick: onBack }}
      />
    );
  }

  const mayPrepare = can(authContext, "contracting.certificate.prepare");
  const mayCertify = can(authContext, "contracting.certificate.certify");
  const mayApprove = can(authContext, "contracting.certificate.approve");
  const editable = mayPrepare && (certificate.status === "draft" || certificate.status === "measured") && !certificate.hasLaterCertificate;

  async function move(action: "measure" | "certify" | "approve" | "cancel") {
    setError(null);
    try {
      if (action === "cancel" && cancelReason.trim() === "") {
        setError(t("subCertificates.cancelReasonRequired"));
        return;
      }
      await transition.mutateAsync({
        id: certificate!.id,
        action,
        ...(action === "approve" ? { body: { approvedAt } } : {}),
        ...(action === "measure" ? { body: { measuredAt: signedAt } } : {}),
        ...(action === "certify" ? { body: { certifiedAt: signedAt } } : {}),
        ...(action === "cancel" ? { body: { reasonAr: cancelReason.trim() } } : {}),
      });
      if (action === "cancel") setCancelReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subCertificates.transitionFailed"));
    }
  }

  async function saveLines() {
    setError(null);
    if (!draftQty) return;
    try {
      await update.mutateAsync({
        id: certificate!.id,
        patch: {
          workLines: certificate!.workLines.map((l) => ({
            subcontractLineId: l.subcontractLineId,
            thisPeriodQty: draftQty[l.subcontractLineId] ?? trimScale(l.thisPeriodQty) ?? "0",
          })),
        },
      });
      setDraftQty(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subCertificates.saveFailed"));
    }
  }

  const projectName = projects.find((p) => p.id === certificate.projectId)?.nameAr ?? certificate.projectId;
  const computed = certificate.computed;

  return (
    <DocumentDetail
      title={`${certificate.docNo} — ${t("subCertificates.serialTitle", { serial: String(certificate.serial) })}`}
      statusLabel={t(SUB_CERTIFICATE_STATUS_KEY[certificate.derivedStatus])}
      statusTone={SUB_CERTIFICATE_STATUS_TONE[certificate.derivedStatus]}
      subtitle={`${certificate.subcontractDocNo} · ${projectName} · ${certificate.supplierNameAr}`}
      actions={
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={onBack}>{t("common.back")}</Button>
          <Button onClick={onPrint}>{t("subCertificates.print")}</Button>
          {certificate.hasLaterCertificate ? (
            <span className="text-[12px] font-semibold text-warning-ink">{t("subCertificates.lockedByLater")}</span>
          ) : (
            <>
              {mayPrepare && certificate.status === "draft" ? (
                <>
                  <TextInput
                    type="date"
                    value={signedAt}
                    onChange={(e) => setSignedAt(e.target.value)}
                    aria-label={t("subCertificates.field.measuredAt")}
                  />
                  <Button variant="primary" onClick={() => void move("measure")} disabled={transition.isPending}>
                    {t("subCertificates.action.measure")}
                  </Button>
                </>
              ) : null}
              {mayCertify && certificate.status === "measured" ? (
                <>
                  <TextInput
                    type="date"
                    value={signedAt}
                    onChange={(e) => setSignedAt(e.target.value)}
                    aria-label={t("subCertificates.field.certifiedAt")}
                  />
                  <Button variant="primary" onClick={() => void move("certify")} disabled={transition.isPending}>
                    {t("subCertificates.action.certify")}
                  </Button>
                </>
              ) : null}
              {mayApprove && certificate.status === "certified" ? (
                <>
                  <TextInput
                    type="date"
                    value={approvedAt}
                    onChange={(e) => setApprovedAt(e.target.value)}
                    aria-label={t("subCertificates.field.approvedAt")}
                    disabled={certificate.payabilityRefusals.length > 0}
                  />
                  <Button
                    variant="primary"
                    onClick={() => void move("approve")}
                    disabled={transition.isPending || certificate.payabilityRefusals.length > 0}
                  >
                    {t("subCertificates.action.approve")}
                  </Button>
                </>
              ) : null}
              {mayPrepare && (certificate.status === "draft" || certificate.status === "measured") ? (
                <>
                  <TextInput
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={t("subCertificates.field.cancelReason")}
                    aria-label={t("subCertificates.field.cancelReason")}
                  />
                  <Button
                    onClick={() => void move("cancel")}
                    disabled={transition.isPending || cancelReason.trim() === ""}
                  >
                    {t("subCertificates.action.cancel")}
                  </Button>
                </>
              ) : null}
            </>
          )}
        </div>
      }
      summary={[
        { label: t("subCertificates.kpi.grossWorks"), value: <MoneyValue value={majorOf(computed.grossWorks)} showUnit={false} /> },
        { label: t("subCertificates.kpi.completion"), value: <span className="mz-num">{formatPercent(computed.completionPercent)}%</span> },
        { label: t("subCertificates.kpi.retentionHeld"), value: <MoneyValue value={majorOf(computed.retentionHeldCumulative)} showUnit={false} /> },
        { label: t("subCertificates.kpi.advanceOutstanding"), value: <MoneyValue value={majorOf(computed.advanceOutstanding)} showUnit={false} /> },
        { label: t("subCertificates.kpi.netPayable"), value: <MoneyValue value={majorOf(computed.netPayableThisCertificate)} showUnit={false} /> },
      ]}
      tabs={[
        {
          key: "lines",
          label: t("subCertificates.tab.lines"),
          content: (
            <div className="flex flex-col gap-[16px]">
              {error ? <p className="text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
              {certificate.payabilityRefusals.length > 0 ? (
                <Card className="border-danger p-[14px_16px]">
                  <h3 className="mb-[6px] text-[12.5px] font-bold text-danger-ink">{t("subCertificates.payabilityRefusalsTitle")}</h3>
                  <ul className="flex flex-col gap-[4px]">
                    {certificate.payabilityRefusals.map((reason) => (
                      <li key={reason} className="text-[12px] text-danger-ink">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              <Card className="p-[14px_16px]">
                <DocumentStatusStepper
                  steps={SUB_CERTIFICATE_STEPS.map((key) => ({ key, label: t(SUB_CERTIFICATE_STATUS_KEY[key]) }))}
                  currentKey={certificate.derivedStatus}
                  tone={certificate.status === "cancelled" ? "danger" : "brand"}
                />
              </Card>
              <Card className="p-[14px_16px]">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-border text-ink-muted">
                        <th className="p-[7px_8px] text-start">{t("subCertificates.col.item")}</th>
                        <th className="p-[7px_8px] text-start">{t("subCertificates.col.unit")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.contractedQty")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.clientCeiling")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.previous")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.thisPeriod")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.cumulative")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.completion")}</th>
                        <th className="p-[7px_8px] text-end">{t("subCertificates.col.value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {certificate.workLines.map((row) => {
                        const overCeiling = Number(row.cumulativeQty) > Number(row.clientCertifiedCumulativeQty);
                        return (
                          <tr key={row.id} className="border-b border-border">
                            <td className="p-[7px_8px]">
                              <span className="mz-num text-ink-muted">{row.code}</span> {row.descriptionAr}
                            </td>
                            <td className="p-[7px_8px]">{unitLabel(row.unit, t)}</td>
                            <td className="mz-num p-[7px_8px] text-end">{trimScale(row.contractedQty)}</td>
                            <td className={`mz-num p-[7px_8px] text-end ${overCeiling ? "font-bold text-danger-ink" : "text-ink-muted"}`}>
                              {trimScale(row.clientCertifiedCumulativeQty)}
                            </td>
                            <td className="mz-num p-[7px_8px] text-end">{trimScale(row.previousCumulativeQty)}</td>
                            <td className="p-[7px_8px] text-end">
                              {editable ? (
                                <TextInput
                                  value={draftQty?.[row.subcontractLineId] ?? trimScale(row.thisPeriodQty)}
                                  onChange={(e) =>
                                    setDraftQty((prev) => ({ ...(prev ?? {}), [row.subcontractLineId]: e.target.value }))
                                  }
                                  aria-label={t("subCertificates.col.thisPeriod")}
                                  className="w-[96px] text-end"
                                />
                              ) : (
                                <span className="mz-num">{trimScale(row.thisPeriodQty)}</span>
                              )}
                            </td>
                            <td className={`mz-num p-[7px_8px] text-end font-semibold ${overCeiling ? "text-danger-ink" : ""}`}>
                              {trimScale(row.cumulativeQty)}
                            </td>
                            <td className="mz-num p-[7px_8px] text-end">{formatPercent(row.completionPercent)}%</td>
                            <td className="mz-num p-[7px_8px] text-end">
                              <MoneyValue value={majorOf(row.cumulativeValue)} showUnit={false} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {editable && draftQty ? (
                  <div className="mt-[12px] flex justify-end gap-[9px]">
                    <Button onClick={() => setDraftQty(null)}>{t("common.cancel")}</Button>
                    <Button variant="primary" onClick={() => void saveLines()} disabled={update.isPending}>
                      {t("common.save")}
                    </Button>
                  </div>
                ) : null}
              </Card>

              <DeductionsBlock computed={computed} />
            </div>
          ),
        },
        {
          key: "invoice",
          label: t("subCertificates.tab.invoice"),
          content: (
            <SubCertificateInvoicePanel
              certificate={certificate}
              onOpenInvoice={(docNo) => openScreenAt("purchase-invoices", [docNo])}
            />
          ),
        },
      ]}
    />
  );
}

function SubCertificateInvoicePanel({
  certificate,
  onOpenInvoice,
}: {
  certificate: SubCertificateDTO;
  onOpenInvoice: (docNo: string) => void;
}) {
  const { t } = useAppTranslation();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-[10px] border-b border-border py-[7px] last:border-b-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="text-[12.5px] font-semibold text-ink">{value}</span>
    </div>
  );

  if (!certificate.invoice) {
    return <EmptyState title={t("subCertificates.noInvoice")} description={t("subCertificates.noInvoiceHint")} />;
  }

  return (
    <Card className="p-[14px_16px]">
      <div className="mb-[8px] flex items-center justify-between gap-[10px]">
        <h3 className="text-[12.5px] font-bold text-ink">{t("subCertificates.section.invoice")}</h3>
        {certificate.invoice.docNo ? (
          <Button size="sm" onClick={() => onOpenInvoice(certificate.invoice!.docNo!)}>
            {t("subCertificates.openInvoice")}
          </Button>
        ) : null}
      </div>
      {row(t("subCertificates.field.invoice"), <span className="mz-num">{certificate.invoice.docNo ?? "—"}</span>)}
      {row(t("subCertificates.field.invoiceTotal"), <MoneyValue value={majorOf(certificate.invoice.total)} showUnit={false} />)}
      {row(t("subCertificates.field.amountPaid"), <MoneyValue value={majorOf(certificate.invoice.amountPaid)} showUnit={false} />)}
      {row(t("subCertificates.field.remainingBalance"), <MoneyValue value={majorOf(certificate.invoice.remainingBalance)} showUnit={false} />)}
      {row(t("subCertificates.field.dueDate"), <span className="mz-num">{certificate.invoice.dueDate ?? "—"}</span>)}
      {row(t("subCertificates.field.invoiceStatus"), certificate.invoice.status)}
    </Card>
  );
}

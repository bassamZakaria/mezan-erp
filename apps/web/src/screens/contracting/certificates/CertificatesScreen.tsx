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
import type {
  CertificateComputationDTO,
  CertificateMaterialLineInputDTO,
  PreviewProgressCertificateDTO,
  ProgressCertificateDTO,
  ProgressCertificateDerivedStatusDTO,
} from "@mezan/contracts";
import { SelectField, TextAreaField, TextField } from "../../../settings/form-controls";
import { useSubPage } from "../../../navigation";
import { useApi } from "../../../data/ApiContext";
import { useCustomers, useProjects } from "../../../data/hooks";
import { useWorksContracts, useContractBoq } from "../../../data/contracting-contracts-hooks";
import {
  useCertificatePreview,
  useCreateProgressCertificate,
  useProgressCertificate,
  useProgressCertificateTransition,
  useProgressCertificates,
  useUpdateProgressCertificate,
} from "../../../data/contracting-certificates-hooks";
import { useAppTranslation } from "../../../i18n";
import { majorOf, sumMajor } from "../../../lib/money";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { BOQ_UNITS, unitLabel } from "../../../lib/boq-unit-label";
import { formatPercent } from "../../../lib/percent";
import { CERTIFICATE_STATUS_KEY, CERTIFICATE_STATUS_TONE, CERTIFICATE_STEPS, trimScale } from "./certificate-common";
import { CertificatePrintPage } from "./CertificatePrintPage";

/**
 * المستخلصات — the cumulative progress certificate (design §04).
 *
 * Every column but «هذا المستخلص» is the server's: «سابق», «تراكمي», «%» and
 * «القيمة» are derived from the previous certificate and from the variation
 * orders approved before the execution date, and the whole deductions block
 * comes back from `/preview` while the surveyor types. Nothing on this screen
 * recomputes money.
 */

interface WorkDraft {
  boqLineId: string;
  code: string;
  descriptionAr: string;
  unit: string;
  thisPeriodQty: string;
}

interface MaterialDraft {
  materialKey: string;
  descriptionAr: string;
  unit: string;
  qty: string;
  unitRate: string;
}

/** The certificate's stored materials, as the editable form holds them. */
function materialDraftsOf(certificate: ProgressCertificateDTO): MaterialDraft[] {
  return certificate.materialLines.map((line) => ({
    materialKey: line.materialKey,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    qty: trimScale(line.qty),
    unitRate: trimScale(line.unitRate),
  }));
}

function monthStart(): string {
  const today = todayIso();
  return `${today.slice(0, 8)}01`;
}

export function CertificatesScreen() {
  const { t } = useAppTranslation();
  const subPage = useSubPage();
  const [firstSegment, secondSegment] = subPage.segments;

  const certificatesQuery = useProgressCertificates();
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

  const [statusFilter, setStatusFilter] = useState<ProgressCertificateDerivedStatusDTO | "all">("all");
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
          c.contractDocNo.includes(needle) ||
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
    return <NewCertificatePage onDone={(docNo) => subPage.open(docNo)} onCancel={() => subPage.close()} />;
  }

  if (firstSegment && selected && secondSegment === "print") {
    return <CertificatePrintPage certificateId={selected.id} onBack={() => subPage.open(selected.docNo)} />;
  }

  if (firstSegment && selected) {
    return (
      <CertificateDetailPage
        certificateId={selected.id}
        onBack={() => subPage.close()}
        onPrint={() => subPage.open(selected.docNo, "print")}
      />
    );
  }

  if (firstSegment && !certificatesQuery.isLoading && !selected) {
    return (
      <EmptyState
        title={t("certificates.notFound")}
        description={t("certificates.notFoundHint")}
        action={{ label: t("common.back"), onClick: () => subPage.close() }}
      />
    );
  }

  const columns: DocumentListColumn<ProgressCertificateDTO>[] = [
    {
      key: "docNo",
      header: t("certificates.column.docNo"),
      render: (c) => (
        <span className="font-semibold">
          <span className="mz-num">{c.docNo}</span>{" "}
          {t(c.isFinal ? "certificates.finalSerial" : "certificates.interimSerial", { serial: String(c.serial) })}
        </span>
      ),
    },
    { key: "contract", header: t("certificates.column.contract"), render: (c) => c.contractDocNo },
    { key: "project", header: t("certificates.column.project"), render: (c) => projectName(c.projectId) },
    {
      key: "period",
      header: t("certificates.column.period"),
      render: (c) => (
        <span className="mz-num" dir="ltr">
          {c.periodFrom} → {c.periodTo}
        </span>
      ),
    },
    {
      key: "netCertified",
      header: t("certificates.column.netCertified"),
      align: "end",
      // No footer total: netCertified is CUMULATIVE to date, so summing it
      // down the list adds the same work once per certificate. netPayable is a
      // period figure and does total.
      render: (c) => <MoneyValue value={majorOf(c.computed.netCertified)} showUnit={false} />,
    },
    {
      key: "netPayable",
      header: t("certificates.column.netPayable"),
      align: "end",
      render: (c) => <MoneyValue value={majorOf(c.computed.netPayableThisCertificate)} showUnit={false} />,
      total: (rows) => (
        <MoneyValue value={sumMajor(rows.map((r) => r.computed.netPayableThisCertificate))} showUnit={false} />
      ),
    },
    {
      key: "status",
      header: t("certificates.column.status"),
      render: (c) => (
        <StatusPill label={t(CERTIFICATE_STATUS_KEY[c.derivedStatus])} tone={CERTIFICATE_STATUS_TONE[c.derivedStatus]} />
      ),
    },
  ];

  const countOf = (status: ProgressCertificateDerivedStatusDTO) =>
    certificates.filter((c) => c.derivedStatus === status).length;

  return (
    <DocumentList<ProgressCertificateDTO>
      title={t("certificates.title")}
      description={t("certificates.description")}
      actions={
        mayPrepare ? (
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("certificates.new")}
          </Button>
        ) : null
      }
      stats={[
        {
          label: t("certificates.stat.netCertified"),
          value: <MoneyValue value={sumMajor(certificates.map((c) => c.computed.thisCertificateNetCertified))} showUnit={false} />,
        },
        {
          label: t("certificates.stat.retentionHeld"),
          value: (
            <MoneyValue
              value={sumMajor(
                certificates
                  .filter((c) => c.status === "invoiced" || c.status === "approved_for_payment")
                  .map((c) => c.computed.deductions.find((d) => d.key === "retention")?.thisCertificate ?? "0"),
              )}
              showUnit={false}
            />
          ),
        },
        { label: t("certificates.stat.awaitingFinance"), value: <span className="mz-num">{countOf("certified")}</span> },
      ]}
      statusChips={[
        { key: "all", label: t("common.all"), count: certificates.length },
        { key: "draft", label: t("certificates.status.draft"), count: countOf("draft") },
        { key: "measured", label: t("certificates.status.measured"), count: countOf("measured") },
        { key: "certified", label: t("certificates.status.certified"), count: countOf("certified") },
        { key: "invoiced", label: t("certificates.status.invoiced"), count: countOf("invoiced") },
        { key: "collected", label: t("certificates.status.collected"), count: countOf("collected") },
      ]}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as ProgressCertificateDerivedStatusDTO | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("certificates.searchPlaceholder")}
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
          title={t("certificates.empty")}
          description={t("certificates.emptyHint")}
          {...(mayPrepare ? { action: { label: t("certificates.new"), onClick: () => subPage.open("new") } } : {})}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* مستخلص جديد                                                          */
/* ------------------------------------------------------------------ */

function NewCertificatePage({ onDone, onCancel }: { onDone: (docNo: string) => void; onCancel: () => void }) {
  const { t } = useAppTranslation();
  const contracts = useWorksContracts({ status: "active" }).data ?? EMPTY;
  const create = useCreateProgressCertificate();

  const [contract, setContract] = useState<EntityPickerOption | null>(null);
  const [periodFrom, setPeriodFrom] = useState(monthStart());
  const [periodTo, setPeriodTo] = useState(todayIso());
  const [executionDate, setExecutionDate] = useState(todayIso());
  const [isFinal, setIsFinal] = useState(false);
  const [notes, setNotes] = useState("");
  const [work, setWork] = useState<Record<string, string>>({});
  const [materials, setMaterials] = useState<MaterialDraft[]>([]);
  const [manual, setManual] = useState({
    penaltiesCumulative: "0",
    suspendedCumulative: "0",
    employerMaterialsCumulative: "0",
    waterElectricityCumulative: "0",
  });
  const [error, setError] = useState<string | null>(null);

  const boq = useContractBoq(contract?.id ?? null).data?.lines ?? EMPTY;

  const previewBody: PreviewProgressCertificateDTO | null = contract
    ? {
        contractId: contract.id,
        periodFrom,
        periodTo,
        executionDate,
        isFinal,
        workLines: boq.map((l) => ({ boqLineId: l.id, thisPeriodQty: work[l.id]?.trim() || "0" })),
        materialLines: materials
          .filter((m) => m.materialKey.trim() !== "")
          .map(
            (m): CertificateMaterialLineInputDTO => ({
              materialKey: m.materialKey.trim(),
              descriptionAr: m.descriptionAr.trim() || m.materialKey.trim(),
              unit: m.unit as CertificateMaterialLineInputDTO["unit"],
              qty: m.qty.trim() || "0",
              unitRate: m.unitRate.trim() || "0",
            }),
          ),
        ...manual,
      }
    : null;
  const preview = useCertificatePreview(previewBody);

  /**
   * التشوينات carried forward by the server — material certified on an earlier
   * certificate that stays on this one at its cumulative value. It was
   * invisible here, so the surveyor could not see what was already stored, let
   * alone enter the negative quantity that incorporates it.
   *
   * Only rows the form does not already hold are appended, and each keeps its
   * own index, so typing in one row never re-creates the others.
   */
  const carried = preview.data?.materialLines;
  useEffect(() => {
    if (!carried || carried.length === 0) return;
    setMaterials((current) => {
      const known = new Set(current.map((m) => m.materialKey.trim()));
      const missing = carried
        .filter((line) => !known.has(line.materialKey))
        .map((line) => ({
          materialKey: line.materialKey,
          descriptionAr: line.descriptionAr,
          unit: line.unit,
          qty: "0",
          unitRate: trimScale(line.unitRate),
        }));
      return missing.length === 0 ? current : [...current, ...missing];
    });
  }, [carried]);

  async function save() {
    setError(null);
    if (!contract || !previewBody) {
      setError(t("certificates.missingContract"));
      return;
    }
    try {
      const created = await create.mutateAsync({
        id: `MST-${Date.now()}`,
        ...previewBody,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      onDone(created.docNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("certificates.saveFailed"));
    }
  }

  const rows = preview.data?.workLines ?? EMPTY;

  return (
    <div className="w-full">
      <div className="mb-[14px] flex items-center justify-between gap-[12px]">
        <h1 className="font-display text-xl font-bold text-ink">{t("certificates.new")}</h1>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>

      {error ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}

      <Card className="mb-[16px] p-[16px_18px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("certificates.section.header")}</h2>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <EntityPicker
            label={t("certificates.field.contract")}
            value={contract}
            onChange={setContract}
            options={contracts.map((c) => ({ id: c.id, label: c.titleAr, sublabel: c.docNo }))}
            placeholder={t("certificates.pickContract")}
            emptyMessage={t("certificates.noActiveContracts")}
          />
          <TextField label={t("certificates.field.periodFrom")} value={periodFrom} onChange={setPeriodFrom} type="date" />
          <TextField label={t("certificates.field.periodTo")} value={periodTo} onChange={setPeriodTo} type="date" />
          <TextField
            label={t("certificates.field.executionDate")}
            value={executionDate}
            onChange={setExecutionDate}
            type="date"
            hint={t("certificates.hint.executionDate")}
          />
        </div>
        <div className="mt-[12px] flex flex-wrap items-center gap-[14px]">
          <Checkbox
            label={t("certificates.field.isFinal")}
            hint={t("certificates.hint.isFinal")}
            checked={isFinal}
            onChange={(e) => setIsFinal(e.target.checked)}
          />
          {preview.data ? (
            <span className="mz-num text-[12.5px] font-semibold text-ink">
              {t("certificates.serialPreview", { serial: String(preview.data.serial) })}
            </span>
          ) : null}
        </div>
        <div className="mt-[12px]">
          <TextAreaField label={t("common.notes")} value={notes} onChange={setNotes} rows={2} />
        </div>
      </Card>

      {contract ? (
        <>
          <Card className="mb-[16px] p-[16px_18px]">
            <h2 className="mb-[4px] text-[13px] font-bold text-ink">{t("certificates.section.workLines")}</h2>
            <p className="mb-[12px] text-[11.5px] text-ink-muted">{t("certificates.serverDerivedHint")}</p>
            {boq.length === 0 ? (
              <EmptyState title={t("certificates.noBoq")} description={t("certificates.noBoqHint")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-ink-muted">
                      <th className="p-[7px_8px] text-start">{t("certificates.col.item")}</th>
                      <th className="p-[7px_8px] text-start">{t("certificates.col.unit")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.contractedQty")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.unitRate")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.previous")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.thisPeriod")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.cumulative")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.completion")}</th>
                      <th className="p-[7px_8px] text-end">{t("certificates.col.value")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {boq.map((boqLine) => {
                      const row = rows.find((r) => r.boqLineId === boqLine.id);
                      return (
                        <tr key={boqLine.id} className="border-b border-border">
                          <td className="p-[7px_8px]">
                            <span className="mz-num text-ink-muted">{boqLine.code}</span> {boqLine.descriptionAr}
                          </td>
                          <td className="p-[7px_8px]">{unitLabel(boqLine.unit, t)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row?.contractedQty)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row?.unitRate)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row?.previousCumulativeQty)}</td>
                          <td className="p-[7px_8px] text-end">
                            <TextInput
                              value={work[boqLine.id] ?? ""}
                              onChange={(e) => setWork((prev) => ({ ...prev, [boqLine.id]: e.target.value }))}
                              aria-label={t("certificates.col.thisPeriod")}
                              className="w-[96px] text-end"
                            />
                          </td>
                          <td className="mz-num p-[7px_8px] text-end font-semibold">{trimScale(row?.cumulativeQty)}</td>
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

          <MaterialsCard materials={materials} onChange={setMaterials} />

          <Card className="mb-[16px] p-[16px_18px]">
            <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("certificates.section.manual")}</h2>
            <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
              <TextField
                label={t("certificates.deduction.penalties")}
                value={manual.penaltiesCumulative}
                onChange={(v) => setManual((p) => ({ ...p, penaltiesCumulative: v }))}
                hint={t("certificates.hint.cumulativeAmount")}
              />
              <TextField
                label={t("certificates.deduction.suspended")}
                value={manual.suspendedCumulative}
                onChange={(v) => setManual((p) => ({ ...p, suspendedCumulative: v }))}
                hint={t("certificates.hint.suspended")}
              />
              <TextField
                label={t("certificates.deduction.employerMaterials")}
                value={manual.employerMaterialsCumulative}
                onChange={(v) => setManual((p) => ({ ...p, employerMaterialsCumulative: v }))}
                hint={t("certificates.hint.cumulativeAmount")}
              />
              <TextField
                label={t("certificates.deduction.waterElectricity")}
                value={manual.waterElectricityCumulative}
                onChange={(v) => setManual((p) => ({ ...p, waterElectricityCumulative: v }))}
                hint={t("certificates.hint.cumulativeAmount")}
              />
            </div>
          </Card>

          {preview.data && preview.data.refusals.length > 0 ? (
            <Card className="mb-[16px] border-danger p-[14px_16px]">
              <h3 className="mb-[6px] text-[12.5px] font-bold text-danger-ink">{t("certificates.refusalsTitle")}</h3>
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
        <Button variant="primary" onClick={() => void save()} disabled={create.isPending || !contract}>
          {t("certificates.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

function MaterialsCard({
  materials,
  onChange,
}: {
  materials: MaterialDraft[];
  onChange: (next: MaterialDraft[]) => void;
}) {
  const { t } = useAppTranslation();
  const unitOptions = BOQ_UNITS.map((unit) => ({ value: unit, label: unitLabel(unit, t) }));
  return (
    <Card className="mb-[16px] p-[16px_18px]">
      <div className="mb-[4px] flex items-center justify-between gap-[10px]">
        <h2 className="text-[13px] font-bold text-ink">{t("certificates.section.materials")}</h2>
        <Button
          onClick={() =>
            onChange([...materials, { materialKey: "", descriptionAr: "", unit: "ton", qty: "", unitRate: "" }])
          }
        >
          {t("certificates.addMaterial")}
        </Button>
      </div>
      <p className="mb-[12px] text-[11.5px] text-ink-muted">{t("certificates.hint.materials")}</p>
      {materials.length === 0 ? (
        <p className="text-[12px] text-ink-faint">{t("certificates.noMaterials")}</p>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {materials.map((material, index) => (
            <div key={index} className="grid gap-[10px] sm:grid-cols-2 lg:grid-cols-6">
              <TextField
                label={t("certificates.field.materialKey")}
                value={material.materialKey}
                onChange={(v) => onChange(materials.map((m, i) => (i === index ? { ...m, materialKey: v } : m)))}
              />
              <TextField
                label={t("certificates.field.materialDescription")}
                value={material.descriptionAr}
                onChange={(v) => onChange(materials.map((m, i) => (i === index ? { ...m, descriptionAr: v } : m)))}
              />
              <SelectField
                label={t("certificates.col.unit")}
                value={material.unit}
                options={unitOptions}
                onChange={(v) => onChange(materials.map((m, i) => (i === index ? { ...m, unit: v } : m)))}
              />
              <TextField
                label={t("certificates.field.materialQty")}
                value={material.qty}
                onChange={(v) => onChange(materials.map((m, i) => (i === index ? { ...m, qty: v } : m)))}
                hint={t("certificates.hint.negativeQty")}
              />
              <TextField
                label={t("certificates.col.unitRate")}
                value={material.unitRate}
                onChange={(v) => onChange(materials.map((m, i) => (i === index ? { ...m, unitRate: v } : m)))}
              />
              <div className="flex items-end">
                <Button onClick={() => onChange(materials.filter((_, i) => i !== index))}>{t("common.delete")}</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* كتلة الخصومات                                                        */
/* ------------------------------------------------------------------ */

export function DeductionsBlock({ computed }: { computed: CertificateComputationDTO }) {
  const { t } = useAppTranslation();
  const row = (label: string, value: string, strong = false, negative = false) => (
    <div key={label} className="flex items-baseline justify-between gap-[10px] border-b border-border py-[6px] last:border-b-0">
      <span className={strong ? "text-[12.5px] font-bold text-ink" : "text-[12px] text-ink-muted"}>{label}</span>
      <span className={`mz-num text-[12.5px] ${strong ? "font-bold text-ink" : "font-semibold text-ink"}`}>
        <MoneyValue value={negative ? -majorOf(value) : majorOf(value)} showUnit={false} />
      </span>
    </div>
  );

  return (
    <Card className="mb-[16px] p-[16px_18px]">
      <h2 className="mb-[10px] text-[13px] font-bold text-ink">{t("certificates.section.block")}</h2>
      <div className="grid gap-[18px] lg:grid-cols-2">
        <div>
          {row(t("certificates.block.grossWorks"), computed.grossWorks)}
          {row(t("certificates.block.materialsOnSite"), computed.materialsOnSite)}
          {row(t("certificates.block.certificateTotal"), computed.certificateTotal, true)}
          {row(
            t("certificates.block.tenderDiscount", { percent: formatPercent(computed.tenderDiscountPercent) }),
            computed.tenderDiscount,
            false,
            true,
          )}
          {row(t("certificates.block.netCertified"), computed.netCertified, true)}
          {row(t("certificates.block.previousNetCertified"), computed.previousNetCertified)}
          {row(t("certificates.block.thisNetCertified"), computed.thisCertificateNetCertified, true)}
        </div>
        <div>
          {computed.deductions.map((deduction) =>
            row(
              `${deduction.labelAr}${deduction.percent ? ` — ${formatPercent(deduction.percent)}%` : ""}${deduction.capped ? ` (${t("certificates.capped")})` : ""}${deduction.noteAr ? ` — ${deduction.noteAr}` : ""}`,
              deduction.thisCertificate,
              false,
              true,
            ),
          )}
          {row(
            t("certificates.block.vat", { percent: formatPercent(computed.vatEffectiveRatePercent) }),
            computed.vat,
          )}
          {row(t("certificates.block.previousPayments"), computed.previousPayments)}
          {row(t("certificates.block.netPayable"), computed.netPayableThisCertificate, true)}
        </div>
      </div>
      <p className="mt-[10px] text-[11.5px] text-ink-muted">
        {computed.vatBasis === "transitional" ? t("certificates.vatTransitionalNote") : t("certificates.vatStandardNote")}
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* تفاصيل المستخلص                                                      */
/* ------------------------------------------------------------------ */

function CertificateDetailPage({
  certificateId,
  onBack,
  onPrint,
}: {
  certificateId: string;
  onBack: () => void;
  onPrint: () => void;
}) {
  const { t } = useAppTranslation();
  const query = useProgressCertificate(certificateId);
  const transition = useProgressCertificateTransition();
  const update = useUpdateProgressCertificate();
  const projects = useProjects().data ?? EMPTY;
  const customers = useCustomers().data ?? EMPTY;
  const [actionDate, setActionDate] = useState(todayIso());
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [draftQty, setDraftQty] = useState<Record<string, string> | null>(null);
  const [draftMaterials, setDraftMaterials] = useState<MaterialDraft[] | null>(null);

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
        title={t("certificates.notFound")}
        description={t("certificates.notFoundHint")}
        action={{ label: t("common.back"), onClick: onBack }}
      />
    );
  }

  const mayPrepare = can(authContext, "contracting.certificate.prepare");
  const mayCertify = can(authContext, "contracting.certificate.certify");
  const mayApprove = can(authContext, "contracting.certificate.approve");
  const editable = mayPrepare && (certificate.status === "draft" || certificate.status === "measured") && !certificate.hasLaterCertificate;
  // The transition signs the STORED lines; an unsaved quantity would be
  // silently dropped and the measurement approved at the old figure.
  const unsaved = editable && (draftQty !== null || draftMaterials !== null);

  async function move(action: "measure" | "certify" | "approve" | "cancel" | "void") {
    setError(null);
    if (unsaved && (action === "measure" || action === "certify")) {
      setError(t("certificates.saveBeforeTransition"));
      return;
    }
    if ((action === "cancel" || action === "void") && reason.trim() === "") {
      setError(t("certificates.reasonRequired"));
      return;
    }
    const body =
      action === "approve"
        ? { approvedAt: actionDate }
        : action === "measure"
          ? { measuredAt: actionDate }
          : action === "certify"
            ? { certifiedAt: actionDate }
            : action === "cancel"
              ? { reasonAr: reason.trim() }
              : { date: actionDate, reasonAr: reason.trim() };
    try {
      await transition.mutateAsync({ id: certificate!.id, action, body });
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("certificates.transitionFailed"));
    }
  }

  async function saveLines() {
    setError(null);
    if (!draftQty && !draftMaterials) return;
    const materialRows = draftMaterials ?? materialDraftsOf(certificate!);
    try {
      await update.mutateAsync({
        id: certificate!.id,
        patch: {
          workLines: certificate!.workLines.map((l) => ({
            boqLineId: l.boqLineId,
            thisPeriodQty: draftQty?.[l.boqLineId] ?? trimScale(l.thisPeriodQty) ?? "0",
          })),
          // التشوينات travels with the quantities: patching only the work lines
          // dropped every material the certificate carried, because a PATCH
          // that omits materialLines re-derives them from the previous
          // certificate alone.
          materialLines: materialRows
            .filter((m) => m.materialKey.trim() !== "")
            .map(
              (m): CertificateMaterialLineInputDTO => ({
                materialKey: m.materialKey.trim(),
                descriptionAr: m.descriptionAr.trim() || m.materialKey.trim(),
                unit: m.unit as CertificateMaterialLineInputDTO["unit"],
                qty: m.qty.trim() || "0",
                unitRate: m.unitRate.trim() || "0",
              }),
            ),
        },
      });
      setDraftQty(null);
      setDraftMaterials(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("certificates.saveFailed"));
    }
  }

  const projectName = projects.find((p) => p.id === certificate.projectId)?.nameAr ?? certificate.projectId;
  const customerName = customers.find((c) => c.id === certificate.customerId)?.nameAr ?? certificate.customerId;
  const computed = certificate.computed;

  return (
    <DocumentDetail
      title={`${certificate.docNo} — ${t(certificate.isFinal ? "certificates.finalSerial" : "certificates.interimSerial", { serial: String(certificate.serial) })}`}
      statusLabel={t(CERTIFICATE_STATUS_KEY[certificate.derivedStatus])}
      statusTone={CERTIFICATE_STATUS_TONE[certificate.derivedStatus]}
      subtitle={`${certificate.contractDocNo} · ${projectName} · ${customerName}`}
      actions={
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={onBack}>{t("common.back")}</Button>
          <Button onClick={onPrint}>{t("certificates.print")}</Button>
          {/* A later certificate freezes the FIGURES, never the signatures:
              measuring, certifying and clearing this one change nothing a
              successor read off it. Editing and cancelling do, and stay shut. */}
          {certificate.hasLaterCertificate ? (
            <span className="text-[12px] font-semibold text-warning-ink">{t("certificates.lockedByLater")}</span>
          ) : null}
          {unsaved && (certificate.status === "draft" || certificate.status === "measured") ? (
            <span role="status" className="text-[12px] font-semibold text-warning-ink">
              {t("certificates.saveBeforeTransition")}
            </span>
          ) : null}
          {mayPrepare && certificate.status === "draft" ? (
            <>
              <TextInput
                type="date"
                value={actionDate}
                onChange={(e) => setActionDate(e.target.value)}
                aria-label={t("certificates.field.measuredAt")}
              />
              <Button variant="primary" onClick={() => void move("measure")} disabled={transition.isPending || unsaved}>
                {t("certificates.action.measure")}
              </Button>
            </>
          ) : null}
          {mayCertify && certificate.status === "measured" ? (
            <>
              <TextInput
                type="date"
                value={actionDate}
                onChange={(e) => setActionDate(e.target.value)}
                aria-label={t("certificates.field.certifiedAt")}
              />
              <Button variant="primary" onClick={() => void move("certify")} disabled={transition.isPending || unsaved}>
                {t("certificates.action.certify")}
              </Button>
            </>
          ) : null}
          {mayApprove && certificate.status === "certified" ? (
            <>
              <TextInput
                type="date"
                value={actionDate}
                onChange={(e) => setActionDate(e.target.value)}
                aria-label={t("certificates.field.approvedAt")}
              />
              <Button variant="primary" onClick={() => void move("approve")} disabled={transition.isPending}>
                {t("certificates.action.approve")}
              </Button>
            </>
          ) : null}
          {mayPrepare &&
          !certificate.hasLaterCertificate &&
          (certificate.status === "draft" || certificate.status === "measured") ? (
            <>
              <TextInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={t("certificates.field.cancelReason")}
                placeholder={t("certificates.field.cancelReason")}
              />
              <Button onClick={() => void move("cancel")} disabled={transition.isPending}>
                {t("certificates.action.cancel")}
              </Button>
            </>
          ) : null}
          {mayApprove &&
          !certificate.hasLaterCertificate &&
          (certificate.status === "invoiced" || certificate.status === "approved_for_payment") ? (
            <>
              <TextInput
                type="date"
                value={actionDate}
                onChange={(e) => setActionDate(e.target.value)}
                aria-label={t("certificates.field.voidDate")}
              />
              <TextInput
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label={t("certificates.field.voidReason")}
                placeholder={t("certificates.field.voidReason")}
              />
              <Button onClick={() => void move("void")} disabled={transition.isPending}>
                {t("certificates.action.void")}
              </Button>
            </>
          ) : null}
        </div>
      }
      summary={[
        {
          label: t("certificates.kpi.contractValue"),
          value: <MoneyValue value={majorOf(computed.contractValueAfterVariations)} showUnit={false} />,
        },
        {
          label: t("certificates.kpi.cumulativeExecuted"),
          value: <MoneyValue value={majorOf(computed.grossWorks)} showUnit={false} />,
        },
        { label: t("certificates.kpi.completion"), value: <span className="mz-num">{formatPercent(computed.completionPercent)}%</span> },
        {
          label: t("certificates.kpi.retentionHeld"),
          value: <MoneyValue value={majorOf(computed.retentionHeldCumulative)} showUnit={false} />,
        },
        {
          label: t("certificates.kpi.advanceOutstanding"),
          value: <MoneyValue value={majorOf(computed.advanceOutstanding)} showUnit={false} />,
        },
        {
          label: t("certificates.kpi.netPayable"),
          value: <MoneyValue value={majorOf(computed.netPayableThisCertificate)} showUnit={false} />,
        },
      ]}
      tabs={[
        {
          key: "lines",
          label: t("certificates.tab.lines"),
          content: (
            <div className="flex flex-col gap-[16px]">
              {error ? <p className="text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
              <Card className="p-[14px_16px]">
                <DocumentStatusStepper
                  steps={CERTIFICATE_STEPS.map((key) => ({ key, label: t(CERTIFICATE_STATUS_KEY[key]) }))}
                  currentKey={certificate.derivedStatus}
                  tone={certificate.status === "cancelled" ? "danger" : "brand"}
                />
              </Card>
              <Card className="p-[14px_16px]">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-border text-ink-muted">
                        <th className="p-[7px_8px] text-start">{t("certificates.col.item")}</th>
                        <th className="p-[7px_8px] text-start">{t("certificates.col.unit")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.contractedQty")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.unitRate")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.previous")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.thisPeriod")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.cumulative")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.completion")}</th>
                        <th className="p-[7px_8px] text-end">{t("certificates.col.value")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {certificate.workLines.map((row) => (
                        <tr key={row.id} className="border-b border-border">
                          <td className="p-[7px_8px]">
                            <span className="mz-num text-ink-muted">{row.code}</span> {row.descriptionAr}
                          </td>
                          <td className="p-[7px_8px]">{unitLabel(row.unit, t)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row.contractedQty)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row.unitRate)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{trimScale(row.previousCumulativeQty)}</td>
                          <td className="p-[7px_8px] text-end">
                            {editable ? (
                              <TextInput
                                value={draftQty?.[row.boqLineId] ?? trimScale(row.thisPeriodQty)}
                                onChange={(e) =>
                                  setDraftQty((prev) => ({ ...(prev ?? {}), [row.boqLineId]: e.target.value }))
                                }
                                aria-label={t("certificates.col.thisPeriod")}
                                className="w-[96px] text-end"
                              />
                            ) : (
                              <span className="mz-num">{trimScale(row.thisPeriodQty)}</span>
                            )}
                          </td>
                          <td className="mz-num p-[7px_8px] text-end font-semibold">{trimScale(row.cumulativeQty)}</td>
                          <td className="mz-num p-[7px_8px] text-end">{formatPercent(row.completionPercent)}%</td>
                          <td className="mz-num p-[7px_8px] text-end">
                            <MoneyValue value={majorOf(row.cumulativeValue)} showUnit={false} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {editable && (draftQty || draftMaterials) ? (
                  <div className="mt-[12px] flex justify-end gap-[9px]">
                    <Button
                      onClick={() => {
                        setDraftQty(null);
                        setDraftMaterials(null);
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button variant="primary" onClick={() => void saveLines()} disabled={update.isPending}>
                      {t("common.save")}
                    </Button>
                  </div>
                ) : null}
              </Card>

              {editable ? (
                <MaterialsCard
                  materials={draftMaterials ?? materialDraftsOf(certificate)}
                  onChange={setDraftMaterials}
                />
              ) : certificate.materialLines.length > 0 ? (
                <Card className="p-[14px_16px]">
                  <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("certificates.section.materials")}</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[12px]">
                      <thead>
                        <tr className="border-b border-border text-ink-muted">
                          <th className="p-[7px_8px] text-start">{t("certificates.col.item")}</th>
                          <th className="p-[7px_8px] text-start">{t("certificates.col.unit")}</th>
                          <th className="p-[7px_8px] text-end">{t("certificates.col.thisPeriod")}</th>
                          <th className="p-[7px_8px] text-end">{t("certificates.col.cumulative")}</th>
                          <th className="p-[7px_8px] text-end">{t("certificates.col.unitRate")}</th>
                          <th className="p-[7px_8px] text-end">{t("certificates.col.value")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {certificate.materialLines.map((row) => (
                          <tr key={row.id} className="border-b border-border">
                            <td className="p-[7px_8px]">{row.descriptionAr}</td>
                            <td className="p-[7px_8px]">{unitLabel(row.unit, t)}</td>
                            <td className="mz-num p-[7px_8px] text-end">{trimScale(row.qty)}</td>
                            <td className="mz-num p-[7px_8px] text-end">{trimScale(row.cumulativeQty)}</td>
                            <td className="mz-num p-[7px_8px] text-end">{trimScale(row.unitRate)}</td>
                            <td className="mz-num p-[7px_8px] text-end">
                              <MoneyValue value={majorOf(row.value)} showUnit={false} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}

              <DeductionsBlock computed={computed} />
            </div>
          ),
        },
        {
          key: "collection",
          label: t("certificates.tab.collection"),
          content: <CollectionPanel certificate={certificate} />,
        },
      ]}
    />
  );
}

function CollectionPanel({ certificate }: { certificate: ProgressCertificateDTO }) {
  const { t } = useAppTranslation();
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-[10px] border-b border-border py-[7px] last:border-b-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="text-[12.5px] font-semibold text-ink">{value}</span>
    </div>
  );

  if (!certificate.invoice) {
    return (
      <EmptyState title={t("certificates.noInvoice")} description={t("certificates.noInvoiceHint")} />
    );
  }

  return (
    <Card className="p-[14px_16px]">
      <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("certificates.section.collection")}</h3>
      {row(t("certificates.field.invoice"), <span className="mz-num">{certificate.invoiceDocNo}</span>)}
      {row(
        t("certificates.field.invoiceTotal"),
        <MoneyValue value={majorOf(certificate.invoice.total)} showUnit={false} />,
      )}
      {row(
        t("certificates.field.amountPaid"),
        <MoneyValue value={majorOf(certificate.invoice.amountPaid)} showUnit={false} />,
      )}
      {row(
        t("certificates.field.remainingBalance"),
        <MoneyValue value={majorOf(certificate.invoice.remainingBalance)} showUnit={false} />,
      )}
      {row(t("certificates.field.dueDate"), <span className="mz-num">{certificate.dueDate ?? "—"}</span>)}
      {row(t("certificates.field.daysOverdue"), <span className="mz-num">{certificate.daysOverdue}</span>)}
      {row(
        t("certificates.field.lateCompensation"),
        certificate.cbeCreditDiscountRatePercent === null ? (
          <span className="text-ink-faint">{t("certificates.cbeRateUnset")}</span>
        ) : (
          <MoneyValue value={majorOf(certificate.latePaymentCompensation)} showUnit={false} />
        ),
      )}
      <p className="mt-[10px] text-[11.5px] text-ink-muted">{t("certificates.lateCompensationHint")}</p>
    </Card>
  );
}

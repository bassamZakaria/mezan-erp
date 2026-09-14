import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Checkbox,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  Qty as QtyValue,
  StatusPill,
  TextInput,
  type DocumentListColumn,
  type EntityPickerOption,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type {
  BoqLineDTO,
  CreateSubcontractDTO,
  SubcontractDTO,
  SubcontractKindDTO,
  SubcontractRetentionReleaseKindDTO,
  SubcontractLineDTO,
  SubcontractLineInputDTO,
  SubcontractStatusDTO,
  VatBasisDTO,
} from "@mezan/contracts";
import { SelectField, TextAreaField, TextField } from "../../../settings/form-controls";
import { useSubPage, useNavigation } from "../../../navigation";
import { useApi } from "../../../data/ApiContext";
import { useProjects, useSuppliers, useVouchers } from "../../../data/hooks";
import { useContractBoq, useWorksContracts } from "../../../data/contracting-contracts-hooks";
import {
  useCreateSubcontract,
  useLinkSubcontractAdvance,
  usePutSubcontractLines,
  useReleaseSubcontractRetention,
  useSubcontract,
  useSubcontractTransition,
  useSubcontracts,
  useSubCertificates,
} from "../../../data/contracting-subcontracts-hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { majorOf, sumMajor } from "../../../lib/money";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { SUBCONTRACT_STATUS_KEY, SUBCONTRACT_STATUS_TONE, SUB_CERTIFICATE_STATUS_KEY, SUB_CERTIFICATE_STATUS_TONE, trimScale } from "./subcontract-common";

/**
 * عقود الباطن — the back-to-back subcontract (design §03 "THE MIRROR", D-04, D-05).
 *
 * Every value/clientValue/margin figure and every retention/advance figure on
 * this screen is the server's — nothing here recomputes money from the lines
 * on display.
 */

/** D-07 — the basis a subcontract signed on this date defaults to; the server decides, this only previews it. */
function defaultVatBasis(signedDate: string): VatBasisDTO {
  return signedDate < "2025-07-18" ? "transitional" : "standard";
}

interface DraftSubLine {
  id?: string;
  clientBoqLineId: string;
  code: string;
  descriptionAr: string;
  unit: string;
  clientUnitRate: string;
  marginVsClient: string | null;
  qty: string;
  unitRate: string;
  estimatedUnitCost: string;
}

function emptyDraftLine(): DraftSubLine {
  return { clientBoqLineId: "", code: "", descriptionAr: "", unit: "", clientUnitRate: "", marginVsClient: null, qty: "", unitRate: "", estimatedUnitCost: "" };
}

function fromLineDto(line: SubcontractLineDTO): DraftSubLine {
  return {
    id: line.id,
    clientBoqLineId: line.clientBoqLineId,
    code: line.code,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    clientUnitRate: trimScale(line.clientUnitRate),
    marginVsClient: trimScale(line.marginVsClient),
    qty: trimScale(line.qty),
    unitRate: trimScale(line.unitRate),
    estimatedUnitCost: trimScale(line.estimatedUnitCost),
  };
}

function toLineInput(line: DraftSubLine): SubcontractLineInputDTO {
  return {
    ...(line.id ? { id: line.id } : {}),
    clientBoqLineId: line.clientBoqLineId,
    qty: line.qty.trim() === "" ? "0" : line.qty.trim(),
    unitRate: line.unitRate.trim() === "" ? "0" : line.unitRate.trim(),
    estimatedUnitCost: line.estimatedUnitCost.trim() === "" ? null : line.estimatedUnitCost.trim(),
  };
}

export function SubcontractsScreen() {
  const { t } = useAppTranslation();
  const subPage = useSubPage();
  const [firstSegment, secondSegment] = subPage.segments;

  const subcontractsQuery = useSubcontracts();
  const subcontracts = subcontractsQuery.data ?? EMPTY;
  const projects = useProjects().data ?? EMPTY;

  const { session } = useApi();
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayManage = can(authContext, "contracting.boq.manage");

  const [statusFilter, setStatusFilter] = useState<SubcontractStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const projectName = (id: string) => projects.find((p) => p.id === id)?.nameAr ?? id;

  const filtered = useMemo(() => {
    const needle = search.trim();
    return subcontracts.filter(
      (s) =>
        (statusFilter === "all" || s.status === statusFilter) &&
        (needle === "" ||
          s.docNo.includes(needle) ||
          s.titleAr.includes(needle) ||
          s.supplierNameAr.includes(needle) ||
          s.contractDocNo.includes(needle)),
    );
  }, [subcontracts, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selected = firstSegment ? (subcontracts.find((s) => s.docNo === firstSegment || s.id === firstSegment) ?? null) : null;

  if (firstSegment === "new") {
    return <NewSubcontractPage onDone={(docNo) => subPage.open(docNo)} onCancel={() => subPage.close()} />;
  }

  if (firstSegment && selected) {
    return (
      <SubcontractDetailPage
        subcontract={selected}
        mayManage={mayManage}
        onBack={() => subPage.close()}
        initialTab={secondSegment}
      />
    );
  }

  if (firstSegment && !subcontractsQuery.isLoading && !selected) {
    return (
      <EmptyState
        title={t("subcontracts.notFound")}
        description={t("subcontracts.notFoundHint")}
        action={{ label: t("common.back"), onClick: () => subPage.close() }}
      />
    );
  }

  const columns: DocumentListColumn<SubcontractDTO>[] = [
    { key: "docNo", header: t("subcontracts.column.docNo"), render: (s) => <span className="mz-num font-semibold">{s.docNo}</span> },
    { key: "contract", header: t("subcontracts.column.contract"), render: (s) => s.contractDocNo },
    { key: "project", header: t("subcontracts.column.project"), render: (s) => projectName(s.projectId) },
    { key: "supplier", header: t("subcontracts.column.supplier"), render: (s) => s.supplierNameAr },
    {
      key: "kind",
      header: t("subcontracts.column.kind"),
      render: (s) => t(s.kind === "labour_only" ? "subcontracts.kind.labourOnly" : "subcontracts.kind.works"),
    },
    {
      key: "value",
      header: t("subcontracts.column.value"),
      align: "end",
      render: (s) => <MoneyValue value={majorOf(s.value)} showUnit={false} />,
      total: (rows) => <MoneyValue value={sumMajor(rows.map((r) => r.value))} showUnit={false} />,
    },
    {
      key: "margin",
      header: t("subcontracts.column.margin"),
      align: "end",
      render: (s) => <MoneyValue value={majorOf(s.margin)} showUnit={false} />,
      total: (rows) => <MoneyValue value={sumMajor(rows.map((r) => r.margin))} showUnit={false} />,
    },
    {
      key: "status",
      header: t("subcontracts.column.status"),
      render: (s) => <StatusPill label={t(SUBCONTRACT_STATUS_KEY[s.status])} tone={SUBCONTRACT_STATUS_TONE[s.status]} />,
    },
  ];

  return (
    <DocumentList<SubcontractDTO>
      title={t("subcontracts.title")}
      description={t("subcontracts.description")}
      actions={
        mayManage ? (
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("subcontracts.new")}
          </Button>
        ) : null
      }
      stats={[
        { label: t("subcontracts.stat.active"), value: <span className="mz-num">{subcontracts.filter((s) => s.status === "active").length}</span> },
        { label: t("subcontracts.stat.value"), value: <MoneyValue value={sumMajor(subcontracts.map((s) => s.value))} showUnit={false} /> },
        { label: t("subcontracts.stat.margin"), value: <MoneyValue value={sumMajor(subcontracts.map((s) => s.margin))} showUnit={false} /> },
      ]}
      statusChips={[
        { key: "all", label: t("common.all"), count: subcontracts.length },
        { key: "draft", label: t("subcontracts.status.draft"), count: subcontracts.filter((s) => s.status === "draft").length },
        { key: "active", label: t("subcontracts.status.active"), count: subcontracts.filter((s) => s.status === "active").length },
        { key: "completed", label: t("subcontracts.status.completed"), count: subcontracts.filter((s) => s.status === "completed").length },
        { key: "terminated", label: t("subcontracts.status.terminated"), count: subcontracts.filter((s) => s.status === "terminated").length },
      ]}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as SubcontractStatusDTO | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("subcontracts.searchPlaceholder")}
      columns={columns}
      rows={pageRows}
      rowKey={(s) => s.id}
      loading={subcontractsQuery.isLoading}
      loadFailed={subcontractsQuery.isError}
      onRowClick={(s) => subPage.open(s.docNo)}
      page={currentPage}
      pageCount={pageCount}
      onPageChange={setPage}
      emptyState={
        <EmptyState
          title={t("subcontracts.empty")}
          description={t("subcontracts.emptyHint")}
          {...(mayManage ? { action: { label: t("subcontracts.new"), onClick: () => subPage.open("new") } } : {})}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* عقد باطن جديد                                                        */
/* ------------------------------------------------------------------ */

function NewSubcontractPage({ onDone, onCancel }: { onDone: (docNo: string) => void; onCancel: () => void }) {
  const { t } = useAppTranslation();
  const contracts = useWorksContracts({ status: "active" }).data ?? EMPTY;
  const suppliers = useSuppliers().data ?? EMPTY;
  const create = useCreateSubcontract();

  const [contract, setContract] = useState<EntityPickerOption | null>(null);
  const [supplier, setSupplier] = useState<EntityPickerOption | null>(null);
  const [titleAr, setTitleAr] = useState("");
  const [kind, setKind] = useState<SubcontractKindDTO>("works");
  const [disguisedEmploymentReviewed, setDisguisedEmploymentReviewed] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [signedDate, setSignedDate] = useState(todayIso());
  const [startDate, setStartDate] = useState(todayIso());
  const [plannedEndDate, setPlannedEndDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<DraftSubLine[]>([]);

  const [retentionPercent, setRetentionPercent] = useState("5");
  const [retentionCapPercent, setRetentionCapPercent] = useState("");
  const [advancePercent, setAdvancePercent] = useState("10");
  const [advanceRecoveryPercent, setAdvanceRecoveryPercent] = useState("10");
  const [withholdingTaxPercent, setWithholdingTaxPercent] = useState("1");
  const [deemedWagePercent, setDeemedWagePercent] = useState("20");
  const [socialInsuranceRatePercent, setSocialInsuranceRatePercent] = useState("18.75");
  const [withholdSocialInsurance, setWithholdSocialInsurance] = useState(false);
  const [socialInsuranceNote, setSocialInsuranceNote] = useState("");
  const [penaltyCapPercent, setPenaltyCapPercent] = useState("10");
  const [paymentTermDays, setPaymentTermDays] = useState("30");
  const [defectsLiabilityMonths, setDefectsLiabilityMonths] = useState("12");
  const [vatBasis, setVatBasis] = useState<VatBasisDTO>(defaultVatBasis(todayIso()));

  const boq = useContractBoq(contract?.id ?? null).data?.lines ?? EMPTY;

  function chooseSignedDate(next: string) {
    setSignedDate(next);
    setVatBasis(defaultVatBasis(next));
  }

  async function save() {
    setError(null);
    if (!contract || !supplier || titleAr.trim() === "") {
      setError(t("subcontracts.missingRequired"));
      return;
    }
    try {
      const body: CreateSubcontractDTO = {
        id: `SUB-${Date.now()}`,
        contractId: contract.id,
        supplierId: supplier.id,
        titleAr: titleAr.trim(),
        kind,
        disguisedEmploymentReviewed: kind === "labour_only" ? disguisedEmploymentReviewed : undefined,
        reviewNote: reviewNote.trim() === "" ? null : reviewNote.trim(),
        signedDate,
        startDate,
        plannedEndDate,
        notes: notes.trim() === "" ? null : notes.trim(),
        lines: lines.filter((l) => l.clientBoqLineId !== "").map(toLineInput),
        retentionPercent,
        retentionCapPercent: retentionCapPercent.trim() === "" ? null : retentionCapPercent.trim(),
        advancePercent,
        advanceRecoveryPercent,
        withholdingTaxPercent,
        deemedWagePercent,
        socialInsuranceRatePercent,
        withholdSocialInsurance,
        socialInsuranceNote: socialInsuranceNote.trim() === "" ? null : socialInsuranceNote.trim(),
        penaltyCapPercent,
        paymentTermDays: Number(paymentTermDays),
        defectsLiabilityMonths: Number(defectsLiabilityMonths),
        vatBasis,
      };
      const created = await create.mutateAsync(body);
      onDone(created.docNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subcontracts.saveFailed"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[14px] flex items-center justify-between gap-[12px]">
        <h1 className="font-display text-xl font-bold text-ink">{t("subcontracts.new")}</h1>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>

      {error ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}

      <Card className="mb-[16px] p-[16px_18px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("subcontracts.section.header")}</h2>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
          <EntityPicker
            label={t("subcontracts.field.contract")}
            value={contract}
            onChange={(next) => {
              setContract(next);
              setLines([]);
            }}
            options={contracts.map((c) => ({ id: c.id, label: c.titleAr, sublabel: c.docNo }))}
            placeholder={t("subcontracts.pickContract")}
            emptyMessage={t("subcontracts.noActiveContracts")}
          />
          <EntityPicker
            label={t("subcontracts.field.supplier")}
            value={supplier}
            onChange={setSupplier}
            options={suppliers.map((s) => ({ id: s.id, label: s.nameAr, sublabel: s.code }))}
            placeholder={t("subcontracts.pickSupplier")}
            emptyMessage={t("subcontracts.noSuppliers")}
          />
          <SelectField
            label={t("subcontracts.field.kind")}
            value={kind}
            onChange={(v) => setKind(v as SubcontractKindDTO)}
            options={[
              { value: "works", label: t("subcontracts.kind.works") },
              { value: "labour_only", label: t("subcontracts.kind.labourOnly") },
            ]}
          />
          <TextField label={t("subcontracts.field.titleAr")} value={titleAr} onChange={setTitleAr} />
          <TextField label={t("subcontracts.field.signedDate")} value={signedDate} onChange={chooseSignedDate} type="date" />
          <TextField label={t("subcontracts.field.startDate")} value={startDate} onChange={setStartDate} type="date" />
          <TextField label={t("subcontracts.field.plannedEndDate")} value={plannedEndDate} onChange={setPlannedEndDate} type="date" />
        </div>
        {kind === "labour_only" ? (
          <div className="mt-[14px] rounded-md border border-warning bg-warning-soft p-[12px_14px]">
            <Checkbox
              label={t("subcontracts.field.disguisedEmploymentReviewed")}
              hint={t("subcontracts.hint.disguisedEmploymentReviewed")}
              checked={disguisedEmploymentReviewed}
              onChange={(e) => setDisguisedEmploymentReviewed(e.target.checked)}
            />
            <div className="mt-[10px]">
              <TextField label={t("subcontracts.field.reviewNote")} value={reviewNote} onChange={setReviewNote} />
            </div>
          </div>
        ) : null}
        <div className="mt-[12px]">
          <TextAreaField label={t("common.notes")} value={notes} onChange={setNotes} rows={2} />
        </div>
      </Card>

      <Card className="mb-[16px] p-[16px_18px]">
        <h2 className="mb-[4px] text-[13px] font-bold text-ink">{t("subcontracts.section.terms")}</h2>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <TextField label={t("subcontracts.field.retentionPercent")} value={retentionPercent} onChange={setRetentionPercent} />
          <TextField label={t("subcontracts.field.retentionCapPercent")} value={retentionCapPercent} onChange={setRetentionCapPercent} hint={t("subcontracts.hint.retentionCap")} />
          <TextField label={t("subcontracts.field.advancePercent")} value={advancePercent} onChange={setAdvancePercent} />
          <TextField label={t("subcontracts.field.advanceRecoveryPercent")} value={advanceRecoveryPercent} onChange={setAdvanceRecoveryPercent} />
          <TextField label={t("subcontracts.field.withholdingTaxPercent")} value={withholdingTaxPercent} onChange={setWithholdingTaxPercent} />
          <TextField label={t("subcontracts.field.deemedWagePercent")} value={deemedWagePercent} onChange={setDeemedWagePercent} />
          <TextField label={t("subcontracts.field.socialInsuranceRatePercent")} value={socialInsuranceRatePercent} onChange={setSocialInsuranceRatePercent} />
          <TextField label={t("subcontracts.field.penaltyCapPercent")} value={penaltyCapPercent} onChange={setPenaltyCapPercent} />
          <TextField label={t("subcontracts.field.paymentTermDays")} value={paymentTermDays} onChange={setPaymentTermDays} />
          <TextField label={t("subcontracts.field.defectsLiabilityMonths")} value={defectsLiabilityMonths} onChange={setDefectsLiabilityMonths} />
          <SelectField
            label={t("subcontracts.field.vatBasis")}
            value={vatBasis}
            onChange={(v) => setVatBasis(v as VatBasisDTO)}
            options={[
              { value: "standard", label: t("subcontracts.vat.standard") },
              { value: "transitional", label: t("subcontracts.vat.transitional") },
            ]}
          />
        </div>
        <div className="mt-[12px] flex flex-wrap items-center gap-[14px]">
          <Checkbox
            label={t("subcontracts.field.withholdSocialInsurance")}
            checked={withholdSocialInsurance}
            onChange={(e) => setWithholdSocialInsurance(e.target.checked)}
          />
        </div>
        <div className="mt-[12px]">
          <TextField label={t("subcontracts.field.socialInsuranceNote")} value={socialInsuranceNote} onChange={setSocialInsuranceNote} />
        </div>
      </Card>

      {contract ? (
        <Card className="mb-[16px] p-[16px_18px]">
          <h2 className="mb-[4px] text-[13px] font-bold text-ink">{t("subcontracts.section.lines")}</h2>
          <p className="mb-[12px] text-[11.5px] text-ink-muted">{t("subcontracts.hint.lines")}</p>
          <SubcontractLinesEditor lines={lines} onChange={setLines} boq={boq} editable />
        </Card>
      ) : null}

      <div className="flex justify-end gap-[9px]">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={create.isPending || !contract || !supplier}>
          {t("subcontracts.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* شبكة بنود عقد الباطن (back-to-back)                                   */
/* ------------------------------------------------------------------ */

function SubcontractLinesEditor({
  lines,
  onChange,
  boq,
  editable,
}: {
  lines: DraftSubLine[];
  onChange: (next: DraftSubLine[]) => void;
  boq: readonly BoqLineDTO[];
  editable: boolean;
}) {
  const { t } = useAppTranslation();

  function pickBoqLine(index: number, option: EntityPickerOption | null) {
    const boqLine = boq.find((l) => l.id === option?.id);
    onChange(
      lines.map((line, i) =>
        i === index
          ? {
              ...line,
              clientBoqLineId: option?.id ?? "",
              code: boqLine?.code ?? "",
              descriptionAr: boqLine?.descriptionAr ?? "",
              unit: boqLine?.unit ?? "",
              clientUnitRate: boqLine ? trimScale(boqLine.unitRate) : "",
            }
          : line,
      ),
    );
  }

  function edit(index: number, patch: Partial<DraftSubLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <div className="w-full">
      {editable ? (
        <div className="mb-[10px]">
          <Button onClick={() => onChange([...lines, emptyDraftLine()])}>{t("subcontracts.addLine")}</Button>
        </div>
      ) : null}
      {lines.length === 0 ? (
        <EmptyState title={t("subcontracts.noLines")} description={t("subcontracts.noLinesHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-ink-muted">
                <th className="p-[7px_8px] text-start">{t("subcontracts.col.boqLine")}</th>
                <th className="p-[7px_8px] text-start">{t("subcontracts.col.unit")}</th>
                <th className="p-[7px_8px] text-end">{t("subcontracts.col.qty")}</th>
                <th className="p-[7px_8px] text-end">{t("subcontracts.col.unitRate")}</th>
                <th className="p-[7px_8px] text-end">{t("subcontracts.col.clientUnitRate")}</th>
                <th className="p-[7px_8px] text-end">{t("subcontracts.col.margin")}</th>
                <th className="p-[7px_8px] text-end">{t("subcontracts.col.estimatedUnitCost")}</th>
                {editable ? <th className="p-[7px_8px]" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={line.id ?? `new-${index}`} className="border-b border-border align-top">
                  <td className="p-[5px] min-w-[220px]">
                    {editable ? (
                      <EntityPicker
                        value={line.clientBoqLineId ? { id: line.clientBoqLineId, label: `${line.code} — ${line.descriptionAr}` } : null}
                        onChange={(option) => pickBoqLine(index, option)}
                        options={boq.map((b) => ({ id: b.id, label: `${b.code} — ${b.descriptionAr}`, sublabel: trimScale(b.unitRate) }))}
                        placeholder={t("subcontracts.pickBoqLine")}
                        emptyMessage={t("subcontracts.noBoqLines")}
                      />
                    ) : (
                      <span>
                        <span className="mz-num text-ink-muted">{line.code}</span> {line.descriptionAr}
                      </span>
                    )}
                  </td>
                  <td className="p-[5px]">{line.unit}</td>
                  <td className="p-[5px] text-end">
                    {editable ? (
                      <TextInput numeric value={line.qty} onChange={(e) => edit(index, { qty: e.target.value })} aria-label={t("subcontracts.col.qty")} className="w-[96px] text-end" />
                    ) : (
                      <QtyValue value={line.qty} />
                    )}
                  </td>
                  <td className="p-[5px] text-end">
                    {editable ? (
                      <TextInput numeric value={line.unitRate} onChange={(e) => edit(index, { unitRate: e.target.value })} aria-label={t("subcontracts.col.unitRate")} className="w-[96px] text-end" />
                    ) : (
                      <MoneyValue value={majorOf(line.unitRate)} showUnit={false} />
                    )}
                  </td>
                  <td className="mz-num p-[5px] text-end text-ink-muted">
                    {line.clientUnitRate === "" ? "—" : <MoneyValue value={majorOf(line.clientUnitRate)} showUnit={false} />}
                  </td>
                  <td className="mz-num p-[5px] text-end">
                    {line.marginVsClient === null ? "—" : <MoneyValue value={majorOf(line.marginVsClient)} showUnit={false} />}
                  </td>
                  <td className="p-[5px] text-end">
                    {editable ? (
                      <TextInput
                        numeric
                        value={line.estimatedUnitCost}
                        onChange={(e) => edit(index, { estimatedUnitCost: e.target.value })}
                        aria-label={t("subcontracts.col.estimatedUnitCost")}
                        className="w-[96px] text-end"
                      />
                    ) : line.estimatedUnitCost === "" ? (
                      "—"
                    ) : (
                      <MoneyValue value={majorOf(line.estimatedUnitCost)} showUnit={false} />
                    )}
                  </td>
                  {editable ? (
                    <td className="p-[5px]">
                      <Button size="sm" onClick={() => onChange(lines.filter((_, i) => i !== index))}>
                        {t("common.delete")}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* تفاصيل عقد الباطن                                                     */
/* ------------------------------------------------------------------ */

function SubcontractDetailPage({
  subcontract: initial,
  mayManage,
  onBack,
  initialTab,
}: {
  subcontract: SubcontractDTO;
  mayManage: boolean;
  onBack: () => void;
  initialTab?: string;
}) {
  const { t } = useAppTranslation();
  const { openScreenAt } = useNavigation();
  const query = useSubcontract(initial.id);
  const subcontract = query.data ?? initial;
  const projects = useProjects().data ?? EMPTY;
  const transition = useSubcontractTransition();
  const [actionDate, setActionDate] = useState(todayIso());
  const [terminateReason, setTerminateReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(initialTab && initialTab !== "" ? initialTab : "header");

  const { session } = useApi();
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayReleaseRetention = can(authContext, "contracting.retention.release");

  const projectName = projects.find((p) => p.id === subcontract.projectId)?.nameAr ?? subcontract.projectId;

  async function move(action: "activate" | "complete" | "terminate") {
    setError(null);
    try {
      await transition.mutateAsync({
        id: subcontract.id,
        action,
        body:
          action === "activate"
            ? { activatedAt: actionDate }
            : action === "complete"
              ? { completedAt: actionDate }
              : { terminatedAt: actionDate, reason: terminateReason.trim() === "" ? null : terminateReason.trim() },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subcontracts.transitionFailed"));
    }
  }

  return (
    <DocumentDetail
      title={`${subcontract.docNo} — ${subcontract.titleAr}`}
      statusLabel={t(SUBCONTRACT_STATUS_KEY[subcontract.status])}
      statusTone={SUBCONTRACT_STATUS_TONE[subcontract.status]}
      subtitle={`${subcontract.contractDocNo} · ${projectName} · ${subcontract.supplierNameAr}`}
      actions={
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={onBack}>{t("common.back")}</Button>
          {mayManage && subcontract.status !== "completed" && subcontract.status !== "terminated" ? (
            <>
              <TextInput type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} aria-label={t("subcontracts.actionDate")} />
              {subcontract.status === "draft" ? (
                <Button variant="primary" onClick={() => void move("activate")} disabled={transition.isPending}>
                  {t("subcontracts.action.activate")}
                </Button>
              ) : null}
              {subcontract.status === "active" ? (
                <Button variant="primary" onClick={() => void move("complete")} disabled={transition.isPending}>
                  {t("subcontracts.action.complete")}
                </Button>
              ) : null}
              <Button onClick={() => void move("terminate")} disabled={transition.isPending}>
                {t("subcontracts.action.terminate")}
              </Button>
            </>
          ) : null}
        </div>
      }
      summary={[
        { label: t("subcontracts.column.value"), value: <MoneyValue value={majorOf(subcontract.value)} showUnit={false} /> },
        { label: t("subcontracts.summary.clientValue"), value: <MoneyValue value={majorOf(subcontract.clientValue)} showUnit={false} /> },
        { label: t("subcontracts.column.margin"), value: <MoneyValue value={majorOf(subcontract.margin)} showUnit={false} /> },
        { label: t("subcontracts.summary.advanceOutstanding"), value: <MoneyValue value={majorOf(subcontract.advanceOutstanding)} showUnit={false} /> },
        { label: t("subcontracts.summary.retentionHeld"), value: <MoneyValue value={majorOf(subcontract.retention.held)} showUnit={false} /> },
        { label: t("subcontracts.summary.certifiedToDate"), value: <MoneyValue value={majorOf(subcontract.certifiedToDate)} showUnit={false} /> },
        { label: t("subcontracts.summary.remainingCommitment"), value: <MoneyValue value={majorOf(subcontract.remainingCommitment)} showUnit={false} /> },
        { label: t("subcontracts.summary.certificateCount"), value: <span className="mz-num">{subcontract.certificateCount}</span> },
      ]}
      tabs={[
        {
          key: "header",
          label: t("subcontracts.tab.header"),
          content: (
            <div className="flex flex-col gap-[16px]">
              {error ? <p className="text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
              {subcontract.payabilityRefusals.length > 0 ? (
                <Card className="border-danger p-[14px_16px]">
                  <h3 className="mb-[6px] text-[12.5px] font-bold text-danger-ink">{t("subcontracts.refusalsTitle")}</h3>
                  <ul className="flex flex-col gap-[4px]">
                    {subcontract.payabilityRefusals.map((reason) => (
                      <li key={reason} className="text-[12px] text-danger-ink">
                        {reason}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              {subcontract.status !== "completed" && subcontract.status !== "terminated" && mayManage ? (
                <Card className="p-[14px_16px]">
                  <TextField label={t("subcontracts.field.terminateReason")} value={terminateReason} onChange={setTerminateReason} hint={t("subcontracts.hint.terminateReason")} />
                </Card>
              ) : null}
              <SubcontractHeaderPanel subcontract={subcontract} />
              <AdvancePanel subcontract={subcontract} />
            </div>
          ),
        },
        {
          key: "lines",
          label: t("subcontracts.tab.lines"),
          content: <SubcontractLinesTab subcontract={subcontract} mayManage={mayManage} />,
        },
        {
          key: "certificates",
          label: t("subcontracts.tab.certificates"),
          content: (
            <SubcontractCertificatesTab
              subcontractId={subcontract.id}
              onOpen={(docNo) => openScreenAt("subcontract-certificates", [docNo])}
              onNew={() => openScreenAt("subcontract-certificates", ["new"])}
            />
          ),
        },
        {
          key: "retention",
          label: t("subcontracts.tab.retention"),
          content: <SubcontractRetentionTab subcontract={subcontract} mayRelease={mayReleaseRetention} />,
        },
      ]}
      activeTabKey={activeTab}
      onTabChange={setActiveTab}
    />
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-[10px] border-b border-border py-[7px] last:border-b-0">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="text-[12.5px] font-semibold text-ink">{value}</span>
    </div>
  );
}

function SubcontractHeaderPanel({ subcontract }: { subcontract: SubcontractDTO }) {
  const { t } = useAppTranslation();
  const pct = (v: string | null) => (v === null ? "—" : <span className="mz-num">{v}%</span>);
  return (
    <div className="grid gap-[16px] lg:grid-cols-2">
      <Card className="p-[14px_16px]">
        <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("subcontracts.section.header")}</h3>
        <Row label={t("subcontracts.field.kind")} value={t(subcontract.kind === "labour_only" ? "subcontracts.kind.labourOnly" : "subcontracts.kind.works")} />
        {subcontract.kind === "labour_only" ? (
          <Row
            label={t("subcontracts.field.disguisedEmploymentReviewed")}
            value={subcontract.disguisedEmploymentReviewed ? t("subcontracts.yes") : t("subcontracts.no")}
          />
        ) : null}
        {subcontract.kind === "labour_only" ? <Row label={t("subcontracts.field.reviewNote")} value={subcontract.reviewNote ?? "—"} /> : null}
        <Row label={t("subcontracts.field.signedDate")} value={<span className="mz-num">{subcontract.signedDate}</span>} />
        <Row label={t("subcontracts.field.startDate")} value={<span className="mz-num">{subcontract.startDate}</span>} />
        <Row label={t("subcontracts.field.plannedEndDate")} value={<span className="mz-num">{subcontract.plannedEndDate}</span>} />
        <Row label={t("subcontracts.field.defectsLiabilityMonths")} value={<span className="mz-num">{subcontract.defectsLiabilityMonths}</span>} />
        <Row label={t("common.notes")} value={subcontract.notes ?? "—"} />
      </Card>
      <Card className="p-[14px_16px]">
        <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("subcontracts.section.terms")}</h3>
        <Row label={t("subcontracts.field.retentionPercent")} value={pct(subcontract.retentionPercent)} />
        <Row label={t("subcontracts.field.retentionCapPercent")} value={pct(subcontract.retentionCapPercent)} />
        <Row label={t("subcontracts.field.advancePercent")} value={pct(subcontract.advancePercent)} />
        <Row label={t("subcontracts.field.advanceRecoveryPercent")} value={pct(subcontract.advanceRecoveryPercent)} />
        <Row label={t("subcontracts.field.withholdingTaxPercent")} value={pct(subcontract.withholdingTaxPercent)} />
        <Row label={t("subcontracts.field.deemedWagePercent")} value={pct(subcontract.deemedWagePercent)} />
        <Row label={t("subcontracts.field.socialInsuranceRatePercent")} value={pct(subcontract.socialInsuranceRatePercent)} />
        <Row label={t("subcontracts.field.withholdSocialInsurance")} value={subcontract.withholdSocialInsurance ? t("subcontracts.yes") : t("subcontracts.no")} />
        <Row label={t("subcontracts.field.penaltyCapPercent")} value={pct(subcontract.penaltyCapPercent)} />
        <Row label={t("subcontracts.field.paymentTermDays")} value={<span className="mz-num">{subcontract.paymentTermDays}</span>} />
        <Row label={t("subcontracts.field.vatBasis")} value={t(subcontract.vatBasis === "standard" ? "subcontracts.vat.standard" : "subcontracts.vat.transitional")} />
      </Card>
    </div>
  );
}

function AdvancePanel({ subcontract }: { subcontract: SubcontractDTO }) {
  const { t } = useAppTranslation();
  const vouchers = useVouchers({ status: "confirmed" }).data ?? EMPTY;
  const link = useLinkSubcontractAdvance();
  const [voucher, setVoucher] = useState<EntityPickerOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible = vouchers.filter((v) => v.supplierId === subcontract.supplierId);

  async function submit() {
    setError(null);
    if (!voucher) return;
    try {
      await link.mutateAsync({ id: subcontract.id, body: { voucherId: voucher.id } });
      setVoucher(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subcontracts.advanceLinkFailed"));
    }
  }

  return (
    <Card className="p-[14px_16px]">
      <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("subcontracts.section.advance")}</h3>
      <div className="grid gap-[10px] sm:grid-cols-3">
        <Row label={t("subcontracts.field.advancePaid")} value={<MoneyValue value={majorOf(subcontract.advancePaid)} showUnit={false} />} />
        <Row label={t("subcontracts.field.advanceRecovered")} value={<MoneyValue value={majorOf(subcontract.advanceRecovered)} showUnit={false} />} />
        <Row label={t("subcontracts.field.advanceOutstanding")} value={<MoneyValue value={majorOf(subcontract.advanceOutstanding)} showUnit={false} />} />
      </div>
      {error ? <p className="mt-[8px] text-[12px] font-semibold text-danger-ink">{error}</p> : null}
      <div className="mt-[12px] flex flex-wrap items-end gap-[10px]">
        <div className="min-w-[240px]">
          <EntityPicker
            label={t("subcontracts.field.advanceVoucher")}
            value={voucher}
            onChange={setVoucher}
            options={eligible.map((v) => ({ id: v.id, label: v.docNo ?? v.id, sublabel: `${v.date} · ${v.amount}` }))}
            placeholder={t("subcontracts.pickVoucher")}
            emptyMessage={t("subcontracts.noEligibleVouchers")}
          />
        </div>
        <Button variant="primary" onClick={() => void submit()} disabled={!voucher || link.isPending}>
          {t("subcontracts.action.linkAdvance")}
        </Button>
      </div>
      {subcontract.advances.length > 0 ? (
        <div className="mt-[14px] overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-border text-ink-muted">
                <th className="p-[6px_8px] text-start">{t("subcontracts.col.voucher")}</th>
                <th className="p-[6px_8px] text-start">{t("subcontracts.col.date")}</th>
                <th className="p-[6px_8px] text-end">{t("subcontracts.col.amount")}</th>
              </tr>
            </thead>
            <tbody>
              {subcontract.advances.map((a) => (
                <tr key={a.voucherId} className="border-b border-border">
                  <td className="mz-num p-[6px_8px]">{a.voucherNo ?? a.voucherId}</td>
                  <td className="mz-num p-[6px_8px]">{a.date}</td>
                  <td className="mz-num p-[6px_8px] text-end">
                    <MoneyValue value={majorOf(a.amount)} showUnit={false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

function SubcontractLinesTab({ subcontract, mayManage }: { subcontract: SubcontractDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const boq = useContractBoq(subcontract.contractId).data?.lines ?? EMPTY;
  const put = usePutSubcontractLines();
  const [draft, setDraft] = useState<DraftSubLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editable = mayManage && subcontract.status === "draft";
  const lines = draft ?? subcontract.lines.map(fromLineDto);

  async function save() {
    setError(null);
    try {
      await put.mutateAsync({ id: subcontract.id, body: { lines: lines.map(toLineInput) } });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subcontracts.saveFailed"));
    }
  }

  return (
    <div className="w-full">
      {error ? <p className="mb-[10px] text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
      <Card className="p-[14px_16px]">
        <SubcontractLinesEditor lines={draft ?? subcontract.lines.map(fromLineDto)} onChange={setDraft} boq={boq} editable={editable} />
        {editable && draft !== null ? (
          <div className="mt-[12px] flex justify-end gap-[9px]">
            <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void save()} disabled={put.isPending}>
              {t("common.save")}
            </Button>
          </div>
        ) : null}
        <div className="mt-[14px] grid gap-[10px] border-t border-border pt-[12px] sm:grid-cols-3">
          <Row label={t("subcontracts.column.value")} value={<MoneyValue value={majorOf(subcontract.value)} showUnit={false} />} />
          <Row label={t("subcontracts.summary.clientValue")} value={<MoneyValue value={majorOf(subcontract.clientValue)} showUnit={false} />} />
          <Row label={t("subcontracts.column.margin")} value={<MoneyValue value={majorOf(subcontract.margin)} showUnit={false} />} />
        </div>
      </Card>
    </div>
  );
}

function SubcontractCertificatesTab({
  subcontractId,
  onOpen,
  onNew,
}: {
  subcontractId: string;
  onOpen: (docNo: string) => void;
  onNew: () => void;
}) {
  const { t } = useAppTranslation();
  const certificates = useSubCertificates({ subcontractId }).data ?? EMPTY;

  return (
    <div className="w-full">
      <div className="mb-[12px] flex justify-end">
        <Button variant="primary" onClick={onNew}>
          {t("subCertificates.new")}
        </Button>
      </div>
      {certificates.length === 0 ? (
        <EmptyState title={t("subCertificates.emptyForSubcontract")} description={t("subCertificates.emptyForSubcontractHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-ink-muted">
                <th className="p-[7px] text-start">{t("subCertificates.column.docNo")}</th>
                <th className="p-[7px] text-start">{t("subCertificates.column.period")}</th>
                <th className="p-[7px] text-end">{t("subCertificates.column.netCertified")}</th>
                <th className="p-[7px] text-start">{t("subCertificates.column.status")}</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((c) => (
                <tr key={c.id} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => onOpen(c.docNo)}>
                  <td className="mz-num p-[7px] font-semibold">
                    {c.docNo} · {c.serial}
                  </td>
                  <td className="mz-num p-[7px]" dir="ltr">
                    {c.periodFrom} → {c.periodTo}
                  </td>
                  <td className="p-[7px] text-end">
                    <MoneyValue value={majorOf(c.computed.netCertified)} showUnit={false} />
                  </td>
                  <td className="p-[7px]">
                    <StatusPill label={t(SUB_CERTIFICATE_STATUS_KEY[c.derivedStatus])} tone={SUB_CERTIFICATE_STATUS_TONE[c.derivedStatus]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SubcontractRetentionTab({ subcontract, mayRelease }: { subcontract: SubcontractDTO; mayRelease: boolean }) {
  const { t } = useAppTranslation();
  const release = useReleaseSubcontractRetention();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIso());
  const [kind, setKind] = useState<SubcontractRetentionReleaseKindDTO>("final");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const eventDate =
    kind === "provisional"
      ? subcontract.retention.provisionalReleaseEventDate
      : subcontract.retention.finalReleaseEventDate;

  async function submit() {
    setError(null);
    if (amount.trim() === "") {
      setError(t("subcontracts.retentionAmountRequired"));
      return;
    }
    try {
      await release.mutateAsync({
        id: subcontract.id,
        body: { amount: amount.trim(), date, kind, notes: notes.trim() === "" ? null : notes.trim() },
      });
      setAmount("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("subcontracts.retentionReleaseFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <Card className="p-[14px_16px]">
        <div className="grid gap-[10px] sm:grid-cols-3">
          <Row label={t("subcontracts.retention.held")} value={<MoneyValue value={majorOf(subcontract.retention.held)} showUnit={false} />} />
          <Row label={t("subcontracts.retention.released")} value={<MoneyValue value={majorOf(subcontract.retention.released)} showUnit={false} />} />
          <Row label={t("subcontracts.retention.balance")} value={<MoneyValue value={majorOf(subcontract.retention.balance)} showUnit={false} />} />
          <Row
            label={t("subcontracts.retention.completionDate")}
            value={<span className="mz-num">{subcontract.retention.completionDate ?? t("subcontracts.retention.notCompleted")}</span>}
          />
          <Row
            label={t("subcontracts.retention.provisionalEvent")}
            value={<span className="mz-num">{subcontract.retention.provisionalReleaseEventDate ?? "—"}</span>}
          />
          <Row
            label={t("subcontracts.retention.finalEvent", {
              months: String(subcontract.retention.defectsLiabilityMonths),
            })}
            value={<span className="mz-num">{subcontract.retention.finalReleaseEventDate ?? "—"}</span>}
          />
        </div>
      </Card>

      {mayRelease ? (
        <Card className="p-[14px_16px]">
          <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("subcontracts.retention.releaseAction")}</h3>
          {error ? <p className="mb-[8px] text-[12px] font-semibold text-danger-ink">{error}</p> : null}
          <div className="grid gap-[10px] sm:grid-cols-4">
            <TextField label={t("subcontracts.retention.amount")} value={amount} onChange={setAmount} />
            <TextField label={t("subcontracts.retention.date")} value={date} onChange={setDate} type="date" />
            <SelectField
              label={t("subcontracts.retention.kind")}
              value={kind}
              onChange={(v) => setKind(v as SubcontractRetentionReleaseKindDTO)}
              options={[
                { value: "provisional", label: t("subcontracts.retention.kind.provisional") },
                { value: "final", label: t("subcontracts.retention.kind.final") },
              ]}
            />
            <TextField label={t("common.notes")} value={notes} onChange={setNotes} />
          </div>
          {eventDate !== null && date < eventDate ? (
            <p className="mt-[8px] text-[12px] font-semibold text-warning-ink">
              {t("subcontracts.retention.earlyWarning", { eventDate })}
            </p>
          ) : null}
          <div className="mt-[12px] flex justify-end">
            <Button variant="primary" onClick={() => void submit()} disabled={release.isPending}>
              {t("subcontracts.retention.releaseAction")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-[14px_16px]">
        <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("subcontracts.retention.releases")}</h3>
        {subcontract.retention.releases.length === 0 ? (
          <p className="text-[12px] text-ink-muted">{t("subcontracts.retention.noReleases")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border text-ink-muted">
                  <th className="p-[6px_8px] text-start">{t("subcontracts.col.date")}</th>
                  <th className="p-[6px_8px] text-end">{t("subcontracts.col.amount")}</th>
                  <th className="p-[6px_8px] text-start">{t("subcontracts.retention.kind")}</th>
                  <th className="p-[6px_8px] text-start">{t("subcontracts.retention.eventDate")}</th>
                  <th className="p-[6px_8px] text-start">{t("subcontracts.retention.invoice")}</th>
                  <th className="p-[6px_8px] text-start">{t("common.notes")}</th>
                </tr>
              </thead>
              <tbody>
                {subcontract.retention.releases.map((r) => (
                  <tr key={r.id} className="border-b border-border">
                    <td className="mz-num p-[6px_8px]">{r.date}</td>
                    <td className="mz-num p-[6px_8px] text-end">
                      <MoneyValue value={majorOf(r.amount)} showUnit={false} />
                    </td>
                    <td className="p-[6px_8px]">
                      {t(
                        r.kind === "provisional"
                          ? "subcontracts.retention.kind.provisional"
                          : "subcontracts.retention.kind.final",
                      )}
                      {r.earlyRelease ? (
                        <span className="ms-[6px] text-[11px] font-semibold text-warning-ink">
                          {t("subcontracts.retention.early")}
                        </span>
                      ) : null}
                    </td>
                    <td className="mz-num p-[6px_8px]">{r.releaseEventDate ?? "—"}</td>
                    <td className="p-[6px_8px]">{r.invoiceDocNo ?? "—"}</td>
                    <td className="p-[6px_8px]">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

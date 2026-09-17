import { useMemo, useState, type ChangeEvent } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  Qty as QtyValue,
  Select,
  StatusPill,
  TextInput,
  parseDataMigrationFile,
  type DocumentListColumn,
  type EntityPickerOption,
  type PillTone,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type {
  BoqImportRowDTO,
  BoqLineDTO,
  BoqLineInputDTO,
  BoqUnitDTO,
  CostCategoryDTO,
  FinalSecurityStatusDTO,
  RecognitionPolicyDTO,
  VatBasisDTO,
  WorksContractDTO,
  WorksContractStatusDTO,
  WorksContractTypeDTO,
} from "@mezan/contracts";
import { SelectField, TextAreaField, TextField } from "../../../settings/form-controls";
import { useSubPage, useNavigation } from "../../../navigation";
import { useApi } from "../../../data/ApiContext";
import { useCustomers, useProjects } from "../../../data/hooks";
import {
  useCommitBoqImport,
  useContractBoq,
  useContractedQuantities,
  useCreateWorksContract,
  usePutContractBoq,
  useReviewBoqImport,
  useUpdateWorksContract,
  useVariationOrders,
  useWorksContractTransition,
  useWorksContracts,
} from "../../../data/contracting-contracts-hooks";
import { useRecognitionRuns } from "../../../data/contracting-recognition-hooks";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { majorOf, sumMajor } from "../../../lib/money";
import { todayIso } from "../../../lib/dates";
import { EMPTY } from "../../../lib/empty";
import { BOQ_UNITS, unitLabel } from "../../../lib/boq-unit-label";

/**
 * العقود — the contract, its جدول الكميات and its أوامر التغيير
 * (docs/artifacts/mezan-contracting-designs.html §03 / D-10).
 *
 * Every figure on this screen is the server's: قيمة العقد, القيمة بعد أوامر
 * التغيير and الكمية التعاقدية are read off the response, never recomputed
 * from the rows on display.
 */

const STATUS_KEY: Record<WorksContractStatusDTO, AppTranslationKey> = {
  draft: "worksContracts.status.draft",
  active: "worksContracts.status.active",
  completed: "worksContracts.status.completed",
  terminated: "worksContracts.status.terminated",
};
const STATUS_TONE: Record<WorksContractStatusDTO, PillTone> = {
  draft: "neutral",
  active: "success",
  completed: "info",
  terminated: "danger",
};

const COST_CATEGORIES: readonly CostCategoryDTO[] = ["materials", "labour", "equipment", "subcontract", "indirect"];
const COST_CATEGORY_KEY: Record<CostCategoryDTO, AppTranslationKey> = {
  materials: "costCategory.materials",
  labour: "costCategory.labour",
  equipment: "costCategory.equipment",
  subcontract: "costCategory.subcontract",
  indirect: "costCategory.indirect",
};

/** The columns the import review reads, in the order the contractor's sheet carries them. */
const IMPORT_SPEC = {
  id: "contracting-boq",
  sheetName: "BOQ",
  columns: [
    { key: "code", header: "كود البند" },
    { key: "descriptionAr", header: "وصف البند" },
    { key: "unit", header: "الوحدة" },
    { key: "qty", header: "الكمية" },
    { key: "unitRate", header: "الفئة" },
    { key: "estimatedUnitCost", header: "التكلفة التقديرية" },
    { key: "section", header: "الباب" },
  ],
} as const;

interface DraftLine {
  id?: string;
  code: string;
  descriptionAr: string;
  unit: BoqUnitDTO;
  qty: string;
  unitRate: string;
  estimatedUnitCost: string;
  section: string;
  costCategory: CostCategoryDTO | "";
  /** الكمية النظرية لكل وحدة — the basis «انحراف الاستهلاك» measures against (slice 5B). */
  theoreticalQtyPerUnit: string;
  theoreticalItemId: string;
}

function emptyLine(): DraftLine {
  return {
    code: "",
    descriptionAr: "",
    unit: "m3",
    qty: "",
    unitRate: "",
    estimatedUnitCost: "",
    section: "",
    costCategory: "",
    theoreticalQtyPerUnit: "",
    theoreticalItemId: "",
  };
}

function toInput(line: DraftLine): BoqLineInputDTO {
  return {
    ...(line.id ? { id: line.id } : {}),
    code: line.code.trim(),
    descriptionAr: line.descriptionAr.trim(),
    unit: line.unit,
    qty: line.qty.trim() === "" ? "0" : line.qty.trim(),
    unitRate: line.unitRate.trim() === "" ? "0" : line.unitRate.trim(),
    estimatedUnitCost: line.estimatedUnitCost.trim() === "" ? null : line.estimatedUnitCost.trim(),
    section: line.section.trim() === "" ? null : line.section.trim(),
    costCategory: line.costCategory === "" ? null : line.costCategory,
    theoreticalQtyPerUnit: line.theoreticalQtyPerUnit.trim() === "" ? null : line.theoreticalQtyPerUnit.trim(),
    theoreticalItemId: line.theoreticalItemId.trim() === "" ? null : line.theoreticalItemId.trim(),
  };
}

/**
 * The API's scale-6 decimals ("12.000000") read as noise in an editable cell —
 * the surveyor typed "12". Display only: what goes back on the wire is whatever
 * is in the box.
 */
function trimScale(value: string | null): string {
  if (value === null || value === "") return "";
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

function fromDto(line: BoqLineDTO): DraftLine {
  return {
    id: line.id,
    code: line.code,
    descriptionAr: line.descriptionAr,
    unit: line.unit,
    qty: trimScale(line.qty),
    unitRate: trimScale(line.unitRate),
    estimatedUnitCost: trimScale(line.estimatedUnitCost),
    section: line.section ?? "",
    costCategory: line.costCategory ?? "",
    theoreticalQtyPerUnit: trimScale(line.theoreticalQtyPerUnit),
    theoreticalItemId: line.theoreticalItemId ?? "",
  };
}

/** D-07 — the basis a contract signed on this date defaults to; the server decides, this only previews it. */
function defaultVatBasis(signedDate: string): VatBasisDTO {
  return signedDate < "2025-07-18" ? "transitional" : "standard";
}

export function ContractsScreen() {
  const { t } = useAppTranslation();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;

  const contractsQuery = useWorksContracts();
  const contracts = contractsQuery.data ?? EMPTY;
  const projects = useProjects().data ?? EMPTY;
  const customers = useCustomers().data ?? EMPTY;

  const { session } = useApi();
  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayManage = can(authContext, "contracting.boq.manage");

  const projectName = (id: string) => projects.find((p) => p.id === id)?.nameAr ?? id;
  const customerName = (id: string) => customers.find((c) => c.id === id)?.nameAr ?? id;

  const [statusFilter, setStatusFilter] = useState<WorksContractStatusDTO | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const filtered = useMemo(() => {
    const needle = search.trim();
    return contracts.filter(
      (c) =>
        (statusFilter === "all" || c.status === statusFilter) &&
        (needle === "" ||
          c.docNo.includes(needle) ||
          c.titleAr.includes(needle) ||
          projectName(c.projectId).includes(needle) ||
          customerName(c.customerId).includes(needle)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contracts, statusFilter, search, projects, customers]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selected = firstSegment ? contracts.find((c) => c.docNo === firstSegment || c.id === firstSegment) ?? null : null;

  if (firstSegment === "new") {
    return <NewContractPage onDone={(docNo) => subPage.open(docNo)} onCancel={() => subPage.close()} />;
  }

  if (firstSegment && selected) {
    return <ContractDetailPage contract={selected} mayManage={mayManage} onBack={() => subPage.close()} />;
  }

  if (firstSegment && !contractsQuery.isLoading && !selected) {
    return (
      <EmptyState
        title={t("worksContracts.notFound")}
        description={t("worksContracts.notFoundHint")}
        action={{ label: t("common.back"), onClick: () => subPage.close() }}
      />
    );
  }

  const columns: DocumentListColumn<WorksContractDTO>[] = [
    { key: "docNo", header: t("worksContracts.column.docNo"), render: (c) => <span className="mz-num font-semibold">{c.docNo}</span> },
    { key: "project", header: t("worksContracts.column.project"), render: (c) => projectName(c.projectId) },
    { key: "customer", header: t("worksContracts.column.customer"), render: (c) => customerName(c.customerId) },
    {
      key: "value",
      header: t("worksContracts.column.value"),
      align: "end",
      render: (c) => <MoneyValue value={majorOf(c.contractValue)} showUnit={false} />,
      total: (rows) => <MoneyValue value={sumMajor(rows.map((r) => r.contractValue))} showUnit={false} />,
    },
    {
      key: "afterVariations",
      header: t("worksContracts.column.afterVariations"),
      align: "end",
      render: (c) => <MoneyValue value={majorOf(c.contractValueAfterVariations)} showUnit={false} />,
      total: (rows) => <MoneyValue value={sumMajor(rows.map((r) => r.contractValueAfterVariations))} showUnit={false} />,
    },
    {
      key: "status",
      header: t("worksContracts.column.status"),
      render: (c) => <StatusPill label={t(STATUS_KEY[c.status])} tone={STATUS_TONE[c.status]} />,
    },
  ];

  return (
    <DocumentList<WorksContractDTO>
      title={t("worksContracts.title")}
      description={t("worksContracts.description")}
      actions={
        mayManage ? (
          <Button variant="primary" onClick={() => subPage.open("new")}>
            {t("worksContracts.new")}
          </Button>
        ) : null
      }
      stats={[
        { label: t("worksContracts.stat.active"), value: <span className="mz-num">{contracts.filter((c) => c.status === "active").length}</span> },
        { label: t("worksContracts.stat.value"), value: <MoneyValue value={sumMajor(contracts.map((c) => c.contractValueAfterVariations))} showUnit={false} /> },
        { label: t("worksContracts.stat.variations"), value: <span className="mz-num">{contracts.reduce((n, c) => n + c.variationCount, 0)}</span> },
      ]}
      statusChips={[
        { key: "all", label: t("common.all"), count: contracts.length },
        { key: "draft", label: t("worksContracts.status.draft"), count: contracts.filter((c) => c.status === "draft").length },
        { key: "active", label: t("worksContracts.status.active"), count: contracts.filter((c) => c.status === "active").length },
        { key: "completed", label: t("worksContracts.status.completed"), count: contracts.filter((c) => c.status === "completed").length },
        { key: "terminated", label: t("worksContracts.status.terminated"), count: contracts.filter((c) => c.status === "terminated").length },
      ]}
      activeStatusKey={statusFilter}
      onStatusChange={(key) => setStatusFilter(key as WorksContractStatusDTO | "all")}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={t("worksContracts.searchPlaceholder")}
      columns={columns}
      rows={pageRows}
      rowKey={(c) => c.id}
      loading={contractsQuery.isLoading}
      loadFailed={contractsQuery.isError}
      onRowClick={(c) => subPage.open(c.docNo)}
      page={currentPage}
      pageCount={pageCount}
      onPageChange={setPage}
      emptyState={
        <EmptyState
          title={t("worksContracts.empty")}
          description={t("worksContracts.emptyHint")}
          {...(mayManage ? { action: { label: t("worksContracts.new"), onClick: () => subPage.open("new") } } : {})}
        />
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* عقد جديد                                                             */
/* ------------------------------------------------------------------ */

function NewContractPage({ onDone, onCancel }: { onDone: (docNo: string) => void; onCancel: () => void }) {
  const { t } = useAppTranslation();
  const projects = useProjects().data ?? EMPTY;
  const customers = useCustomers().data ?? EMPTY;
  const create = useCreateWorksContract();

  const [project, setProject] = useState<EntityPickerOption | null>(null);
  const [customer, setCustomer] = useState<EntityPickerOption | null>(null);
  const [titleAr, setTitleAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [contractType, setContractType] = useState<WorksContractTypeDTO>("private");
  const [signedDate, setSignedDate] = useState(todayIso());
  const [startDate, setStartDate] = useState(todayIso());
  const [plannedEndDate, setPlannedEndDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [estimatedTotalCost, setEstimatedTotalCost] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [tenderDiscountPercent, setTenderDiscountPercent] = useState("0");
  const [retentionPercent, setRetentionPercent] = useState("5");
  const [retentionCapPercent, setRetentionCapPercent] = useState("");
  const [advancePercent, setAdvancePercent] = useState("10");
  const [advanceRecoveryPercent, setAdvanceRecoveryPercent] = useState("10");
  const [materialsOnSitePercent, setMaterialsOnSitePercent] = useState("75");
  const [deemedWagePercent, setDeemedWagePercent] = useState("20");
  const [socialInsuranceRatePercent, setSocialInsuranceRatePercent] = useState("18.75");
  const [socialInsuranceNote, setSocialInsuranceNote] = useState("");
  const [withholdingTaxPercent, setWithholdingTaxPercent] = useState("1");
  const [vatBasis, setVatBasis] = useState<VatBasisDTO>(defaultVatBasis(todayIso()));
  const [paymentTermDays, setPaymentTermDays] = useState("30");
  const [defectsLiabilityMonths, setDefectsLiabilityMonths] = useState("12");
  const [recognitionPolicy, setRecognitionPolicy] = useState<RecognitionPolicyDTO>("cost_to_cost");
  const [stampDutyPercent, setStampDutyPercent] = useState("0");
  const [latePenaltyPercentPerPeriod, setLatePenaltyPercentPerPeriod] = useState("0");
  const [latePenaltyCapPercent, setLatePenaltyCapPercent] = useState("10");
  const [finalSecurityPercent, setFinalSecurityPercent] = useState("0");

  function chooseProject(option: EntityPickerOption | null) {
    setProject(option);
    // The project already names its customer; defaulting to it saves the
    // second search and is what the paperwork says anyway.
    const projectCustomer = projects.find((p) => p.id === option?.id)?.customerId ?? null;
    if (projectCustomer) {
      const match = customers.find((c) => c.id === projectCustomer);
      if (match) setCustomer({ id: match.id, label: match.nameAr });
    }
  }

  function chooseType(next: WorksContractTypeDTO) {
    setContractType(next);
    setPaymentTermDays(next === "public" ? "60" : "30");
    setFinalSecurityPercent(next === "public" ? "5" : "0");
  }

  function chooseSignedDate(next: string) {
    setSignedDate(next);
    setVatBasis(defaultVatBasis(next));
  }

  async function save() {
    setError(null);
    if (!project || !customer || titleAr.trim() === "") {
      setError(t("worksContracts.missingRequired"));
      return;
    }
    try {
      const created = await create.mutateAsync({
        id: `CTR-${Date.now()}`,
        projectId: project.id,
        customerId: customer.id,
        titleAr: titleAr.trim(),
        titleEn: titleEn.trim() === "" ? null : titleEn.trim(),
        contractType,
        signedDate,
        startDate,
        plannedEndDate,
        notes: notes.trim() === "" ? null : notes.trim(),
        estimatedTotalCost: estimatedTotalCost.trim() === "" ? null : estimatedTotalCost.trim(),
        tenderDiscountPercent,
        retentionPercent,
        retentionCapPercent: retentionCapPercent.trim() === "" ? null : retentionCapPercent.trim(),
        advancePercent,
        advanceRecoveryPercent,
        materialsOnSitePercent,
        deemedWagePercent,
        socialInsuranceRatePercent,
        socialInsuranceNote: socialInsuranceNote.trim() === "" ? null : socialInsuranceNote.trim(),
        withholdingTaxPercent,
        vatBasis,
        paymentTermDays: Number(paymentTermDays),
        defectsLiabilityMonths: Number(defectsLiabilityMonths),
        recognitionPolicy,
        stampDutyPercent,
        latePenaltyPercentPerPeriod,
        latePenaltyCapPercent,
        finalSecurityPercent,
      });
      onDone(created.docNo);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("worksContracts.saveFailed"));
    }
  }

  return (
    <div className="w-full">
      <div className="mb-[14px] flex items-center justify-between gap-[12px]">
        <h1 className="font-display text-xl font-bold text-ink">{t("worksContracts.new")}</h1>
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
      </div>

      {error ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <p className="text-[13px] font-semibold text-danger-ink">{error}</p>
        </Card>
      ) : null}

      <Card className="mb-[16px] p-[16px_18px]">
        <h2 className="mb-[12px] text-[13px] font-bold text-ink">{t("worksContracts.section.header")}</h2>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
          <EntityPicker
            label={t("common.project")}
            value={project}
            onChange={chooseProject}
            options={projects.map((p) => ({ id: p.id, label: p.nameAr, sublabel: p.code }))}
            placeholder={t("worksContracts.pickProject")}
            emptyMessage={t("worksContracts.noProjects")}
          />
          <EntityPicker
            label={t("common.customer")}
            value={customer}
            onChange={setCustomer}
            options={customers.map((c) => ({ id: c.id, label: c.nameAr, sublabel: c.code }))}
            placeholder={t("worksContracts.pickCustomer")}
            emptyMessage={t("worksContracts.noCustomers")}
          />
          <SelectField
            label={t("worksContracts.field.contractType")}
            value={contractType}
            onChange={(v) => chooseType(v as WorksContractTypeDTO)}
            options={[
              { value: "private", label: t("worksContracts.type.private") },
              { value: "public", label: t("worksContracts.type.public") },
            ]}
          />
          <TextField label={t("worksContracts.field.titleAr")} value={titleAr} onChange={setTitleAr} />
          <TextField label={t("worksContracts.field.titleEn")} value={titleEn} onChange={setTitleEn} />
          <TextField label={t("worksContracts.field.signedDate")} value={signedDate} onChange={chooseSignedDate} type="date" />
          <TextField label={t("worksContracts.field.startDate")} value={startDate} onChange={setStartDate} type="date" />
          <TextField label={t("worksContracts.field.plannedEndDate")} value={plannedEndDate} onChange={setPlannedEndDate} type="date" />
          <TextField
            label={t("worksContracts.field.estimatedTotalCost")}
            value={estimatedTotalCost}
            onChange={setEstimatedTotalCost}
            hint={t("worksContracts.hint.estimatedTotalCost")}
          />
        </div>
        <div className="mt-[12px]">
          <TextAreaField label={t("common.notes")} value={notes} onChange={setNotes} rows={2} />
        </div>
      </Card>

      <Card className="mb-[16px] p-[16px_18px]">
        <h2 className="mb-[4px] text-[13px] font-bold text-ink">{t("worksContracts.section.terms")}</h2>
        <p className="mb-[12px] text-[11.5px] text-ink-muted">{t("worksContracts.section.termsHint")}</p>
        <div className="grid gap-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <TextField label={t("worksContracts.field.tenderDiscountPercent")} value={tenderDiscountPercent} onChange={setTenderDiscountPercent} />
          <TextField label={t("worksContracts.field.retentionPercent")} value={retentionPercent} onChange={setRetentionPercent} />
          <TextField label={t("worksContracts.field.retentionCapPercent")} value={retentionCapPercent} onChange={setRetentionCapPercent} hint={t("worksContracts.hint.retentionCap")} />
          <TextField label={t("worksContracts.field.advancePercent")} value={advancePercent} onChange={setAdvancePercent} />
          <TextField label={t("worksContracts.field.advanceRecoveryPercent")} value={advanceRecoveryPercent} onChange={setAdvanceRecoveryPercent} />
          <TextField label={t("worksContracts.field.materialsOnSitePercent")} value={materialsOnSitePercent} onChange={setMaterialsOnSitePercent} />
          <TextField label={t("worksContracts.field.deemedWagePercent")} value={deemedWagePercent} onChange={setDeemedWagePercent} />
          <TextField label={t("worksContracts.field.socialInsuranceRatePercent")} value={socialInsuranceRatePercent} onChange={setSocialInsuranceRatePercent} />
          <TextField label={t("worksContracts.field.withholdingTaxPercent")} value={withholdingTaxPercent} onChange={setWithholdingTaxPercent} hint={t("worksContracts.hint.withholding")} />
          <SelectField
            label={t("worksContracts.field.vatBasis")}
            value={vatBasis}
            onChange={(v) => setVatBasis(v as VatBasisDTO)}
            options={[
              { value: "standard", label: t("worksContracts.vat.standard") },
              { value: "transitional", label: t("worksContracts.vat.transitional") },
            ]}
            hint={t("worksContracts.hint.vatBasis")}
          />
          <TextField label={t("worksContracts.field.paymentTermDays")} value={paymentTermDays} onChange={setPaymentTermDays} />
          <TextField label={t("worksContracts.field.defectsLiabilityMonths")} value={defectsLiabilityMonths} onChange={setDefectsLiabilityMonths} />
          <SelectField
            label={t("worksContracts.field.recognitionPolicy")}
            value={recognitionPolicy}
            onChange={(v) => setRecognitionPolicy(v as RecognitionPolicyDTO)}
            options={[
              { value: "cost_to_cost", label: t("worksContracts.recognition.cost_to_cost") },
              { value: "certified_value", label: t("worksContracts.recognition.certified_value") },
            ]}
          />
          <TextField label={t("worksContracts.field.stampDutyPercent")} value={stampDutyPercent} onChange={setStampDutyPercent} />
          <TextField label={t("worksContracts.field.latePenaltyPercentPerPeriod")} value={latePenaltyPercentPerPeriod} onChange={setLatePenaltyPercentPerPeriod} />
          <TextField label={t("worksContracts.field.latePenaltyCapPercent")} value={latePenaltyCapPercent} onChange={setLatePenaltyCapPercent} />
          <TextField label={t("worksContracts.field.finalSecurityPercent")} value={finalSecurityPercent} onChange={setFinalSecurityPercent} />
        </div>
        <div className="mt-[12px]">
          <TextField label={t("worksContracts.field.socialInsuranceNote")} value={socialInsuranceNote} onChange={setSocialInsuranceNote} />
        </div>
      </Card>

      <div className="flex justify-end gap-[9px]">
        <Button onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void save()} disabled={create.isPending}>
          {t("worksContracts.saveDraft")}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* تفاصيل العقد                                                         */
/* ------------------------------------------------------------------ */

function ContractDetailPage({
  contract,
  mayManage,
  onBack,
}: {
  contract: WorksContractDTO;
  mayManage: boolean;
  onBack: () => void;
}) {
  const { t } = useAppTranslation();
  const { navigate, openScreenAt } = useNavigation();
  const projects = useProjects().data ?? EMPTY;
  const customers = useCustomers().data ?? EMPTY;
  const transition = useWorksContractTransition();
  const [actionDate, setActionDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);

  const projectName = projects.find((p) => p.id === contract.projectId)?.nameAr ?? contract.projectId;
  const customerName = customers.find((c) => c.id === contract.customerId)?.nameAr ?? contract.customerId;

  async function move(action: "activate" | "complete" | "terminate") {
    setError(null);
    try {
      await transition.mutateAsync({ id: contract.id, action, date: actionDate });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("worksContracts.saveFailed"));
    }
  }

  return (
    <DocumentDetail
      title={`${contract.docNo} — ${contract.titleAr}`}
      statusLabel={t(STATUS_KEY[contract.status])}
      statusTone={STATUS_TONE[contract.status]}
      subtitle={`${projectName} · ${customerName}`}
      actions={
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button onClick={onBack}>{t("common.back")}</Button>
          {mayManage && contract.status !== "completed" && contract.status !== "terminated" ? (
            <>
              <TextInput type="date" value={actionDate} onChange={(e) => setActionDate(e.target.value)} aria-label={t("worksContracts.actionDate")} />
              {contract.status === "draft" ? (
                <Button variant="primary" onClick={() => void move("activate")} disabled={transition.isPending}>
                  {t("worksContracts.activate")}
                </Button>
              ) : null}
              {contract.status === "active" ? (
                <Button variant="primary" onClick={() => void move("complete")} disabled={transition.isPending || !contract.canComplete}>
                  {t("worksContracts.complete")}
                </Button>
              ) : null}
              <Button onClick={() => void move("terminate")} disabled={transition.isPending}>
                {t("worksContracts.terminate")}
              </Button>
            </>
          ) : null}
        </div>
      }
      summary={[
        { label: t("worksContracts.column.value"), value: <MoneyValue value={majorOf(contract.contractValue)} showUnit={false} /> },
        { label: t("worksContracts.summary.variations"), value: <MoneyValue value={majorOf(contract.approvedVariationsValue)} showUnit={false} /> },
        { label: t("worksContracts.column.afterVariations"), value: <MoneyValue value={majorOf(contract.contractValueAfterVariations)} showUnit={false} /> },
        { label: t("worksContracts.summary.boqLines"), value: <span className="mz-num">{contract.boqLineCount}</span> },
        { label: t("worksContracts.summary.variationCount"), value: <span className="mz-num">{contract.variationCount}</span> },
        { label: t("worksContracts.field.paymentTermDays"), value: <span className="mz-num">{contract.paymentTermDays}</span> },
      ]}
      tabs={[
        {
          key: "header",
          label: t("worksContracts.tab.header"),
          content: (
            <>
              {error ? <p className="mb-[10px] text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
              <ContractTermsPanel contract={contract} onOpenGuarantee={(docNo) => openScreenAt("guarantees", [docNo])} />
            </>
          ),
        },
        { key: "boq", label: t("worksContracts.tab.boq"), content: <BoqTab contract={contract} mayManage={mayManage} /> },
        {
          key: "variations",
          label: t("worksContracts.tab.variations"),
          content: <ContractVariationsTab contract={contract} onNew={() => navigate("variation-orders", { kind: "create", prefill: { contractId: contract.id } })} />,
        },
        { key: "budget", label: t("worksContracts.tab.budget"), content: <BudgetTab contract={contract} mayManage={mayManage} /> },
        {
          key: "recognition",
          label: t("worksContracts.tab.recognition"),
          content: <ContractRecognitionTab contract={contract} onOpenRun={(docNo) => openScreenAt("revenue-recognition", [docNo])} />,
        },
      ]}
    />
  );
}

/**
 * الاعتراف بالإيراد — every month this contract has been run, newest first.
 * Read-only here: the run itself is posted from «الاعتراف بالإيراد», which is
 * where the period is chosen and the figures are previewed before posting.
 */
function ContractRecognitionTab({
  contract,
  onOpenRun,
}: {
  contract: WorksContractDTO;
  onOpenRun: (docNo: string) => void;
}) {
  const { t } = useAppTranslation();
  const runsQuery = useRecognitionRuns(contract.id);
  const runs = runsQuery.data ?? EMPTY;

  if (runsQuery.isLoading) {
    return <EmptyState title={t("common.loading")} description={t("revenueRecognition.loadingRun")} />;
  }
  if (runs.length === 0) {
    return <EmptyState title={t("worksContracts.noRunsTitle")} description={t("worksContracts.noRunsBody")} />;
  }
  return (
    <Card className="divide-y divide-border">
      {runs.map((run) => (
        <button
          key={run.id}
          type="button"
          className="flex w-full flex-wrap items-center justify-between gap-3 p-[13px_15px] text-start hover:bg-surface-2"
          onClick={() => onOpenRun(run.docNo)}
        >
          <div className="min-w-0">
            <div className="mz-num text-[13px] font-semibold text-ink">
              {run.docNo} · {run.periodEnd}
            </div>
            <div className="text-[11.5px] text-ink-muted">
              {t("revenueRecognition.percentComplete")}: <span className="mz-num">{run.percentComplete}%</span>
              {run.status === "reversed" ? ` · ${t("revenueRecognition.status.reversed")}` : ""}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-[18px]">
            <RunFigure label={t("revenueRecognition.periodRevenue")} value={majorOf(run.periodRevenue)} />
            <RunFigure label={t("revenueRecognition.wipRelieved")} value={majorOf(run.wipRelieved)} />
            <RunFigure label={t("revenueRecognition.provisionRequired")} value={majorOf(run.provisionRequired)} />
          </div>
        </button>
      ))}
    </Card>
  );
}

function RunFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-end">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[3px] text-[13px] font-bold text-ink">
        <MoneyValue value={value} />
      </div>
    </div>
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

function ContractTermsPanel({
  contract,
  onOpenGuarantee,
}: {
  contract: WorksContractDTO;
  onOpenGuarantee: (docNo: string) => void;
}) {
  const { t } = useAppTranslation();
  const pct = (v: string | null) => (v === null ? "—" : <span className="mz-num">{v}%</span>);
  return (
    <div className="grid gap-[16px] lg:grid-cols-2">
      <Card className="p-[14px_16px]">
        <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("worksContracts.section.header")}</h3>
        <Row label={t("worksContracts.field.contractType")} value={t(contract.contractType === "public" ? "worksContracts.type.public" : "worksContracts.type.private")} />
        <Row label={t("worksContracts.field.signedDate")} value={<span className="mz-num">{contract.signedDate}</span>} />
        <Row label={t("worksContracts.field.startDate")} value={<span className="mz-num">{contract.startDate}</span>} />
        <Row label={t("worksContracts.field.plannedEndDate")} value={<span className="mz-num">{contract.plannedEndDate}</span>} />
        <Row label={t("worksContracts.field.defectsLiabilityMonths")} value={<span className="mz-num">{contract.defectsLiabilityMonths}</span>} />
        <Row label={t("worksContracts.field.recognitionPolicy")} value={t(contract.recognitionPolicy === "cost_to_cost" ? "worksContracts.recognition.cost_to_cost" : "worksContracts.recognition.certified_value")} />
        <Row label={t("common.notes")} value={contract.notes ?? "—"} />
      </Card>
      <Card className="p-[14px_16px]">
        <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("worksContracts.section.terms")}</h3>
        <Row label={t("worksContracts.field.tenderDiscountPercent")} value={pct(contract.tenderDiscountPercent)} />
        <Row label={t("worksContracts.field.retentionPercent")} value={pct(contract.retentionPercent)} />
        <Row label={t("worksContracts.field.retentionCapPercent")} value={pct(contract.retentionCapPercent)} />
        <Row label={t("worksContracts.field.advancePercent")} value={pct(contract.advancePercent)} />
        <Row label={t("worksContracts.field.advanceRecoveryPercent")} value={pct(contract.advanceRecoveryPercent)} />
        <Row label={t("worksContracts.field.materialsOnSitePercent")} value={pct(contract.materialsOnSitePercent)} />
        <Row label={t("worksContracts.field.deemedWagePercent")} value={pct(contract.deemedWagePercent)} />
        <Row label={t("worksContracts.field.socialInsuranceRatePercent")} value={pct(contract.socialInsuranceRatePercent)} />
        <Row label={t("worksContracts.field.withholdingTaxPercent")} value={pct(contract.withholdingTaxPercent)} />
        <Row label={t("worksContracts.field.vatBasis")} value={t(contract.vatBasis === "standard" ? "worksContracts.vat.standard" : "worksContracts.vat.transitional")} />
        <Row label={t("worksContracts.field.stampDutyPercent")} value={pct(contract.stampDutyPercent)} />
        <Row label={t("worksContracts.field.latePenaltyPercentPerPeriod")} value={pct(contract.latePenaltyPercentPerPeriod)} />
        <Row label={t("worksContracts.field.latePenaltyCapPercent")} value={pct(contract.latePenaltyCapPercent)} />
        <Row label={t("worksContracts.field.finalSecurityPercent")} value={pct(contract.finalSecurityPercent)} />
        <FinalSecurityRows status={contract.finalSecurityStatus} onOpenGuarantee={onOpenGuarantee} />
        <Row label={t("worksContracts.field.socialInsuranceNote")} value={contract.socialInsuranceNote ?? "—"} />
      </Card>
    </div>
  );
}

/**
 * التأمين النهائي — on a Law 182/2018 contract the 5% is a letter on the
 * register, not cash held back, so the terms panel has to say whether that
 * letter actually covers the requirement and point at it.
 */
function FinalSecurityRows({
  status,
  onOpenGuarantee,
}: {
  status: FinalSecurityStatusDTO | null;
  onOpenGuarantee: (docNo: string) => void;
}) {
  const { t } = useAppTranslation();
  if (status === null) return null;
  const short = majorOf(status.shortfall) > 0;
  return (
    <>
      <Row
        label={t("worksContracts.finalSecurity.required")}
        value={<MoneyValue value={majorOf(status.required)} showUnit={false} />}
      />
      <Row
        label={t("worksContracts.finalSecurity.covered")}
        value={
          <span className={short ? "text-danger-ink" : undefined}>
            <MoneyValue value={majorOf(status.covered)} showUnit={false} />
          </span>
        }
      />
      <Row
        label={t("worksContracts.finalSecurity.guarantee")}
        value={
          status.guaranteeDocNo ? (
            <button
              type="button"
              className="text-[12.5px] font-semibold text-brand underline"
              onClick={() => onOpenGuarantee(status.guaranteeDocNo ?? "")}
            >
              {status.guaranteeDocNo}
            </button>
          ) : (
            <span className="text-danger-ink">{t("worksContracts.finalSecurity.none")}</span>
          )
        }
      />
      {short ? (
        <Row
          label={t("worksContracts.finalSecurity.shortfall")}
          value={
            <span className="text-danger-ink">
              <MoneyValue value={majorOf(status.shortfall)} showUnit={false} />
            </span>
          }
        />
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* جدول الكميات                                                         */
/* ------------------------------------------------------------------ */

function BoqTab({ contract, mayManage }: { contract: WorksContractDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const boqQuery = useContractBoq(contract.id);
  const put = usePutContractBoq();
  const review = useReviewBoqImport();
  const commit = useCommitBoqImport();

  const stored = boqQuery.data?.lines ?? EMPTY;
  const [draft, setDraft] = useState<DraftLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<BoqImportRowDTO[] | null>(null);
  const [asOfDate, setAsOfDate] = useState(todayIso());

  const editable = mayManage && contract.status === "draft";
  const lines = draft ?? stored.map(fromDto);
  const contractedQuery = useContractedQuantities(contract.status === "draft" ? null : contract.id, asOfDate);

  function edit(index: number, patch: Partial<DraftLine>) {
    setDraft((prev) => {
      const base = prev ?? stored.map(fromDto);
      return base.map((line, i) => (i === index ? { ...line, ...patch } : line));
    });
  }

  async function save() {
    setError(null);
    try {
      await put.mutateAsync({ id: contract.id, body: { lines: lines.map(toInput) } });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("boq.saveFailed"));
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const parsed = await parseDataMigrationFile(await file.arrayBuffer(), IMPORT_SPEC);
      const rows: BoqImportRowDTO[] = parsed.rows.map((r) => ({
        code: r.code ?? "",
        descriptionAr: r.descriptionAr ?? "",
        unit: r.unit ?? "",
        qty: r.qty ?? "",
        unitRate: r.unitRate ?? "",
        estimatedUnitCost: r.estimatedUnitCost ?? "",
        section: r.section ?? "",
      }));
      setImportRows(rows);
      await review.mutateAsync({ id: contract.id, body: { rows } });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("boq.importFailed"));
    }
  }

  async function commitImport() {
    if (!importRows) return;
    setError(null);
    try {
      await commit.mutateAsync({ id: contract.id, body: { rows: importRows } });
      setImportRows(null);
      review.reset();
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("boq.importFailed"));
    }
  }

  const total = sumMajor(lines.map((l) => String(Number(l.qty || "0") * Number(l.unitRate || "0"))));

  return (
    <div className="w-full">
      {error ? <p className="mb-[10px] text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}

      {editable ? (
        <div className="mb-[12px] flex flex-wrap items-center gap-[9px]">
          <Button onClick={() => setDraft([...(draft ?? stored.map(fromDto)), emptyLine()])}>{t("boq.addLine")}</Button>
          <Button variant="primary" onClick={() => void save()} disabled={put.isPending || draft === null}>
            {t("boq.save")}
          </Button>
          {draft !== null ? <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button> : null}
          <label className="inline-flex cursor-pointer items-center gap-[7px] rounded-md border border-border bg-surface px-[12px] py-[7px] text-[12.5px] font-semibold text-ink">
            {t("boq.importExcel")}
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => void onFile(e)} />
          </label>
        </div>
      ) : null}

      {review.data && importRows ? (
        <Card className="mb-[14px] p-[14px_16px]">
          <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("boq.importReview")}</h3>
          <p className="mb-[10px] text-[11.5px] text-ink-muted">
            {t("boq.importSummary", { accepted: review.data.acceptedCount, rejected: review.data.rejectedCount })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-ink-muted">
                  <th className="p-[6px] text-start">{t("boq.column.row")}</th>
                  <th className="p-[6px] text-start">{t("boq.column.code")}</th>
                  <th className="p-[6px] text-start">{t("boq.column.description")}</th>
                  <th className="p-[6px] text-start">{t("boq.column.problems")}</th>
                </tr>
              </thead>
              <tbody>
                {review.data.rows.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-border">
                    <td className="mz-num p-[6px]">{r.rowNumber}</td>
                    <td className="mz-num p-[6px]">{r.code}</td>
                    <td className="p-[6px]">{r.descriptionAr}</td>
                    <td className="p-[6px]">
                      {r.accepted ? (
                        <StatusPill label={t("boq.rowAccepted")} tone="success" />
                      ) : (
                        <span className="text-danger-ink">{r.problems.join("، ")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-[10px] flex gap-[9px]">
            <Button variant="primary" onClick={() => void commitImport()} disabled={commit.isPending || review.data.acceptedCount === 0}>
              {t("boq.commitImport")}
            </Button>
            <Button onClick={() => { setImportRows(null); review.reset(); }}>{t("common.cancel")}</Button>
          </div>
        </Card>
      ) : null}

      {lines.length === 0 ? (
        <EmptyState title={t("boq.empty")} description={editable ? t("boq.emptyHint") : t("boq.emptyReadOnly")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-ink-muted">
                <th className="p-[7px] text-start">{t("boq.column.code")}</th>
                <th className="p-[7px] text-start">{t("boq.column.description")}</th>
                <th className="p-[7px] text-start">{t("boq.column.unit")}</th>
                <th className="p-[7px] text-end">{t("boq.column.qty")}</th>
                <th className="p-[7px] text-end">{t("boq.column.unitRate")}</th>
                <th className="p-[7px] text-end">{t("boq.column.estimatedUnitCost")}</th>
                <th className="p-[7px] text-start">{t("boq.column.section")}</th>
                <th className="p-[7px] text-start">{t("boq.column.costCategory")}</th>
                <th className="p-[7px] text-end">{t("boq.column.theoreticalQtyPerUnit")}</th>
                <th className="p-[7px] text-end">{t("boq.column.lineValue")}</th>
                <th className="p-[7px] text-start">{t("boq.column.origin")}</th>
                {editable ? <th className="p-[7px]" /> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const dto = stored.find((s) => s.id === line.id);
                return (
                  <tr key={line.id ?? `new-${index}`} className="border-t border-border align-top">
                    <td className="p-[5px]">{editable ? <TextInput value={line.code} onChange={(e) => edit(index, { code: e.target.value })} aria-label={t("boq.column.code")} /> : <span className="mz-num">{line.code}</span>}</td>
                    <td className="p-[5px]">{editable ? <TextInput value={line.descriptionAr} onChange={(e) => edit(index, { descriptionAr: e.target.value })} aria-label={t("boq.column.description")} /> : line.descriptionAr}</td>
                    <td className="p-[5px]">
                      {editable ? (
                        <Select
                          value={line.unit}
                          onChange={(v) => edit(index, { unit: v as BoqUnitDTO })}
                          options={BOQ_UNITS.map((u) => ({ value: u, label: unitLabel(u, t) }))}
                          aria-label={t("boq.column.unit")}
                        />
                      ) : (
                        unitLabel(line.unit, t)
                      )}
                    </td>
                    <td className="p-[5px] text-end">{editable ? <TextInput numeric value={line.qty} onChange={(e) => edit(index, { qty: e.target.value })} aria-label={t("boq.column.qty")} /> : <QtyValue value={line.qty} />}</td>
                    <td className="p-[5px] text-end">{editable ? <TextInput numeric value={line.unitRate} onChange={(e) => edit(index, { unitRate: e.target.value })} aria-label={t("boq.column.unitRate")} /> : <MoneyValue value={majorOf(line.unitRate)} showUnit={false} />}</td>
                    <td className="p-[5px] text-end">{editable ? <TextInput numeric value={line.estimatedUnitCost} onChange={(e) => edit(index, { estimatedUnitCost: e.target.value })} aria-label={t("boq.column.estimatedUnitCost")} /> : line.estimatedUnitCost === "" ? "—" : <MoneyValue value={majorOf(line.estimatedUnitCost)} showUnit={false} />}</td>
                    <td className="p-[5px]">{editable ? <TextInput value={line.section} onChange={(e) => edit(index, { section: e.target.value })} aria-label={t("boq.column.section")} /> : line.section || "—"}</td>
                    <td className="p-[5px]">
                      {editable ? (
                        <Select
                          value={line.costCategory}
                          onChange={(v) => edit(index, { costCategory: v as CostCategoryDTO | "" })}
                          options={[{ value: "", label: t("boq.noCostCategory") }, ...COST_CATEGORIES.map((c) => ({ value: c, label: t(COST_CATEGORY_KEY[c]) }))]}
                          aria-label={t("boq.column.costCategory")}
                        />
                      ) : line.costCategory === "" ? (
                        "—"
                      ) : (
                        t(COST_CATEGORY_KEY[line.costCategory])
                      )}
                    </td>
                    <td className="p-[5px] text-end">
                      {editable ? (
                        <TextInput
                          numeric
                          value={line.theoreticalQtyPerUnit}
                          onChange={(e) => edit(index, { theoreticalQtyPerUnit: e.target.value })}
                          aria-label={t("boq.column.theoreticalQtyPerUnit")}
                        />
                      ) : line.theoreticalQtyPerUnit === "" ? (
                        "—"
                      ) : (
                        <QtyValue value={line.theoreticalQtyPerUnit} />
                      )}
                    </td>
                    <td className="p-[5px] text-end">
                      <MoneyValue value={dto ? majorOf(dto.lineValue) : Number(line.qty || "0") * Number(line.unitRate || "0")} showUnit={false} />
                    </td>
                    <td className="p-[5px]">
                      <StatusPill
                        label={t(line.id && dto?.origin === "variation" ? "boq.origin.variation" : "boq.origin.base")}
                        tone={dto?.origin === "variation" ? "info" : "neutral"}
                      />
                    </td>
                    {editable ? (
                      <td className="p-[5px]">
                        <Button size="sm" onClick={() => setDraft((prev) => (prev ?? stored.map(fromDto)).filter((_, i) => i !== index))}>
                          {t("common.delete")}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="p-[7px]" colSpan={8}>{t("boq.total")}</td>
                <td className="p-[7px] text-end">
                  <MoneyValue value={boqQuery.data && draft === null ? majorOf(boqQuery.data.total) : total} showUnit={false} />
                </td>
                <td className="p-[7px]" colSpan={editable ? 2 : 1} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {contract.status !== "draft" ? (
        <Card className="mt-[16px] p-[14px_16px]">
          <h3 className="mb-[4px] text-[12.5px] font-bold text-ink">{t("boq.contractedQty")}</h3>
          <p className="mb-[10px] text-[11.5px] text-ink-muted">{t("boq.contractedQtyHint")}</p>
          <div className="mb-[10px] max-w-[220px]">
            <TextField label={t("boq.asOfDate")} value={asOfDate} onChange={setAsOfDate} type="date" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-ink-muted">
                  <th className="p-[7px] text-start">{t("boq.column.code")}</th>
                  <th className="p-[7px] text-start">{t("boq.column.description")}</th>
                  <th className="p-[7px] text-end">{t("boq.column.baseQty")}</th>
                  <th className="p-[7px] text-end">{t("boq.column.adjustmentQty")}</th>
                  <th className="p-[7px] text-end">{t("boq.column.contractedQty")}</th>
                </tr>
              </thead>
              <tbody>
                {(contractedQuery.data?.rows ?? EMPTY).map((row) => (
                  <tr key={row.boqLineId} className="border-t border-border">
                    <td className="mz-num p-[7px]">{row.code}</td>
                    <td className="p-[7px]">{row.descriptionAr}</td>
                    <td className="p-[7px] text-end"><QtyValue value={row.baseQty} /></td>
                    <td className="p-[7px] text-end"><QtyValue value={row.adjustmentQty} /></td>
                    <td className="p-[7px] text-end font-semibold"><QtyValue value={row.contractedQty} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* أوامر التغيير على هذا العقد + الميزانية                               */
/* ------------------------------------------------------------------ */

function ContractVariationsTab({ contract, onNew }: { contract: WorksContractDTO; onNew: () => void }) {
  const { t } = useAppTranslation();
  const orders = useVariationOrders({ contractId: contract.id }).data ?? EMPTY;

  return (
    <div className="w-full">
      <div className="mb-[12px] flex justify-end">
        <Button variant="primary" onClick={onNew} disabled={contract.status !== "active"}>
          {t("variationOrders.new")}
        </Button>
      </div>
      {orders.length === 0 ? (
        <EmptyState title={t("variationOrders.emptyForContract")} description={t("variationOrders.emptyForContractHint")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-ink-muted">
                <th className="p-[7px] text-start">{t("variationOrders.column.docNo")}</th>
                <th className="p-[7px] text-start">{t("variationOrders.column.date")}</th>
                <th className="p-[7px] text-start">{t("variationOrders.column.title")}</th>
                <th className="p-[7px] text-end">{t("variationOrders.column.netValue")}</th>
                <th className="p-[7px] text-start">{t("variationOrders.column.approvedAt")}</th>
                <th className="p-[7px] text-start">{t("variationOrders.column.status")}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border">
                  <td className="mz-num p-[7px] font-semibold">{o.docNo}</td>
                  <td className="mz-num p-[7px]">{o.date}</td>
                  <td className="p-[7px]">{o.titleAr}</td>
                  <td className="p-[7px] text-end"><MoneyValue value={majorOf(o.netValue)} showUnit={false} /></td>
                  <td className="mz-num p-[7px]">{o.approvedAt ?? "—"}</td>
                  <td className="p-[7px]">
                    <StatusPill
                      label={t(o.status === "approved" ? "variationOrders.status.approved" : o.status === "rejected" ? "variationOrders.status.rejected" : "variationOrders.status.draft")}
                      tone={o.status === "approved" ? "success" : o.status === "rejected" ? "danger" : "neutral"}
                    />
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

function BudgetTab({ contract, mayManage }: { contract: WorksContractDTO; mayManage: boolean }) {
  const { t } = useAppTranslation();
  const update = useUpdateWorksContract();
  const [value, setValue] = useState(contract.estimatedTotalCost ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({
        id: contract.id,
        patch: { estimatedTotalCost: value.trim() === "" ? null : value.trim(), reason: reason.trim() },
      });
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("worksContracts.saveFailed"));
    }
  }

  return (
    <div className="grid gap-[16px] lg:grid-cols-2">
      <Card className="p-[14px_16px]">
        <h3 className="mb-[4px] text-[12.5px] font-bold text-ink">{t("worksContracts.budget.title")}</h3>
        <p className="mb-[10px] text-[11.5px] text-ink-muted">{t("worksContracts.budget.hint")}</p>
        {error ? <p className="mb-[10px] text-[12.5px] font-semibold text-danger-ink">{error}</p> : null}
        <TextField label={t("worksContracts.field.estimatedTotalCost")} value={value} onChange={setValue} disabled={!mayManage} />
        <div className="mt-[10px]">
          <TextField label={t("worksContracts.budget.reason")} value={reason} onChange={setReason} disabled={!mayManage} />
        </div>
        {mayManage ? (
          <Button className="mt-[12px]" variant="primary" onClick={() => void save()} disabled={update.isPending}>
            {t("worksContracts.budget.save")}
          </Button>
        ) : null}
      </Card>
      <Card className="p-[14px_16px]">
        <h3 className="mb-[8px] text-[12.5px] font-bold text-ink">{t("worksContracts.budget.revisions")}</h3>
        {contract.budgetRevisions.length === 0 ? (
          <p className="text-[12px] text-ink-muted">{t("worksContracts.budget.noRevisions")}</p>
        ) : (
          contract.budgetRevisions.map((r, i) => (
            <div key={`${r.date}-${i}`} className="border-b border-border py-[8px] last:border-b-0">
              <div className="flex items-baseline justify-between gap-[8px]">
                <span className="mz-num text-[12px] text-ink-muted">{r.date}</span>
                <span className="text-[12.5px] font-semibold text-ink">
                  <MoneyValue value={majorOf(r.previousValue)} showUnit={false} /> ← <MoneyValue value={majorOf(r.newValue)} showUnit={false} />
                </span>
              </div>
              <p className="mt-[3px] text-[11.5px] text-ink-muted">{r.reason} · {r.userId}</p>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

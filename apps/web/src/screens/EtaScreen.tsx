import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentList,
  EmptyState,
  EntityPicker,
  Field,
  RowMenu,
  Select,
  StatusPill,
  Switch,
  TextInput,
  type DocumentListColumn,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import type {
  EtaBranchCodeRowDTO,
  EtaConfigDTO,
  EtaDocumentTypeDTO,
  EtaItemMappingRowDTO,
  EtaSubmissionDTO,
  EtaSubmissionStatusDTO,
  EtaTaxSubTypeRowDTO,
  EtaUnitMappingRowDTO,
} from "@mezan/contracts";
import {
  useApplyEtaUnitSuggestions,
  useEtaActivityCodes,
  useEtaBranchCodes,
  useEtaConfig,
  useEtaItemMappings,
  useEtaSubmissions,
  useEtaTaxSubTypes,
  useEtaUnitCodes,
  useEtaUnitMappings,
  useExcludeEtaSubmission,
  useSaveEtaBranchCode,
  useSaveEtaItemMapping,
  useSaveEtaUnitMapping,
  useSubmitAllReadyEta,
  useSubmitEtaSubmission,
  useTestEtaConnection,
  useUpdateEtaConfig,
} from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";

const STATUS_TONE: Record<EtaSubmissionStatusDTO, PillTone> = {
  ready: "info",
  pending_signature: "warning",
  submitted: "info",
  accepted: "success",
  error: "danger",
  excluded: "neutral",
};

const STATUS_KEYS: Record<EtaSubmissionStatusDTO, AppTranslationKey> = {
  ready: "eta.statusReady",
  pending_signature: "eta.statusPendingSignature",
  submitted: "eta.statusSubmitted",
  accepted: "eta.statusAccepted",
  error: "eta.statusError",
  excluded: "eta.statusExcluded",
};

const TYPE_KEYS: Record<EtaDocumentTypeDTO, AppTranslationKey> = {
  invoice: "eta.typeInvoice",
  credit_note: "eta.typeCreditNote",
  debit_note: "eta.typeDebitNote",
};

const READINESS_KEYS: Record<string, AppTranslationKey> = {
  taxRegistrationNumber: "eta.taxRegistrationNumber",
  activityCode: "eta.activityCode",
  address: "eta.readinessAddress",
  branchCodes: "eta.branchCodes",
  itemCodes: "eta.readinessItemCodes",
  unitMappings: "eta.tabUnits",
  taxSubTypes: "eta.taxSubTypes",
  clientId: "eta.clientId",
  clientSecret: "eta.clientSecret",
};

const STATUS_TABS: Array<EtaSubmissionStatusDTO | "all"> = ["all", "ready", "pending_signature", "submitted", "accepted", "error", "excluded"];

const PAGE_SIZES = [10, 25, 50, 100] as const;

type EtaTab = "general" | "credentials" | "items" | "units" | "submissions";
const TABS: Array<{ id: EtaTab; labelKey: AppTranslationKey }> = [
  { id: "general", labelKey: "eta.tabGeneral" },
  { id: "credentials", labelKey: "eta.tabCredentials" },
  { id: "items", labelKey: "eta.tabItems" },
  { id: "units", labelKey: "eta.tabUnits" },
  { id: "submissions", labelKey: "eta.tabSubmissions" },
];

/**
 * الفاتورة الإلكترونية (ETA) — e-invoicing (docs/archive/catalog/04). The readiness
 * meter over the five registration prerequisites, then a tab per surface:
 * عام (company registration + auto-send), بيانات الربط (credentials and the
 * connection test), ربط الأصناف, ربط الوحدات, and الإرسالات — the submission
 * queue whose lifecycle is جاهز → بانتظار التوقيع → مرسل → مقبول, plus
 * أخطاء/مستبعد. All on the real `/eta/*` routes; the online transmit is
 * STUBBED server-side, so submitting offline keeps the document queued (202).
 */
export function EtaScreen() {
  const { t } = useAppTranslation();
  const [tab, setTab] = useState<EtaTab>("general");
  const configQuery = useEtaConfig();
  const submissionsQuery = useEtaSubmissions();

  const config = configQuery.data?.config ?? null;
  const readiness = configQuery.data?.readiness ?? null;

  if (configQuery.isError || submissionsQuery.isError) {
    return (
      <Card className="p-[18px_20px]">
        <p className="text-[13px] font-semibold text-danger-ink">{t("eta.eInvoicingDataCouldNot")}</p>
        <Button size="sm" className="mt-[10px]" onClick={() => { void configQuery.refetch(); void submissionsQuery.refetch(); }}>
          {t("common.retry")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-[16px] flex flex-wrap items-end justify-between gap-[18px]">
        <div>
          <h1 className="mt-[5px] font-display text-2xl font-bold text-ink">{t("eta.eInvoicing")}</h1>
          <p className="mt-[5px] max-w-[70ch] text-[12.5px] text-ink-muted">{t("eta.theQueueOfConfirmedDocuments")}</p>
        </div>
        {config ? (
          <StatusPill
            label={config.environment === "production" ? t("eta.envProduction") : t("eta.envPreproduction")}
            tone={config.environment === "production" ? "success" : "warning"}
          />
        ) : null}
      </div>

      {readiness ? (
        <Card className="mb-[16px] p-[16px_18px]">
          <div className="text-[13px] font-semibold text-ink">
            {t("eta.readiness")} <span className="mz-num">{readiness.percent}%</span>
          </div>
          <div className="mt-[10px] flex flex-wrap gap-[8px]">
            {readiness.items.map((item) => {
              const label = READINESS_KEYS[item.key] ? t(READINESS_KEYS[item.key]!) : item.labelAr;
              return (
                <StatusPill
                  key={item.key}
                  label={item.complete ? label : `${label} (${item.missing})`}
                  tone={item.complete ? "success" : "warning"}
                />
              );
            })}
          </div>
        </Card>
      ) : null}

      <div role="tablist" className="mb-[14px] flex flex-wrap gap-1 border-b border-border">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`-mb-px border-b-2 px-3 py-[9px] text-[12.5px] font-semibold transition-colors ${tab === entry.id ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      {tab === "general" ? <GeneralTab config={config} /> : null}
      {tab === "credentials" ? <CredentialsTab config={config} /> : null}
      {tab === "items" ? <ItemMappingTab /> : null}
      {tab === "units" ? <UnitMappingTab /> : null}
      {tab === "submissions" ? <SubmissionsTab statusKeys={STATUS_KEYS} /> : null}
    </div>
  );
}

function GeneralTab({ config }: { config: EtaConfigDTO | null }) {
  const { t, locale } = useAppTranslation();
  const activityCodes = useEtaActivityCodes();
  const taxSubTypes = useEtaTaxSubTypes();
  const update = useUpdateEtaConfig();
  const [form, setForm] = useState({
    environment: "preproduction" as EtaConfigDTO["environment"],
    taxRegistrationNumber: "",
    activityCode: "",
    governorate: "",
    city: "",
    street: "",
    buildingNumber: "",
    postalCode: "",
    buyerDataThreshold: "25000",
    documentVersion: "1.0" as EtaConfigDTO["documentVersion"],
    autoSubmitOnConfirm: true,
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!config) return;
    setForm({
      environment: config.environment,
      taxRegistrationNumber: config.taxRegistrationNumber ?? "",
      activityCode: config.activityCode ?? "",
      governorate: config.address?.governorate ?? "",
      city: config.address?.city ?? "",
      street: config.address?.street ?? "",
      buildingNumber: config.address?.buildingNumber ?? "",
      postalCode: config.address?.postalCode ?? "",
      buyerDataThreshold: String(config.buyerDataThreshold),
      documentVersion: config.documentVersion,
      autoSubmitOnConfirm: config.autoSubmitOnConfirm,
    });
  }, [config]);

  const activityOptions = (activityCodes.data ?? []).map((a) => ({
    id: a.code,
    label: `${a.code} — ${locale === "ar" ? a.labelAr : a.labelEn}`,
    sublabel: locale === "ar" ? a.labelEn : a.labelAr,
  }));
  const selectedActivity = activityOptions.find((o) => o.id === form.activityCode) ?? null;
  const addressComplete = form.governorate.trim() !== "" && form.city.trim() !== "" && form.street.trim() !== "" && form.buildingNumber.trim() !== "";

  async function save() {
    setSaved(false);
    await update.mutateAsync({
      environment: form.environment,
      taxRegistrationNumber: form.taxRegistrationNumber.trim() || null,
      activityCode: form.activityCode.trim() || null,
      address: addressComplete
        ? {
            governorate: form.governorate.trim(),
            city: form.city.trim(),
            street: form.street.trim(),
            buildingNumber: form.buildingNumber.trim(),
            postalCode: form.postalCode.trim() || null,
          }
        : null,
      buyerDataThreshold: Number(form.buyerDataThreshold) || 0,
      documentVersion: form.documentVersion,
      autoSubmitOnConfirm: form.autoSubmitOnConfirm,
    });
    setSaved(true);
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <Card className="p-[16px_18px]">
        <div className="grid gap-[14px] md:grid-cols-2">
          <Field label={t("eta.environment")}>
            <Select
              value={form.environment}
              onChange={(value) => setForm((f) => ({ ...f, environment: value as EtaConfigDTO["environment"] }))}
              options={[
                { value: "preproduction", label: t("eta.envPreproduction") },
                { value: "production", label: t("eta.envProduction") },
              ]}
            />
          </Field>
          <Field label={t("eta.activityCode")} hint={t("eta.activityCodeHint")} required>
            <EntityPicker
              value={selectedActivity}
              options={activityOptions}
              placeholder={t("eta.activityCodeSearch")}
              onChange={(option) => setForm((f) => ({ ...f, activityCode: option?.id ?? "" }))}
            />
          </Field>
          <Field label={t("eta.taxRegistrationNumber")} required htmlFor="eta-trn">
            <TextInput
              id="eta-trn"
              value={form.taxRegistrationNumber}
              onChange={(e) => setForm((f) => ({ ...f, taxRegistrationNumber: e.target.value }))}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-[16px_18px]">
        <div className="mb-[12px] text-[13px] font-semibold text-ink">{t("eta.addressSection")}</div>
        <div className="grid gap-[14px] md:grid-cols-2">
          <Field label={t("eta.governorate")} required htmlFor="eta-gov">
            <TextInput id="eta-gov" value={form.governorate} onChange={(e) => setForm((f) => ({ ...f, governorate: e.target.value }))} />
          </Field>
          <Field label={t("eta.city")} required htmlFor="eta-city">
            <TextInput id="eta-city" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
          </Field>
          <Field label={t("eta.street")} required htmlFor="eta-street">
            <TextInput id="eta-street" value={form.street} onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))} />
          </Field>
          <Field label={t("eta.buildingNumber")} required htmlFor="eta-building">
            <TextInput id="eta-building" value={form.buildingNumber} onChange={(e) => setForm((f) => ({ ...f, buildingNumber: e.target.value }))} />
          </Field>
          <Field label={t("eta.postalCode")} hint={t("eta.postalCodeHint")} htmlFor="eta-postal">
            <TextInput id="eta-postal" value={form.postalCode} onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} />
          </Field>
        </div>
      </Card>

      <Card className="p-[16px_18px]">
        <div className="grid gap-[14px] md:grid-cols-2">
          <Field label={t("eta.buyerDataThreshold")} hint={t("eta.buyerDataThresholdHint")} htmlFor="eta-threshold">
            <TextInput
              id="eta-threshold"
              inputMode="numeric"
              className="mz-num"
              value={form.buyerDataThreshold}
              onChange={(e) => setForm((f) => ({ ...f, buyerDataThreshold: e.target.value.replace(/[^0-9]/g, "") }))}
            />
          </Field>
          <Field label={t("eta.documentVersion")}>
            <Select
              value={form.documentVersion}
              onChange={(value) => setForm((f) => ({ ...f, documentVersion: value as EtaConfigDTO["documentVersion"] }))}
              options={[
                { value: "0.9", label: t("eta.documentVersion09") },
                { value: "1.0", label: t("eta.documentVersion10") },
              ]}
            />
          </Field>
        </div>
        <div className="mt-[16px] flex items-start justify-between gap-[16px] border-t border-border pt-[14px]">
          <div>
            <div className="text-[13px] font-semibold text-ink">{t("eta.autoSubmit")}</div>
            <p className="mt-[4px] text-[12px] text-ink-muted">{t("eta.autoSubmitHint")}</p>
          </div>
          <Switch
            checked={form.autoSubmitOnConfirm}
            onChange={(checked) => setForm((f) => ({ ...f, autoSubmitOnConfirm: checked }))}
            label={t("eta.autoSubmit")}
          />
        </div>
        <div className="mt-[16px] flex items-center gap-[10px]">
          <Button variant="primary" onClick={save} disabled={update.isPending}>{t("common.save")}</Button>
          {saved ? <span role="status" className="text-[12.5px] text-success-ink">{t("eta.settingsSaved")}</span> : null}
        </div>
      </Card>

      <BranchCodesCard />

      <Card className="p-[16px_18px]">
        <div className="text-[13px] font-semibold text-ink">{t("eta.taxSubTypes")}</div>
        <p className="mt-[4px] text-[12px] text-ink-muted">{t("eta.taxSubTypesHint")}</p>
        <table className="mt-[12px] w-full text-[12.5px]">
          <thead>
            <tr className="text-ink-faint">
              <th className="p-[6px_8px] text-start font-semibold">{t("eta.taxRate")}</th>
              <th className="p-[6px_8px] text-start font-semibold">{t("eta.subType")}</th>
            </tr>
          </thead>
          <tbody>
            {(taxSubTypes.data ?? []).map((row: EtaTaxSubTypeRowDTO) => (
              <tr key={row.taxRateId} className="border-t border-border">
                <td className="p-[8px]">{row.name} <span className="mz-num text-ink-muted">({row.rate}%)</span></td>
                <td className="p-[8px]">
                  {row.resolved
                    ? <span className="mz-num">{row.etaSubType}</span>
                    : <StatusPill label={t("eta.subTypeAuto")} tone="warning" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function BranchCodesCard() {
  const { t } = useAppTranslation();
  const branchCodes = useEtaBranchCodes();
  const save = useSaveEtaBranchCode();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  const rows = branchCodes.data ?? [];
  const valueOf = (row: EtaBranchCodeRowDTO) => drafts[row.branchId] ?? row.etaBranchCode ?? "";

  async function saveRow(row: EtaBranchCodeRowDTO) {
    const value = valueOf(row).trim();
    if (value === "" || pendingId !== null) return;
    setPendingId(row.branchId);
    try {
      await save.mutateAsync({ branchId: row.branchId, body: { etaBranchCode: value } });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card className="p-[16px_18px]">
      <div className="text-[13px] font-semibold text-ink">{t("eta.branchCodes")}</div>
      <p className="mt-[4px] text-[12px] text-ink-muted">{t("eta.branchCodesHint")}</p>
      <table className="mt-[12px] w-full text-[12.5px]">
        <thead>
          <tr className="text-ink-faint">
            <th className="p-[6px_8px] text-start font-semibold">{t("eta.branch")}</th>
            <th className="p-[6px_8px] text-start font-semibold">{t("eta.etaBranchCode")}</th>
            <th className="p-[6px_8px]" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.branchId} className="border-t border-border">
              <td className="p-[8px]">
                {row.branchName} <span className="mz-num text-ink-muted">({row.branchCode})</span>
              </td>
              <td className="p-[8px]">
                <TextInput
                  size="sm"
                  className="mz-num max-w-[160px]"
                  aria-label={`${t("eta.etaBranchCode")} — ${row.branchName}`}
                  value={valueOf(row)}
                  onChange={(e) => setDrafts((d) => ({ ...d, [row.branchId]: e.target.value }))}
                />
              </td>
              <td className="p-[8px] text-end">
                <Button size="sm" onClick={() => saveRow(row)} disabled={pendingId === row.branchId}>
                  {t("common.save")}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CredentialsTab({ config }: { config: EtaConfigDTO | null }) {
  const { t } = useAppTranslation();
  const update = useUpdateEtaConfig();
  const test = useTestEtaConnection();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingMethod, setSigningMethod] = useState<EtaConfigDTO["signingMethod"]>("none");
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    setClientId(config.clientId ?? "");
    setSigningMethod(config.signingMethod);
  }, [config]);

  async function save() {
    setSaved(false);
    await update.mutateAsync({
      clientId: clientId.trim() || null,
      signingMethod,
      ...(clientSecret.trim() === "" ? {} : { clientSecret: clientSecret.trim() }),
    });
    setClientSecret("");
    setSaved(true);
  }

  async function runTest() {
    const result = await test.mutateAsync();
    setTestResult(result.reason === "missing_credentials" ? t("eta.testMissingCredentials") : t("eta.testOffline"));
  }

  return (
    <Card className="p-[16px_18px]">
      <div className="grid gap-[14px] md:grid-cols-2">
        <Field label={t("eta.clientId")} htmlFor="eta-client-id">
          <TextInput id="eta-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
        </Field>
        <Field
          label={t("eta.clientSecret")}
          hint={config?.hasClientSecret ? t("eta.clientSecretStored") : undefined}
          htmlFor="eta-client-secret"
        >
          <TextInput
            id="eta-client-secret"
            type="password"
            autoComplete="new-password"
            placeholder={config?.hasClientSecret ? t("eta.clientSecretPlaceholder") : undefined}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </Field>
        <Field label={t("eta.signingMethod")}>
          <Select
            value={signingMethod}
            onChange={(value) => setSigningMethod(value as EtaConfigDTO["signingMethod"])}
            options={[
              { value: "none", label: t("eta.signingNone") },
              { value: "eseal", label: t("eta.signingEseal") },
            ]}
          />
        </Field>
      </div>
      <div className="mt-[16px] flex flex-wrap items-center gap-[10px]">
        <Button variant="primary" onClick={save} disabled={update.isPending}>{t("common.save")}</Button>
        <Button onClick={runTest} disabled={test.isPending}>{t("eta.testConnection")}</Button>
        {saved ? <span role="status" className="text-[12.5px] text-success-ink">{t("eta.settingsSaved")}</span> : null}
      </div>
      {testResult ? (
        <div role="status" className="mt-[12px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {testResult}
        </div>
      ) : null}
    </Card>
  );
}

function ItemMappingTab() {
  const { t, locale } = useAppTranslation();
  const [search, setSearch] = useState("");
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const mappings = useEtaItemMappings({ q: search, unmappedOnly });
  const save = useSaveEtaItemMapping();
  const [drafts, setDrafts] = useState<Record<string, { etaCodeType: string; etaItemCode: string; gpcCode: string }>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const rows = mappings.data?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  const activeFilterCount = unmappedOnly ? 1 : 0;
  const draftOf = (row: EtaItemMappingRowDTO) =>
    drafts[row.itemId] ?? {
      etaCodeType: row.etaCodeType ?? "EGS",
      etaItemCode: row.etaItemCode ?? "",
      gpcCode: row.gpcCode ?? "",
    };

  function patch(row: EtaItemMappingRowDTO, change: Partial<{ etaCodeType: string; etaItemCode: string; gpcCode: string }>) {
    setDrafts((d) => ({ ...d, [row.itemId]: { ...draftOf(row), ...change } }));
  }

  async function saveRow(row: EtaItemMappingRowDTO) {
    if (pendingId !== null) return;
    const draft = draftOf(row);
    setPendingId(row.itemId);
    try {
      await save.mutateAsync({
        itemId: row.itemId,
        body: {
          etaCodeType: draft.etaCodeType === "GPC" ? "GPC" : "EGS",
          etaItemCode: draft.etaItemCode.trim() || null,
          gpcCode: draft.gpcCode.trim() || null,
        },
      });
    } finally {
      setPendingId(null);
    }
  }

  const columns: DocumentListColumn<EtaItemMappingRowDTO>[] = [
    { key: "code", header: t("eta.itemCodeColumn"), render: (row) => <span className="mz-num font-semibold text-ink">{row.code}</span> },
    { key: "name", header: t("eta.itemName"), render: (row) => <span className="text-ink-muted">{locale === "ar" ? row.nameAr : row.nameEn ?? row.nameAr}</span> },
    {
      key: "codeType",
      header: t("eta.codeType"),
      render: (row) => (
        <Select
          size="sm"
          className="min-w-[110px]"
          aria-label={`${t("eta.codeType")} — ${row.code}`}
          value={draftOf(row).etaCodeType}
          onChange={(value) => patch(row, { etaCodeType: value })}
          options={[
            { value: "EGS", label: "EGS" },
            { value: "GPC", label: "GPC" },
          ]}
        />
      ),
    },
    {
      key: "etaItemCode",
      header: t("eta.authorityItemCode"),
      render: (row) => (
        <TextInput
          size="sm"
          className="mz-num min-w-[180px]"
          aria-label={`${t("eta.authorityItemCode")} — ${row.code}`}
          value={draftOf(row).etaItemCode}
          onChange={(e) => patch(row, { etaItemCode: e.target.value })}
        />
      ),
    },
    {
      key: "gpcCode",
      header: t("eta.gpcCode"),
      render: (row) => (
        <TextInput
          size="sm"
          className="mz-num min-w-[130px]"
          aria-label={`${t("eta.gpcCode")} — ${row.code}`}
          value={draftOf(row).gpcCode}
          onChange={(e) => patch(row, { gpcCode: e.target.value })}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveRow(row)} disabled={pendingId === row.itemId}>{t("common.save")}</Button>
        </div>
      ),
    },
  ];

  return (
    <DocumentList<EtaItemMappingRowDTO>
      title=""
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value);
        setPage(1);
      }}
      searchPlaceholder={t("eta.searchItems")}
      filterBarCollapsible
      activeFilterCount={activeFilterCount}
      filterBarExtra={
        <Chip
          active={unmappedOnly}
          onClick={() => {
            setUnmappedOnly((v) => !v);
            setPage(1);
          }}
        >
          {t("eta.unmappedOnly")} ({mappings.data?.unmapped ?? 0})
        </Chip>
      }
      columns={columns}
      rows={pageRows}
      loading={mappings.isLoading}
      rowKey={(row) => row.itemId}
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      pageSize={pageSize}
      pageSizeOptions={PAGE_SIZES}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{mappings.data?.total ?? 0}</span> {t("eta.items")}</>}
      emptyState={<EmptyState title={t("eta.noMatchingItems")} description={t("eta.emptyBody")} />}
    />
  );
}

function UnitMappingTab() {
  const { t, locale } = useAppTranslation();
  const unitMappings = useEtaUnitMappings();
  const unitCodes = useEtaUnitCodes();
  const save = useSaveEtaUnitMapping();
  const applySuggestions = useApplyEtaUnitSuggestions();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ applied: number; unresolved: number } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const rows = unitMappings.data ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  const options = (unitCodes.data ?? []).map((u) => ({ value: u.code, label: `${u.code} — ${locale === "ar" ? u.labelAr : u.labelEn}` }));
  const valueOf = (row: EtaUnitMappingRowDTO) => drafts[row.unitCode] ?? row.etaUnitCode ?? "";

  async function saveRow(row: EtaUnitMappingRowDTO) {
    const value = valueOf(row);
    if (value === "" || pendingCode !== null) return;
    setPendingCode(row.unitCode);
    try {
      await save.mutateAsync({ unitCode: row.unitCode, body: { etaUnitCode: value } });
      setDrafts((d) => {
        const next = { ...d };
        delete next[row.unitCode];
        return next;
      });
    } finally {
      setPendingCode(null);
    }
  }

  async function applyAll() {
    const result = await applySuggestions.mutateAsync();
    setDrafts({});
    setNotice({ applied: result.applied.length, unresolved: result.unresolved.length });
  }

  const columns: DocumentListColumn<EtaUnitMappingRowDTO>[] = [
    { key: "code", header: t("eta.unitCodeColumn"), render: (row) => <span className="mz-num font-semibold text-ink">{row.unitCode}</span> },
    { key: "name", header: t("eta.unitName"), render: (row) => <span className="text-ink-muted">{locale === "ar" ? row.nameAr : row.nameEn ?? row.nameAr}</span> },
    {
      key: "etaUnitCode",
      header: t("eta.etaUnitCode"),
      render: (row) => (
        <Select
          size="sm"
          className="min-w-[190px]"
          aria-label={`${t("eta.etaUnitCode")} — ${row.unitCode}`}
          value={valueOf(row)}
          placeholder={t("eta.notMapped")}
          onChange={(value) => setDrafts((d) => ({ ...d, [row.unitCode]: value }))}
          options={options}
        />
      ),
    },
    {
      key: "suggestion",
      header: t("eta.suggestion"),
      render: (row) => <span className="mz-num text-ink-muted">{row.suggestion ?? "—"}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveRow(row)} disabled={pendingCode === row.unitCode}>{t("common.save")}</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-[12px] flex justify-end">
        <Button variant="primary" onClick={applyAll} disabled={applySuggestions.isPending}>{t("eta.applySuggestions")}</Button>
      </div>
      {notice ? (
        <div role="status" className="mb-[12px] rounded-md border border-border bg-surface px-[12px] py-[10px] text-[12.5px] text-ink">
          {t("eta.suggestionsApplied", { count: String(notice.applied), unresolved: String(notice.unresolved) })}
        </div>
      ) : null}
      <DocumentList<EtaUnitMappingRowDTO>
        title=""
        columns={columns}
        rows={pageRows}
        loading={unitCodes.isLoading}
        rowKey={(row) => row.unitCode}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{rows.length}</span></>}
        emptyState={<EmptyState title={t("eta.noUnits")} description={t("eta.emptyBody")} />}
      />
    </div>
  );
}

function SubmissionsTab({ statusKeys }: { statusKeys: Record<EtaSubmissionStatusDTO, AppTranslationKey> }) {
  const { t } = useAppTranslation();
  const submissionsQuery = useEtaSubmissions();
  const [statusFilter, setStatusFilter] = useState<EtaSubmissionStatusDTO | "all">("all");
  const submitOneMutation = useSubmitEtaSubmission();
  const submitAllMutation = useSubmitAllReadyEta();
  const excludeMutation = useExcludeEtaSubmission();
  const [notice, setNotice] = useState<{ kind: "offline" } | { kind: "queued"; count: number } | null>(null);
  const [excludingId, setExcludingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const allSubs = submissionsQuery.data ?? [];
  const filtered = statusFilter === "all" ? allSubs : allSubs.filter((s) => s.status === statusFilter);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  const activeFilterCount = statusFilter === "all" ? 0 : 1;
  const countBy = (status: EtaSubmissionStatusDTO) => allSubs.filter((s) => s.status === status).length;
  const actionable = (status: EtaSubmissionStatusDTO) => status === "ready" || status === "pending_signature" || status === "error";

  async function submitOne(id: string) {
    if (pendingId !== null) return;
    setNotice(null);
    setActionError(null);
    setPendingId(id);
    try {
      const result = await submitOneMutation.mutateAsync(id);
      if (result.queuedOffline) setNotice({ kind: "offline" });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("api.thatActionCouldNotBe"));
    } finally {
      setPendingId(null);
    }
  }

  async function submitAll() {
    setNotice(null);
    const result = await submitAllMutation.mutateAsync();
    if (result.queued.length > 0) setNotice({ kind: "queued", count: result.queued.length });
  }

  async function confirmExclude() {
    if (!excludingId || reason.trim() === "") return;
    setActionError(null);
    try {
      await excludeMutation.mutateAsync({ id: excludingId, body: { reason: reason.trim() } });
      setExcludingId(null);
      setReason("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("api.thatActionCouldNotBe"));
    }
  }

  const columns: DocumentListColumn<EtaSubmissionDTO>[] = [
    { key: "internal", header: t("eta.internalId"), render: (s) => <span className="mz-num font-semibold text-ink">{s.internalId}</span> },
    { key: "type", header: t("common.type"), render: (s) => <span className="text-ink-muted">{t(TYPE_KEYS[s.documentType])}</span> },
    { key: "status", header: t("common.status"), render: (s) => <StatusPill label={t(statusKeys[s.status])} tone={STATUS_TONE[s.status]} /> },
    { key: "uuid", header: t("eta.authorityId"), render: (s) => <span className="mz-num text-ink-muted">{s.etaUuid ?? "—"}</span> },
    { key: "errors", header: t("eta.errors"), render: (s) => <span className="text-danger-ink">{s.errors.length > 0 ? s.errors.join(t("dataMigration.reasonSeparator")) : "—"}</span> },
  ];

  return (
    <div>
      <div className="mb-[12px] flex justify-end">
        <Button variant="primary" onClick={submitAll} disabled={submitAllMutation.isPending}>{t("eta.submitEverythingReady")}</Button>
      </div>

      {notice ? (
        <div role="status" className="mb-[14px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {notice.kind === "offline" ? t("eta.actualSubmissionNeedsALive") : t("eta.queuedNotice", { count: String(notice.count) })}
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="mb-[14px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {actionError}
        </div>
      ) : null}

      {excludingId ? (
        <div className="mb-[14px] rounded-lg border border-border bg-surface p-[14px_16px]">
          <div className="mb-[8px] text-[12.5px] font-semibold text-ink">{t("eta.reasonForExclusionRequired")}</div>
          <div className="flex flex-wrap items-center gap-[8px]">
            <TextInput size="sm" className="min-w-[260px] flex-1" aria-label={t("eta.reasonForExclusion")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("eta.giveTheReasonForExcluding")} />
            <Button variant="primary" onClick={confirmExclude}>{t("eta.confirmExclusion")}</Button>
            <Button onClick={() => setExcludingId(null)}>{t("common.cancel")}</Button>
          </div>
        </div>
      ) : null}

      <DocumentList<EtaSubmissionDTO>
        title=""
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap gap-[8px]">
            {STATUS_TABS.map((tab) => (
              <Chip
                key={tab}
                active={statusFilter === tab}
                onClick={() => {
                  setStatusFilter(tab);
                  setPage(1);
                }}
              >
                {tab === "all" ? t("eta.tabAll", { count: String(allSubs.length) }) : t("eta.tabCount", { label: t(statusKeys[tab]), count: String(countBy(tab)) })}
              </Chip>
            ))}
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={submissionsQuery.isLoading}
        rowKey={(s) => s.id}
        rowAction={(s) => {
          if (!actionable(s.status)) return null;
          const items: RowMenuItem[] = [
            {
              key: "submit",
              label: t("eta.submit"),
              disabled: pendingId === s.id,
              onSelect: () => void submitOne(s.id),
            },
            {
              key: "exclude",
              label: t("eta.exclude"),
              tone: "danger",
              disabled: pendingId === s.id,
              // Exclusion needs a reason the row cannot supply — the menu opens the form that collects it.
              onSelect: () => {
                setActionError(null);
                setExcludingId(s.id);
                setReason("");
              },
            },
          ];
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: s.internalId })} />;
        }}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={<>{t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")} <span className="mz-num">{allSubs.length}</span> {t("eta.documents")}</>}
        emptyState={<EmptyState title={t("eta.noDocumentsInThisState")} />}
      />
    </div>
  );
}

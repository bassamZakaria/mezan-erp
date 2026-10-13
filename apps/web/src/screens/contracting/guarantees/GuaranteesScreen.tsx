import { ReversalDocumentType } from "@mezan/contracts";
import { useReverseDocumentAction } from "../../../reversal/ReverseDocumentAction";
import { useMemo, useState } from "react";
import {
  Button,
  Card,
  DocumentDetail,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyValue,
  MoneyInput,
  RowMenu,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type PillTone,
  type RowMenuItem,
} from "@mezan/ui";
import { can, createAuthContext } from "@mezan/domain";
import type { GuaranteeDTO, GuaranteeKindDTO, GuaranteeStatusDTO } from "@mezan/contracts";
import { useApi } from "../../../data/ApiContext";
import { useProjects, useTreasuryAccounts } from "../../../data/hooks";
import {
  useCallGuarantee,
  useCreateGuarantee,
  useGuaranteeContractOptions,
  useGuaranteeSummary,
  useGuarantees,
  useIssueGuarantee,
  useReduceGuarantee,
  useReleaseGuarantee,
} from "../../../data/contracting-guarantees-hooks";
import { FormColumns, FormError, FormPage, SectionCard, SelectField, TextField } from "../../../settings/form-controls";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useSubPage } from "../../../navigation";
import { majorOf } from "../../../lib/money";
import { useUrlParam, useUrlSearch } from "../../../lib/url-state";
import { EMPTY } from "../../../lib/empty";

/**
 * خطابات الضمان (design §05) — the register, its bank-facility tiles, the
 * `/new` page and the `/:docNo` document page with the four status moves.
 *
 * The four tiles are the summary endpoint's own figures, which are derived
 * from posted documents; nothing on this screen adds money up in the browser.
 */

const VIEW_PERMISSION = "treasury.cash_voucher.view";
const WRITE_PERMISSION = "treasury.cash_voucher.create";

const KIND_KEY: Record<GuaranteeKindDTO, AppTranslationKey> = {
  bid: "guarantees.kind.bid",
  performance: "guarantees.kind.performance",
  advance: "guarantees.kind.advance",
  maintenance: "guarantees.kind.maintenance",
};

const STATUS_KEY: Record<GuaranteeStatusDTO, AppTranslationKey> = {
  draft: "guarantees.status.draft",
  active: "guarantees.status.active",
  reduced: "guarantees.status.reduced",
  released: "guarantees.status.released",
  called: "guarantees.status.called",
  expired: "guarantees.status.expired",
};

const STATUS_TONE: Record<GuaranteeStatusDTO, PillTone> = {
  draft: "neutral",
  active: "success",
  reduced: "info",
  released: "neutral",
  called: "danger",
  expired: "warning",
};

const KINDS: GuaranteeKindDTO[] = ["bid", "performance", "advance", "maintenance"];
const STATUSES: GuaranteeStatusDTO[] = ["draft", "active", "reduced", "expired", "released", "called"];
const PAGE_SIZES = [10, 25, 50, 100] as const;
const NO_PROJECT_ID = "__none__";
const NO_CONTRACT_ID = "__none__";

interface Draft {
  id: string;
  kind: GuaranteeKindDTO;
  projectId: string | null;
  contractId: string | null;
  tenderRef: string;
  beneficiaryNameAr: string;
  bankTreasuryAccountId: string | null;
  faceValue: number | null;
  percentOfContract: string;
  cashMarginPercent: string;
  cashMarginAmount: number | null;
  issueDate: string;
  expiryDate: string;
  notes: string;
}

function blankDraft(): Draft {
  return {
    id: `LG-${Date.now()}`,
    kind: "performance",
    projectId: null,
    contractId: null,
    tenderRef: "",
    beneficiaryNameAr: "",
    bankTreasuryAccountId: null,
    faceValue: null,
    percentOfContract: "",
    cashMarginPercent: "20",
    cashMarginAmount: null,
    issueDate: "",
    expiryDate: "",
    notes: "",
  };
}

function toMoneyString(value: number | null): string {
  return value === null ? "0" : value.toFixed(2);
}

export function GuaranteesScreen() {
  const reversal = useReverseDocumentAction(ReversalDocumentType.LetterOfGuarantee);
  const { t } = useAppTranslation();
  const format = useFormat();
  const { session } = useApi();
  const subPage = useSubPage();
  const [firstSegment] = subPage.segments;

  const authContext = createAuthContext({
    userId: session?.userId ?? "anonymous",
    permissions: session?.permissions ?? [],
    branchScope: "*",
    warehouseScope: "*",
  });
  const mayView = can(authContext, VIEW_PERMISSION);
  const mayWrite = can(authContext, WRITE_PERMISSION);

  const [statusFilter, setStatusFilter] = useUrlParam("status", "all");
  const [projectFilter, setProjectFilter] = useUrlParam("project", "all");
  const [searchText, setSearchText, search] = useUrlSearch();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const listQuery = useGuarantees();
  const summaryQuery = useGuaranteeSummary();
  const projectsQuery = useProjects();
  const treasuryQuery = useTreasuryAccounts();
  const contractOptions = useGuaranteeContractOptions();

  const createGuarantee = useCreateGuarantee();
  const issueGuarantee = useIssueGuarantee();
  const reduceGuarantee = useReduceGuarantee();
  const releaseGuarantee = useReleaseGuarantee();
  const callGuarantee = useCallGuarantee();

  const rows = listQuery.data ?? (EMPTY as GuaranteeDTO[]);
  const summary = summaryQuery.data ?? null;
  const projects = projectsQuery.data ?? EMPTY;
  const banks = useMemo(
    () => (treasuryQuery.data ?? []).filter((a) => a.type === "bank" && a.status === "active"),
    [treasuryQuery.data],
  );

  const [draft, setDraft] = useState<Draft>(blankDraft());
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Which letter an action is running on — never a list-wide pending flag. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reduceAmount, setReduceAmount] = useState<number | null>(null);
  const [reduceReason, setReduceReason] = useState("");
  const [actionDate, setActionDate] = useState("");
  const [chargeAccountId, setChargeAccountId] = useState("");

  function projectName(projectId: string | null): string {
    if (projectId === null) return t("guarantees.noProject");
    return projects.find((p) => p.id === projectId)?.nameAr ?? projectId;
  }

  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter !== "all") out = out.filter((g) => g.derivedStatus === statusFilter);
    if (projectFilter !== "all") out = out.filter((g) => (g.projectId ?? NO_PROJECT_ID) === projectFilter);
    const q = search.trim().toLowerCase();
    if (q !== "") {
      out = out.filter((g) =>
        [g.docNo, g.beneficiaryNameAr, g.bankNameAr, g.tenderRef, g.contractId]
          .filter((v): v is string => typeof v === "string")
          .some((v) => v.toLowerCase().includes(q)),
      );
    }
    return out;
  }, [rows, statusFilter, projectFilter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const selected = firstSegment && firstSegment !== "new" ? rows.find((g) => g.docNo === firstSegment || g.id === firstSegment) ?? null : null;

  const projectOptions: EntityPickerOption[] = [
    { id: NO_PROJECT_ID, label: t("guarantees.noProject") },
    ...projects.map((p) => ({ id: p.id, label: `${p.code} — ${p.nameAr}` })),
  ];
  const bankOptions: EntityPickerOption[] = banks.map((b) => ({ id: b.id, label: `${b.code} — ${b.name}` }));
  const contractPickerOptions: EntityPickerOption[] = [
    { id: NO_CONTRACT_ID, label: t("guarantees.noContract") },
    ...contractOptions.options.map((c) => ({ id: c.id, label: c.docNo ?? c.titleAr ?? c.nameAr ?? c.id })),
  ];

  function expiryPill(guarantee: GuaranteeDTO) {
    const status = guarantee.derivedStatus;
    if (status === "expired") {
      return <StatusPill label={t("guarantees.status.expired")} tone="danger" />;
    }
    if ((status === "active" || status === "reduced") && guarantee.daysToExpiry <= 30) {
      return (
        <StatusPill
          label={t("guarantees.expiresInDays", { days: format.number(guarantee.daysToExpiry) })}
          tone="warning"
        />
      );
    }
    return <StatusPill label={t(STATUS_KEY[status])} tone={STATUS_TONE[status]} />;
  }

  async function runAction(
    guarantee: GuaranteeDTO,
    run: () => Promise<unknown>,
  ): Promise<void> {
    if (pendingId !== null) return;
    setPendingId(guarantee.id);
    setActionError(null);
    try {
      await run();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t("guarantees.api.actionFailed"));
    } finally {
      setPendingId(null);
    }
  }

  function todayIso(): string {
    return summary?.asOfDate ?? new Date().toISOString().slice(0, 10);
  }

  async function submitDraft(): Promise<void> {
    setFormError(null);
    if (draft.beneficiaryNameAr.trim() === "") return setFormError(t("guarantees.beneficiaryRequired"));
    if (draft.bankTreasuryAccountId === null) return setFormError(t("guarantees.bankRequired"));
    if (draft.faceValue === null || draft.faceValue <= 0) return setFormError(t("guarantees.faceValueRequired"));
    if (draft.issueDate === "" || draft.expiryDate === "") return setFormError(t("guarantees.datesRequired"));
    if (draft.projectId === null && draft.tenderRef.trim() === "") return setFormError(t("guarantees.projectOrTenderRequired"));
    try {
      const created = await createGuarantee.mutateAsync({
        id: draft.id,
        kind: draft.kind,
        projectId: draft.projectId,
        contractId: draft.contractId,
        tenderRef: draft.tenderRef.trim() === "" ? null : draft.tenderRef.trim(),
        beneficiaryNameAr: draft.beneficiaryNameAr.trim(),
        bankTreasuryAccountId: draft.bankTreasuryAccountId,
        faceValue: toMoneyString(draft.faceValue),
        percentOfContract: draft.percentOfContract.trim() === "" ? null : draft.percentOfContract.trim(),
        cashMarginPercent: draft.cashMarginPercent,
        ...(draft.cashMarginAmount !== null ? { cashMarginAmount: toMoneyString(draft.cashMarginAmount) } : {}),
        issueDate: draft.issueDate,
        expiryDate: draft.expiryDate,
        notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
      });
      setDraft(blankDraft());
      subPage.open(created.docNo ?? created.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("guarantees.api.saveFailed"));
    }
  }

  if (!mayView) {
    return (
      <EmptyState title={t("guarantees.noAccessTitle")} description={t("guarantees.noAccessBody")} />
    );
  }

  if (firstSegment === "new") {
    return (
      <FormPage
        eyebrow={t("guarantees.title")}
        title={t("guarantees.newGuarantee")}
        description={t("guarantees.newGuaranteeBody")}
        actions={
          <>
            <Button onClick={() => subPage.close()}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={() => void submitDraft()} disabled={createGuarantee.isPending}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        <FormError message={formError} />
        <FormColumns
          aside={
            <SectionCard title={t("guarantees.marginSection")} columns={1}>
              <TextField
                label={t("guarantees.cashMarginPercent")}
                value={draft.cashMarginPercent}
                onChange={(v) => setDraft((d) => ({ ...d, cashMarginPercent: v }))}
                hint={t("guarantees.cashMarginPercentHint")}
              />
              <div>
                <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("guarantees.cashMarginAmount")}</div>
                <MoneyInput
                  aria-label={t("guarantees.cashMarginAmount")}
                  value={draft.cashMarginAmount}
                  onChange={(v) => setDraft((d) => ({ ...d, cashMarginAmount: v }))}
                />
                <p className="mt-[4px] text-[11.5px] text-ink-muted">{t("guarantees.cashMarginAmountHint")}</p>
              </div>
              <TextField
                label={t("guarantees.notes")}
                value={draft.notes}
                onChange={(v) => setDraft((d) => ({ ...d, notes: v }))}
              />
            </SectionCard>
          }
        >
          <SectionCard title={t("guarantees.letterSection")}>
            <SelectField
              label={t("guarantees.kind")}
              value={draft.kind}
              onChange={(v) => setDraft((d) => ({ ...d, kind: v as GuaranteeKindDTO }))}
              options={KINDS.map((k) => ({ value: k, label: t(KIND_KEY[k]) }))}
            />
            <TextField
              label={t("guarantees.beneficiary")}
              value={draft.beneficiaryNameAr}
              onChange={(v) => setDraft((d) => ({ ...d, beneficiaryNameAr: v }))}
              hint={t("guarantees.beneficiaryHint")}
            />
            <EntityPicker
              label={t("guarantees.project")}
              options={projectOptions}
              value={projectOptions.find((o) => o.id === (draft.projectId ?? NO_PROJECT_ID)) ?? null}
              onChange={(option) =>
                setDraft((d) => ({ ...d, projectId: !option || option.id === NO_PROJECT_ID ? null : option.id }))
              }
            />
            <TextField
              label={t("guarantees.tenderRef")}
              value={draft.tenderRef}
              onChange={(v) => setDraft((d) => ({ ...d, tenderRef: v }))}
              hint={t("guarantees.tenderRefHint")}
            />
            {contractOptions.available ? (
              <EntityPicker
                label={t("guarantees.contract")}
                options={contractPickerOptions}
                value={contractPickerOptions.find((o) => o.id === (draft.contractId ?? NO_CONTRACT_ID)) ?? null}
                onChange={(option) =>
                  setDraft((d) => ({ ...d, contractId: !option || option.id === NO_CONTRACT_ID ? null : option.id }))
                }
              />
            ) : null}
            <EntityPicker
              label={t("guarantees.bank")}
              options={bankOptions}
              value={bankOptions.find((o) => o.id === draft.bankTreasuryAccountId) ?? null}
              onChange={(option) => setDraft((d) => ({ ...d, bankTreasuryAccountId: option?.id ?? null }))}
            />
          </SectionCard>
          <SectionCard title={t("guarantees.valueSection")}>
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("guarantees.faceValue")}</div>
              <MoneyInput
                aria-label={t("guarantees.faceValue")}
                value={draft.faceValue}
                onChange={(v) => setDraft((d) => ({ ...d, faceValue: v }))}
              />
            </div>
            <TextField
              label={t("guarantees.percentOfContract")}
              value={draft.percentOfContract}
              onChange={(v) => setDraft((d) => ({ ...d, percentOfContract: v }))}
              hint={t("guarantees.percentOfContractHint")}
            />
            <TextField
              label={t("guarantees.issueDate")}
              value={draft.issueDate}
              onChange={(v) => setDraft((d) => ({ ...d, issueDate: v }))}
              placeholder="YYYY-MM-DD"
            />
            <TextField
              label={t("guarantees.expiryDate")}
              value={draft.expiryDate}
              onChange={(v) => setDraft((d) => ({ ...d, expiryDate: v }))}
              placeholder="YYYY-MM-DD"
            />
          </SectionCard>
        </FormColumns>
      </FormPage>
    );
  }

  if (selected) {
    const outstanding = selected.derivedStatus === "released" || selected.derivedStatus === "called";
    const busy = pendingId === selected.id;
    return (
      <div className="w-full">
        <div className="mb-4">
          <Button onClick={() => subPage.close()}>{t("guarantees.backToRegister")}</Button>
        </div>
        {actionError ? <FormError message={actionError} /> : null}
        <DocumentDetail
          title={selected.docNo ?? selected.id}
          statusLabel={t(STATUS_KEY[selected.derivedStatus])}
          statusTone={STATUS_TONE[selected.derivedStatus]}
          subtitle={`${t(KIND_KEY[selected.kind])} — ${selected.beneficiaryNameAr}`}
          actions={
            mayWrite ? (
              <div className="flex flex-wrap gap-2">
                {selected.status === "draft" ? (
                  <Button variant="primary" disabled={busy} onClick={() => void runAction(selected, () => issueGuarantee.mutateAsync({ id: selected.id, body: {} }))}>
                    {t("guarantees.action.issue")}
                  </Button>
                ) : null}
                {!outstanding && selected.status !== "draft" ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void runAction(selected, () =>
                          reduceGuarantee.mutateAsync({
                            id: selected.id,
                            body: {
                              date: actionDate === "" ? todayIso() : actionDate,
                              amount: toMoneyString(reduceAmount),
                              reason: reduceReason.trim() === "" ? t("guarantees.reduceDefaultReason") : reduceReason.trim(),
                            },
                          }),
                        )
                      }
                    >
                      {t("guarantees.action.reduce")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void runAction(selected, () =>
                          releaseGuarantee.mutateAsync({
                            id: selected.id,
                            body: { date: actionDate === "" ? todayIso() : actionDate },
                          }),
                        )
                      }
                    >
                      {t("guarantees.action.release")}
                    </Button>
                    <Button
                      variant="danger-outline"
                      disabled={busy}
                      onClick={() =>
                        void runAction(selected, () =>
                          callGuarantee.mutateAsync({
                            id: selected.id,
                            body: {
                              date: actionDate === "" ? todayIso() : actionDate,
                              ...(chargeAccountId.trim() === "" ? {} : { chargeAccountId: chargeAccountId.trim() }),
                            },
                          }),
                        )
                      }
                    >
                      {t("guarantees.action.call")}
                    </Button>
                  </>
                ) : null}
              </div>
            ) : null
          }
          summary={[
            { label: t("guarantees.faceValue"), value: <MoneyValue value={majorOf(selected.faceValue)} /> },
            { label: t("guarantees.currentValue"), value: <MoneyValue value={majorOf(selected.currentValue)} /> },
            { label: t("guarantees.cashMarginAmount"), value: <MoneyValue value={majorOf(selected.cashMarginAmount)} /> },
            { label: t("guarantees.bank"), value: selected.bankNameAr },
            { label: t("guarantees.expiryDate"), value: <span className="mz-num">{selected.expiryDate}</span> },
          ]}
          effectsTitle={t("guarantees.effectsTitle")}
          effects={[t("guarantees.effectMemo"), t("guarantees.effectMargin")]}
          tabs={[
            {
              key: "details",
              label: t("guarantees.tab.details"),
              content: (
                <Card className="grid grid-cols-1 sm:grid-cols-2">
                  <DetailCell label={t("guarantees.kind")} value={t(KIND_KEY[selected.kind])} />
                  <DetailCell label={t("guarantees.project")} value={projectName(selected.projectId)} />
                  <DetailCell label={t("guarantees.tenderRef")} value={selected.tenderRef ?? "—"} />
                  <DetailCell label={t("guarantees.contract")} value={selected.contractId ?? "—"} />
                  <DetailCell label={t("guarantees.issueDate")} value={selected.issueDate} numeric />
                  <DetailCell label={t("guarantees.percentOfContract")} value={selected.percentOfContract ?? "—"} numeric />
                  <DetailCell label={t("guarantees.cashMarginPercent")} value={selected.cashMarginPercent} numeric />
                  <DetailCell label={t("guarantees.daysToExpiry")} value={format.number(selected.daysToExpiry)} numeric />
                  <DetailCell label={t("guarantees.notes")} value={selected.notes ?? "—"} />
                </Card>
              ),
            },
            {
              key: "reductions",
              label: t("guarantees.tab.reductions"),
              content:
                selected.reductions.length === 0 ? (
                  <EmptyState title={t("guarantees.noReductions")} description={t("guarantees.noReductionsBody")} />
                ) : (
                  <Card className="divide-y divide-border">
                    {selected.reductions.map((r, index) => (
                      <div key={`${r.date}-${index}`} className="flex items-center justify-between gap-3 p-[13px_15px]">
                        <div>
                          <div className="text-[13px] font-semibold text-ink">{r.reason}</div>
                          <div className="mz-num text-[11.5px] text-ink-muted">
                            {r.date}
                            {r.sourceRef ? ` · ${r.sourceRef}` : ""}
                          </div>
                        </div>
                        <MoneyValue value={majorOf(r.amount)} />
                      </div>
                    ))}
                  </Card>
                ),
            },
          ]}
          aside={
            mayWrite && !outstanding && selected.status !== "draft" ? (
              <SectionCard title={t("guarantees.actionInputs")} columns={1}>
                <TextField label={t("guarantees.actionDate")} value={actionDate} onChange={setActionDate} placeholder={todayIso()} />
                <div>
                  <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("guarantees.reduceAmount")}</div>
                  <MoneyInput aria-label={t("guarantees.reduceAmount")} value={reduceAmount} onChange={setReduceAmount} />
                </div>
                <TextField label={t("guarantees.reduceReason")} value={reduceReason} onChange={setReduceReason} />
                <TextField
                  label={t("guarantees.chargeAccount")}
                  value={chargeAccountId}
                  onChange={setChargeAccountId}
                  hint={t("guarantees.chargeAccountHint")}
                />
              </SectionCard>
            ) : null
          }
        />
      </div>
    );
  }

  const columns: DocumentListColumn<GuaranteeDTO>[] = [
    {
      key: "docNo",
      header: t("guarantees.docNo"),
      render: (g) => <span className="mz-num font-semibold text-ink">{g.docNo ?? t("guarantees.notIssuedYet")}</span>,
    },
    { key: "kind", header: t("guarantees.kind"), render: (g) => t(KIND_KEY[g.kind]) },
    { key: "project", header: t("guarantees.project"), render: (g) => g.projectId ? projectName(g.projectId) : (g.tenderRef ?? t("guarantees.noProject")) },
    { key: "bank", header: t("guarantees.bank"), render: (g) => g.bankNameAr },
    { key: "faceValue", header: t("guarantees.faceValue"), align: "end", render: (g) => <MoneyValue value={majorOf(g.currentValue)} /> },
    { key: "margin", header: t("guarantees.cashMarginAmount"), align: "end", render: (g) => <MoneyValue value={majorOf(g.cashMarginAmount)} /> },
    { key: "expiry", header: t("guarantees.expiryDate"), render: (g) => <span className="mz-num">{g.expiryDate}</span> },
    { key: "status", header: t("common.status"), render: (g) => expiryPill(g) },
  ];

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: rows.length },
    ...STATUSES.map((status) => ({
      key: status,
      label: t(STATUS_KEY[status]),
      count: rows.filter((g) => g.derivedStatus === status).length,
    })),
  ];

  return (
    <div className="w-full">
      {listQuery.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("guarantees.api.listFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => void listQuery.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<GuaranteeDTO>
        title={t("guarantees.title")}
        description={t("guarantees.description")}
        actions={
          mayWrite ? (
            <Button variant="primary" onClick={() => subPage.open("new")}>
              {t("guarantees.newGuarantee")}
            </Button>
          ) : null
        }
        listKey="contracting-guarantees"
        stats={[
          {
            label: t("guarantees.stat.outstanding"),
            value: <MoneyValue value={majorOf(summary?.totalOutstanding)} />,
            sub: t("guarantees.stat.outstandingSub"),
          },
          {
            label: t("guarantees.stat.restrictedCash"),
            value: <MoneyValue value={majorOf(summary?.restrictedCash)} />,
            sub: t("guarantees.stat.restrictedCashSub"),
          },
          {
            label: t("guarantees.stat.available"),
            value: <MoneyValue value={majorOf(summary?.totalAvailable)} />,
            sub: t("guarantees.stat.availableSub"),
            valueTone: majorOf(summary?.totalAvailable) < 0 ? "danger" : "default",
          },
          {
            label: t("guarantees.stat.expiring"),
            value: <span className="mz-num">{format.number(summary?.expiringWithin30Days ?? 0)}</span>,
            sub: t("guarantees.stat.expiringSub"),
            valueTone: (summary?.expiringWithin30Days ?? 0) > 0 ? "danger" : "default",
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("guarantees.searchPlaceholder")}
        filterBarExtra={
          <SelectField
            label={t("guarantees.project")}
            value={projectFilter}
            onChange={(value) => {
              setProjectFilter(value);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("common.all") },
              { value: NO_PROJECT_ID, label: t("guarantees.noProject") },
              ...projects.map((p) => ({ value: p.id, label: p.nameAr })),
            ]}
          />
        }
        columns={columns}
        rows={pageRows}
        loading={listQuery.isLoading}
        rowKey={(g) => g.id}
        onRowClick={(g) => subPage.open(g.docNo ?? g.id)}
        rowAction={(g) => {
          const items: RowMenuItem[] = [
            { key: "view", label: t("common.view"), onSelect: () => subPage.open(g.docNo ?? g.id) },
          ];
          if (mayWrite && g.status === "draft") {
            items.push({
              key: "issue",
              label: t("guarantees.action.issue"),
              disabled: pendingId === g.id,
              onSelect: () => void runAction(g, () => issueGuarantee.mutateAsync({ id: g.id, body: {} })),
            });
          }
          if (g.status !== "draft") items.push(...reversal.menuItems({ id: g.id, params: { id: g.id }, subject: g.docNo ?? g.id }));
          return <RowMenu items={items} label={t("common.rowActionsFor", { name: g.docNo ?? g.id })} />;
        }}
        page={currentPage}
        pageCount={pageCount}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZES}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{format.number(pageRows.length)}</span> {t("common.of")}{" "}
            <span className="mz-num">{format.number(rows.length)}</span>
          </>
        }
        emptyState={
          <EmptyState
            title={t("guarantees.emptyTitle")}
            description={t("guarantees.emptyBody")}
            action={mayWrite ? { label: t("guarantees.newGuarantee"), onClick: () => subPage.open("new") } : undefined}
          />
        }
      />
      {reversal.dialog}
      {summary && summary.byBank.length > 0 ? (
        <Card className="mt-[18px] divide-y divide-border">
          <div className="p-[13px_15px] text-[12.5px] font-bold text-ink">{t("guarantees.byBankTitle")}</div>
          {summary.byBank.map((bank) => (
            <div key={bank.bankTreasuryAccountId} className="flex flex-wrap items-center justify-between gap-3 p-[13px_15px]">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-ink">{bank.bankNameAr}</div>
                <div className="text-[11.5px] text-ink-muted">
                  {t("guarantees.lettersCount", { count: format.number(bank.count) })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-[18px]">
                <BankFigure label={t("guarantees.stat.outstanding")} value={<MoneyValue value={majorOf(bank.outstanding)} />} />
                <BankFigure
                  label={t("guarantees.facilityLimit")}
                  value={bank.facilityLimit === null ? <span className="text-ink-muted">—</span> : <MoneyValue value={majorOf(bank.facilityLimit)} />}
                />
                <BankFigure
                  label={t("guarantees.stat.available")}
                  value={
                    bank.available === null ? (
                      <span className="text-ink-muted">{t("guarantees.noFacilityConfigured")}</span>
                    ) : (
                      <MoneyValue value={majorOf(bank.available)} className={majorOf(bank.available) < 0 ? "text-danger-ink" : undefined} />
                    )
                  }
                />
              </div>
            </div>
          ))}
        </Card>
      ) : null}
    </div>
  );
}

function DetailCell({ label, value, numeric }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="border-b border-border p-[13px_15px] last:border-b-0">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className={`mt-[5px] text-[13.5px] font-bold text-ink${numeric ? " mz-num" : ""}`}>{value}</div>
    </div>
  );
}

function BankFigure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="text-end">
      <div className="text-[11px] font-semibold text-ink-faint">{label}</div>
      <div className="mt-[3px] text-[13px] font-bold text-ink">{value}</div>
    </div>
  );
}

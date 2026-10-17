import { useMemo, useState } from "react";
import {
  Button,
  DocumentList,
  EmptyState,
  EntityPicker,
  RowMenu,
  SidePanel,
  StatusPill,
  useFormat,
  type DocumentListColumn,
  type EntityPickerOption,
  type RowMenuItem,
} from "@mezan/ui";
import {
  PricingGuardDocTypeDTO,
  PricingGuardModeDTO,
  PricingGuardOverrideKindDTO,
  PricingGuardRuleStatusDTO,
  type PricingGuardOverrideDTO,
  type PricingGuardRuleDTO,
} from "@mezan/contracts";
import { useCustomers, useItemCategories, useItems } from "../../../data/hooks";
import { SelectField, TextAreaField, TextField } from "../../../settings/form-controls";
import { errorMessage } from "../../../lib/error-message";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { EMPTY } from "../../../lib/empty";
import { ScreenTabs } from "../../ScreenTabs";
import { BREACH_LABEL, COST_BASIS_LABEL } from "./PricingGuardLineStatus";
import { usePricingGuardOverrides, usePricingGuardRules, useSavePricingGuardRule, useSetPricingGuardRuleStatus } from "./pricing-guard-hooks";

const PAGE_SIZE = 25;
const MONEY_PATTERN = /^\d+(\.\d{1,6})?$/;
const PERCENT_PATTERN = /^-?\d{1,2}(\.\d{1,2})?$/;

const MODE_LABEL: Record<PricingGuardModeDTO, AppTranslationKey> = {
  [PricingGuardModeDTO.Block]: "pricingGuard.mode.block",
  [PricingGuardModeDTO.Approval]: "pricingGuard.mode.approval",
};

const OVERRIDE_KIND_LABEL: Record<PricingGuardOverrideKindDTO, AppTranslationKey> = {
  [PricingGuardOverrideKindDTO.ApprovedByChain]: "pricingGuard.overrideKind.approved_by_chain",
  [PricingGuardOverrideKindDTO.AdminBypass]: "pricingGuard.overrideKind.admin_bypass",
  [PricingGuardOverrideKindDTO.QuoteSentBelowFloor]: "pricingGuard.overrideKind.quote_sent_below_floor",
};

const DOC_TYPE_LABEL: Record<PricingGuardDocTypeDTO, AppTranslationKey> = {
  [PricingGuardDocTypeDTO.SalesInvoice]: "pricingGuard.docType.sales_invoice",
  [PricingGuardDocTypeDTO.SalesQuote]: "pricingGuard.docType.sales_quote",
};

enum RuleTarget {
  All = "all",
  Item = "item",
  Category = "category",
}

interface RuleDraft {
  nameAr: string;
  target: RuleTarget;
  itemId: string;
  categoryId: string;
  customerCategory: string;
  floorPrice: string;
  minMarginPercent: string;
  mode: PricingGuardModeDTO;
  note: string;
}

function draftOf(rule: PricingGuardRuleDTO | null): RuleDraft {
  return {
    nameAr: rule?.nameAr ?? "",
    target: rule?.itemId ? RuleTarget.Item : rule?.categoryId ? RuleTarget.Category : RuleTarget.All,
    itemId: rule?.itemId ?? "",
    categoryId: rule?.categoryId ?? "",
    customerCategory: rule?.customerCategory ?? "",
    floorPrice: rule?.floorPrice ?? "",
    minMarginPercent: rule?.minMarginPercent === null || rule?.minMarginPercent === undefined ? "" : String(rule.minMarginPercent),
    mode: rule?.mode ?? PricingGuardModeDTO.Approval,
    note: rule?.note ?? "",
  };
}

function useCustomerCategories(): string[] {
  const customers = useCustomers().data ?? EMPTY;
  return useMemo(() => [...new Set(customers.map((c) => c.category).filter((c): c is string => !!c && c.trim() !== ""))].sort(), [customers]);
}

function RuleForm({ editing, onClose }: { editing: PricingGuardRuleDTO | null; onClose: () => void }) {
  const { t } = useAppTranslation();
  const items = useItems().data ?? EMPTY;
  const categories = useItemCategories().data ?? EMPTY;
  const customerCategories = useCustomerCategories();
  const save = useSavePricingGuardRule();
  const [draft, setDraft] = useState<RuleDraft>(() => draftOf(editing));
  const [error, setError] = useState<string | null>(null);
  const patch = (next: Partial<RuleDraft>) => setDraft((prev) => ({ ...prev, ...next }));

  const itemOptions = useMemo<EntityPickerOption[]>(() => items.map((i) => ({ id: i.id, label: i.nameAr, sublabel: i.code })), [items]);
  const categoryOptions = useMemo<EntityPickerOption[]>(() => categories.map((c) => ({ id: c.id, label: c.nameAr })), [categories]);

  async function submit() {
    setError(null);
    const floor = draft.floorPrice.trim();
    const margin = draft.minMarginPercent.trim();
    if (draft.nameAr.trim() === "") return setError(t("pricingGuard.validation.name"));
    if (draft.target === RuleTarget.Item && draft.itemId === "") return setError(t("pricingGuard.validation.item"));
    if (draft.target === RuleTarget.Category && draft.categoryId === "") return setError(t("pricingGuard.validation.category"));
    if (floor === "" && margin === "") return setError(t("pricingGuard.validation.limit"));
    if (floor !== "" && !MONEY_PATTERN.test(floor)) return setError(t("pricingGuard.validation.floor"));
    if (margin !== "" && !PERCENT_PATTERN.test(margin)) return setError(t("pricingGuard.validation.margin"));
    try {
      await save.mutateAsync({
        id: editing?.id ?? null,
        body: {
          nameAr: draft.nameAr.trim(),
          itemId: draft.target === RuleTarget.Item ? draft.itemId : null,
          categoryId: draft.target === RuleTarget.Category ? draft.categoryId : null,
          customerCategory: draft.customerCategory === "" ? null : draft.customerCategory,
          floorPrice: draft.target === RuleTarget.Item && floor !== "" ? floor : null,
          minMarginPercent: margin === "" ? null : Number(margin),
          mode: draft.mode,
          note: draft.note.trim() === "" ? null : draft.note.trim(),
        },
      });
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("pricingGuard.ruleCouldNotBeSaved")));
    }
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <TextField label={t("pricingGuard.field.name")} value={draft.nameAr} onChange={(v) => patch({ nameAr: v })} />
      <SelectField
        label={t("pricingGuard.field.appliesTo")}
        value={draft.target}
        onChange={(v) => patch({ target: v as RuleTarget })}
        options={[
          { value: RuleTarget.All, label: t("pricingGuard.target.all") },
          { value: RuleTarget.Item, label: t("pricingGuard.target.item") },
          { value: RuleTarget.Category, label: t("pricingGuard.target.category") },
        ]}
      />
      {draft.target === RuleTarget.Item ? (
        <EntityPicker
          id="pricing-guard-item"
          label={t("pricingGuard.field.item")}
          value={itemOptions.find((o) => o.id === draft.itemId) ?? null}
          onChange={(o) => patch({ itemId: o?.id ?? "" })}
          options={itemOptions}
          placeholder={t("pricingGuard.field.chooseItem")}
        />
      ) : null}
      {draft.target === RuleTarget.Category ? (
        <EntityPicker
          id="pricing-guard-category"
          label={t("pricingGuard.field.category")}
          value={categoryOptions.find((o) => o.id === draft.categoryId) ?? null}
          onChange={(o) => patch({ categoryId: o?.id ?? "" })}
          options={categoryOptions}
          placeholder={t("pricingGuard.field.chooseCategory")}
        />
      ) : null}
      <SelectField
        label={t("pricingGuard.field.customerCategory")}
        value={draft.customerCategory}
        onChange={(v) => patch({ customerCategory: v })}
        options={[{ value: "", label: t("pricingGuard.field.everyCustomer") }, ...customerCategories.map((c) => ({ value: c, label: c }))]}
      />
      {draft.target === RuleTarget.Item ? (
        <TextField label={t("pricingGuard.field.floorPrice")} hint={t("pricingGuard.field.floorPriceHint")} value={draft.floorPrice} onChange={(v) => patch({ floorPrice: v })} />
      ) : null}
      <TextField
        label={t("pricingGuard.field.minMargin")}
        hint={t("pricingGuard.field.minMarginHint")}
        value={draft.minMarginPercent}
        onChange={(v) => patch({ minMarginPercent: v })}
      />
      <SelectField
        label={t("pricingGuard.field.mode")}
        hint={t("pricingGuard.field.modeHint")}
        value={draft.mode}
        onChange={(v) => patch({ mode: v as PricingGuardModeDTO })}
        options={[
          { value: PricingGuardModeDTO.Approval, label: t("pricingGuard.mode.approval") },
          { value: PricingGuardModeDTO.Block, label: t("pricingGuard.mode.block") },
        ]}
      />
      <TextAreaField label={t("pricingGuard.field.note")} value={draft.note} onChange={(v) => patch({ note: v })} />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={save.isPending} onClick={() => void submit()}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

function RulesTab() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const query = usePricingGuardRules();
  const items = useItems().data ?? EMPTY;
  const categories = useItemCategories().data ?? EMPTY;
  const setStatus = useSetPricingGuardRuleStatus();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PricingGuardRuleDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const rules = query.data ?? EMPTY;
  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.nameAr])), [items]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.nameAr])), [categories]);
  const pageCount = Math.max(1, Math.ceil(rules.length / PAGE_SIZE));
  const pageRows = rules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggle(rule: PricingGuardRuleDTO) {
    if (pendingId !== null) return;
    setPendingId(rule.id);
    setError(null);
    setStatus.mutate(
      { id: rule.id, status: rule.status === PricingGuardRuleStatusDTO.Active ? PricingGuardRuleStatusDTO.Inactive : PricingGuardRuleStatusDTO.Active },
      { onError: (err) => setError(errorMessage(err, t("pricingGuard.ruleCouldNotBeSaved"))), onSettled: () => setPendingId(null) },
    );
  }

  const scopeOf = (rule: PricingGuardRuleDTO) =>
    rule.itemId ? itemName.get(rule.itemId) ?? rule.itemId : rule.categoryId ? `${t("pricingGuard.target.category")}: ${categoryName.get(rule.categoryId) ?? rule.categoryId}` : t("pricingGuard.target.all");

  const columns: DocumentListColumn<PricingGuardRuleDTO>[] = [
    { key: "nameAr", header: t("pricingGuard.field.name"), render: (rule) => <span className="font-semibold text-ink">{rule.nameAr}</span> },
    { key: "scope", header: t("pricingGuard.field.appliesTo"), render: (rule) => scopeOf(rule) },
    { key: "customerCategory", header: t("pricingGuard.field.customerCategory"), render: (rule) => rule.customerCategory ?? <span className="text-ink-faint">{t("pricingGuard.field.everyCustomer")}</span> },
    { key: "floorPrice", header: t("pricingGuard.field.floorPrice"), align: "end", render: (rule) => (rule.floorPrice ? <span className="mz-num">{format.money(rule.floorPrice)}</span> : <span className="text-ink-faint">—</span>) },
    { key: "minMarginPercent", header: t("pricingGuard.field.minMargin"), align: "end", render: (rule) => (rule.minMarginPercent !== null ? <span className="mz-num">{format.number(rule.minMarginPercent)}%</span> : <span className="text-ink-faint">—</span>) },
    { key: "mode", header: t("pricingGuard.field.mode"), render: (rule) => <StatusPill label={t(MODE_LABEL[rule.mode])} tone={rule.mode === PricingGuardModeDTO.Block ? "danger" : "warning"} /> },
    {
      key: "status",
      header: t("pricingGuard.field.status"),
      render: (rule) => <StatusPill label={t(rule.status === PricingGuardRuleStatusDTO.Active ? "pricingGuard.status.active" : "pricingGuard.status.inactive")} tone={rule.status === PricingGuardRuleStatusDTO.Active ? "success" : "neutral"} />,
    },
  ];

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="rounded-lg border border-border bg-surface-2 p-[12px_14px] text-[12.5px] text-ink-muted">{t("pricingGuard.explainer")}</div>
      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      <DocumentList<PricingGuardRuleDTO>
        title={t("pricingGuard.tab.rules")}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            {t("pricingGuard.newRule")}
          </Button>
        }
        columns={columns}
        rows={pageRows}
        rowKey={(rule) => rule.id}
        rowAction={(rule) => {
          const menu: RowMenuItem[] = [
            {
              key: "edit",
              label: t("pricingGuard.editRule"),
              onSelect: () => {
                setEditing(rule);
                setFormOpen(true);
              },
            },
            {
              key: "status",
              label: t(rule.status === PricingGuardRuleStatusDTO.Active ? "pricingGuard.deactivate" : "pricingGuard.activate"),
              disabled: pendingId === rule.id,
              onSelect: () => toggle(rule),
            },
          ];
          return <RowMenu items={menu} label={t("common.rowActionsFor", { name: rule.nameAr })} />;
        }}
        loading={query.isLoading}
        loadFailed={query.isError}
        page={page}
        pageCount={pageCount}
        onPageChange={setPage}
        emptyState={<EmptyState title={t("pricingGuard.noRules")} description={t("pricingGuard.subtitle")} />}
      />
      <SidePanel open={formOpen} onClose={() => setFormOpen(false)} title={editing ? t("pricingGuard.editRule") : t("pricingGuard.newRule")}>
        {formOpen ? <RuleForm key={editing?.id ?? "new"} editing={editing} onClose={() => setFormOpen(false)} /> : null}
      </SidePanel>
    </div>
  );
}

function OverridesTab() {
  const { t } = useAppTranslation();
  const format = useFormat();
  const nav = useNavigation();
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const query = usePricingGuardOverrides({ fromDate: fromDate || undefined, toDate: toDate || undefined });
  const items = useItems().data ?? EMPTY;
  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.nameAr])), [items]);
  const rows = query.data?.rows ?? EMPTY;
  const costVisible = query.data?.costVisible ?? false;
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: DocumentListColumn<PricingGuardOverrideDTO>[] = [
    { key: "docDate", header: t("pricingGuard.report.date"), render: (row) => <span className="mz-num">{row.docDate}</span> },
    {
      key: "docNo",
      header: t("pricingGuard.report.document"),
      render: (row) => (
        <button
          type="button"
          className="text-brand underline"
          onClick={() => nav.openScreenAt(row.docType === PricingGuardDocTypeDTO.SalesInvoice ? "sales-invoices" : "quotes", [row.docId])}
        >
          {t(DOC_TYPE_LABEL[row.docType])} {row.docNo ?? row.docId}
        </button>
      ),
    },
    { key: "customerNameAr", header: t("pricingGuard.report.customer"), render: (row) => row.customerNameAr },
    { key: "itemId", header: t("pricingGuard.report.item"), render: (row) => itemName.get(row.itemId) ?? row.itemId },
    { key: "netUnitPrice", header: t("pricingGuard.report.netUnitPrice"), align: "end", render: (row) => <span className="mz-num">{format.money(row.netUnitPrice)}</span> },
    ...(costVisible
      ? [
          {
            key: "unitCost",
            header: t("pricingGuard.report.unitCost"),
            align: "end" as const,
            render: (row: PricingGuardOverrideDTO) =>
              row.unitCost ? (
                <span className="mz-num" title={row.costBasis ? t(COST_BASIS_LABEL[row.costBasis]) : undefined}>
                  {format.money(row.unitCost)}
                </span>
              ) : (
                <span className="text-ink-faint">—</span>
              ),
          },
          {
            key: "marginPercent",
            header: t("pricingGuard.report.margin"),
            align: "end" as const,
            render: (row: PricingGuardOverrideDTO) => (row.marginPercent ? <span className="mz-num">{format.money(row.marginPercent)}%</span> : <span className="text-ink-faint">—</span>),
          },
        ]
      : []),
    {
      key: "breaches",
      header: t("pricingGuard.report.breach"),
      render: (row) => (
        <span className="flex flex-col gap-[2px]">
          {row.breaches.map((breach) => (
            <span key={`${breach.ruleId}:${breach.kind}`} className="text-[12px]">
              {t(BREACH_LABEL[breach.kind])} · {breach.ruleNameAr}
            </span>
          ))}
        </span>
      ),
    },
    { key: "kind", header: t("pricingGuard.report.kind"), render: (row) => <StatusPill label={t(OVERRIDE_KIND_LABEL[row.kind])} tone={row.kind === PricingGuardOverrideKindDTO.AdminBypass ? "danger" : "warning"} /> },
    { key: "actor", header: t("pricingGuard.report.actor"), render: (row) => <span className="text-[12px]">{[row.submittedByName ?? row.submittedBy, ...row.approvedByNames].join(" ← ")}</span> },
  ];

  return (
    <DocumentList<PricingGuardOverrideDTO>
      title={t("pricingGuard.tab.overrides")}
      description={t("pricingGuard.report.description")}
      filterBarExtra={
        <div className="flex flex-wrap gap-[10px]">
          <TextField label={t("pricingGuard.report.from")} type="date" value={fromDate} onChange={setFromDate} />
          <TextField label={t("pricingGuard.report.to")} type="date" value={toDate} onChange={setToDate} />
        </div>
      }
      columns={columns}
      rows={pageRows}
      rowKey={(row) => row.id}
      loading={query.isLoading}
      loadFailed={query.isError}
      page={page}
      pageCount={pageCount}
      onPageChange={setPage}
      emptyState={<EmptyState title={t("pricingGuard.report.empty")} description={t("pricingGuard.report.description")} />}
    />
  );
}

export function PricingGuardScreen() {
  const { t } = useAppTranslation();
  return (
    <ScreenTabs
      ariaLabel={t("pricingGuard.title")}
      tabs={[
        { key: "rules", label: t("pricingGuard.tab.rules"), render: () => <RulesTab /> },
        { key: "overrides", label: t("pricingGuard.tab.overrides"), render: () => <OverridesTab /> },
      ]}
    />
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentList,
  EmptyState,
  EntityPicker,
  Money as MoneyDisplay,
  MoneyInput,
  QtyInput,
  RowMenu,
  StatusPill,
  SidePanel,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type EntityPickerOption,
  type RowMenuItem,
} from "@mezan/ui";
import type { ItemDTO, PromotionDTO, PromotionScopeDTO, PromotionTypeDTO } from "@mezan/contracts";
import { NumberField, SelectField, TextField, ToggleField } from "../settings/form-controls";
import { useCreatePromotion, useItems, usePromotionUsageReport, usePromotions, useUpdatePromotion } from "../data/hooks";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { todayIso } from "../lib/dates";
import { majorOf } from "../lib/money";

const TYPE_KEY: Record<PromotionTypeDTO, AppTranslationKey> = {
  percentage: "promotions.type.percentage",
  fixed_amount: "promotions.type.fixed_amount",
  special_price: "promotions.type.special_price",
  buy_x_get_y: "promotions.type.buy_x_get_y",
  bundle: "promotions.type.bundle",
};

const SCOPE_KEY: Record<PromotionScopeDTO["type"], AppTranslationKey> = {
  all: "promotions.scope.all",
  item: "promotions.scope.item",
  category: "promotions.scope.category",
};

const PAGE_SIZES = [10, 25, 50, 100] as const;

type DerivedState = "active" | "scheduled" | "expiring" | "ended";

function deriveState(p: PromotionDTO, today = todayIso()): DerivedState {
  if (!p.active) return "ended";
  if (today < p.startDate) return "scheduled";
  if (today > p.endDate) return "ended";
  const daysLeft = (new Date(p.endDate).getTime() - new Date(today).getTime()) / 86_400_000;
  if (daysLeft <= 7) return "expiring";
  return "active";
}

const STATE_KEY: Record<DerivedState, AppTranslationKey> = {
  active: "promotions.state.active",
  scheduled: "promotions.state.scheduled",
  expiring: "promotions.state.expiring",
  ended: "promotions.state.ended",
};
const STATE_TONE: Record<DerivedState, "success" | "info" | "warning" | "neutral"> = {
  active: "success",
  scheduled: "info",
  expiring: "warning",
  ended: "neutral",
};

/**
 * العروض / Promotions (docs/catalog/01 — رمز الخصم, النوع, النطاق, الفترة).
 * Real data only: list, create and edit go through `GET/POST/PATCH
 * /promotions`. Active / scheduled / expiring-soon are derived from
 * start/end dates.
 *
 * The engine that picks and computes a promotion lives in the domain
 * (`evaluateBestPromotion`); this screen only configures WHAT it may do —
 * the type, the minimum quantity in scope, the maximum this campaign may
 * ever give away, the priority that breaks ties, and the bundle components.
 */

/**
 * تقرير استخدام العروض — what each campaign actually granted, read from the
 * promotion snapshot every confirmed invoice stamped on itself. «المعكوس» is
 * the share taken back by confirmed sales returns against those invoices.
 */
function PromotionUsageReport() {
  const { t } = useAppTranslation();
  const query = usePromotionUsageReport();
  const rows = query.data ?? [];

  return (
    <Card className="p-[18px_20px]">
      <h2 className="font-display text-[15px] font-bold text-ink">{t("promotions.usage.title")}</h2>
      <p className="mb-[12px] text-[12.5px] text-ink-muted">
        {t("promotions.usage.description")}
      </p>
      {query.isLoading ? (
        <div className="p-4 text-center text-sm text-ink-muted">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="p-4 text-center text-sm text-ink-muted">{t("promotions.usage.empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-[12px] text-ink-muted">
                <th className="p-[10px] text-start font-semibold">{t("promotions.usage.col.promotion")}</th>
                <th className="p-[10px] text-end font-semibold">{t("promotions.usage.col.uses")}</th>
                <th className="p-[10px] text-end font-semibold">{t("promotions.usage.col.granted")}</th>
                <th className="p-[10px] text-end font-semibold">{t("promotions.usage.col.reversed")}</th>
                <th className="p-[10px] text-end font-semibold">{t("promotions.usage.col.net")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border">
                  <td className="p-[10px] text-ink">
                    <div className="mz-num font-semibold">{row.code}</div>
                    <div className="text-[11px] text-ink-muted">{row.nameAr}</div>
                  </td>
                  <td className="mz-num p-[10px] text-end text-ink">{row.usageCount}</td>
                  <td className="p-[10px] text-end">
                    <MoneyDisplay value={Number(row.discountGranted)} />
                  </td>
                  <td className="p-[10px] text-end">
                    <MoneyDisplay value={Number(row.reversedDiscount)} />
                  </td>
                  <td className="p-[10px] text-end font-semibold">
                    <MoneyDisplay value={Number(row.netDiscount)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface BundleRow {
  key: string;
  itemId: string;
  qty: number;
}

interface PromotionDraft {
  code: string;
  nameAr: string;
  type: PromotionTypeDTO;
  percentValue: number;
  amountValue: number | null;
  minInvoiceValue: number | null;
  minQty: number | null;
  maxDiscountAmount: number | null;
  priority: number;
  buyQty: number;
  getQty: number;
  startDate: string;
  endDate: string;
  requiresCoupon: boolean;
  active: boolean;
  scopeType: PromotionScopeDTO["type"];
  scopeIds: string[];
  bundle: BundleRow[];
}

let bundleSeq = 0;
function blankBundleRow(): BundleRow {
  bundleSeq += 1;
  return { key: `b${bundleSeq}`, itemId: "", qty: 1 };
}

function blankDraft(): PromotionDraft {
  return {
    code: "",
    nameAr: "",
    type: "percentage",
    percentValue: 10,
    amountValue: null,
    minInvoiceValue: null,
    minQty: null,
    maxDiscountAmount: null,
    priority: 1,
    buyQty: 2,
    getQty: 1,
    startDate: todayIso(),
    endDate: todayIso(),
    requiresCoupon: false,
    active: true,
    scopeType: "all",
    scopeIds: [],
    bundle: [],
  };
}

function draftFrom(p: PromotionDTO): PromotionDraft {
  return {
    code: p.code,
    nameAr: p.nameAr,
    type: p.type,
    percentValue: p.percentValue ?? 10,
    amountValue: p.amountValue === null ? null : majorOf(p.amountValue),
    minInvoiceValue: p.minInvoiceValue === null ? null : majorOf(p.minInvoiceValue),
    minQty: p.minQty === null ? null : majorOf(p.minQty),
    maxDiscountAmount: p.maxDiscountAmount === null ? null : majorOf(p.maxDiscountAmount),
    priority: p.priority,
    buyQty: p.buyQty ?? 2,
    getQty: p.getQty ?? 1,
    startDate: p.startDate,
    endDate: p.endDate,
    requiresCoupon: p.requiresCoupon,
    active: p.active,
    scopeType: p.scope.type,
    scopeIds: [...p.scope.ids],
    bundle: p.bundleComponents.map((c) => ({ key: blankBundleRow().key, itemId: c.itemId, qty: majorOf(c.qty) })),
  };
}

export function PromotionsScreen() {
  const { t } = useAppTranslation();
  const query = usePromotions();
  const promotions = query.data ?? [];
  const items = useItems().data ?? [];
  const create = useCreatePromotion();
  const update = useUpdatePromotion();

  const [panelOpen, setPanelOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromotionDraft>(blankDraft());
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"all" | DerivedState>("all");
  const [search, setSearch] = useState("");
  const [couponOnly, setCouponOnly] = useState(false);
  const [cappedOnly, setCappedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const itemOptions = useMemo<EntityPickerOption[]>(
    () => items.map((i: ItemDTO) => ({ id: i.id, label: i.nameAr, sublabel: i.code })),
    [items],
  );
  const itemById = useMemo(() => new Map(items.map((i: ItemDTO) => [i.id, i])), [items]);
  const optionFor = (id: string): EntityPickerOption | null => {
    const item = itemById.get(id);
    return item ? { id: item.id, label: item.nameAr, sublabel: item.code } : null;
  };

  const counts = useMemo(() => {
    const c = { active: 0, scheduled: 0, expiring: 0, ended: 0 };
    for (const p of promotions) c[deriveState(p)] += 1;
    return c;
  }, [promotions]);

  const filtered = useMemo(() => {
    let rows = statusFilter === "all" ? promotions : promotions.filter((p) => deriveState(p) === statusFilter);
    if (couponOnly) rows = rows.filter((p) => p.requiresCoupon);
    if (cappedOnly) rows = rows.filter((p) => p.maxDiscountAmount !== null);
    const q = search.trim().toLowerCase();
    if (q !== "") {
      rows = rows.filter((p) => p.code.toLowerCase().includes(q) || p.nameAr.toLowerCase().includes(q));
    }
    return rows;
  }, [promotions, statusFilter, couponOnly, cappedOnly, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const activeFilterCount = (statusFilter === "all" ? 0 : 1) + (couponOnly ? 1 : 0) + (cappedOnly ? 1 : 0);

  function openCreate() {
    setEditingId(null);
    setDraft(blankDraft());
    setError(null);
    setPanelOpen(true);
  }

  function openEdit(p: PromotionDTO) {
    setEditingId(p.id);
    setDraft(draftFrom(p));
    setError(null);
    setPanelOpen(true);
  }

  function body() {
    const bundleComponents = draft.bundle
      .filter((row) => row.itemId !== "")
      .map((row) => ({ itemId: row.itemId, qty: row.qty.toFixed(6) }));
    return {
      code: draft.code.trim(),
      nameAr: draft.nameAr.trim(),
      type: draft.type,
      percentValue: draft.type === "percentage" ? draft.percentValue : null,
      amountValue:
        draft.type === "fixed_amount" || draft.type === "special_price" || draft.type === "bundle"
          ? (draft.amountValue ?? 0).toFixed(2)
          : null,
      minInvoiceValue: draft.minInvoiceValue === null ? null : draft.minInvoiceValue.toFixed(2),
      minQty: draft.minQty === null ? null : draft.minQty.toFixed(6),
      maxDiscountAmount: draft.maxDiscountAmount === null ? null : draft.maxDiscountAmount.toFixed(2),
      buyQty: draft.type === "buy_x_get_y" ? draft.buyQty : null,
      getQty: draft.type === "buy_x_get_y" ? draft.getQty : null,
      bundleComponents,
      priority: draft.priority,
      startDate: draft.startDate,
      endDate: draft.endDate,
      requiresCoupon: draft.requiresCoupon,
      active: draft.active,
      scope: { type: draft.scopeType, ids: draft.scopeType === "all" ? [] : draft.scopeIds },
    };
  }

  async function submit() {
    setError(null);
    if (draft.code.trim() === "" || draft.nameAr.trim() === "") {
      setError(t("promotions.error.codeAndName"));
      return;
    }
    try {
      if (editingId) await update.mutateAsync({ id: editingId, patch: body() });
      else await create.mutateAsync(body());
      setPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("promotions.error.saveFailed"));
    }
  }

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: promotions.length },
    { key: "active", label: t("promotions.state.active"), count: counts.active },
    { key: "scheduled", label: t("promotions.state.scheduled"), count: counts.scheduled },
    { key: "expiring", label: t("promotions.state.expiring"), count: counts.expiring },
    { key: "ended", label: t("promotions.state.ended"), count: counts.ended },
  ];

  const columns: DocumentListColumn<PromotionDTO>[] = [
    {
      key: "code",
      header: t("promotions.col.code"),
      render: (p) => (
        <div>
          <div className="mz-num font-semibold text-ink">{p.code}</div>
          <div className="text-[11px] text-ink-muted">{p.nameAr}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: t("common.type"),
      render: (p) => (
        <div>
          <div className="text-ink">{t(TYPE_KEY[p.type])}</div>
          <div className="text-[11px] text-ink-muted">{t(SCOPE_KEY[p.scope.type])}</div>
        </div>
      ),
    },
    {
      key: "value",
      header: t("promotions.col.value"),
      align: "end",
      render: (p) =>
        p.type === "percentage" ? (
          <span className="mz-num">{p.percentValue ?? 0}%</span>
        ) : p.type === "buy_x_get_y" ? (
          <span className="mz-num">{`${p.buyQty ?? 0} + ${p.getQty ?? 0}`}</span>
        ) : (
          <MoneyDisplay value={p.amountValue === null ? 0 : majorOf(p.amountValue)} />
        ),
    },
    {
      key: "minQty",
      header: t("promotions.col.minQty"),
      align: "end",
      render: (p) => <span className="mz-num">{p.minQty === null ? "—" : majorOf(p.minQty)}</span>,
    },
    {
      key: "cap",
      header: t("promotions.col.cap"),
      align: "end",
      render: (p) => (p.maxDiscountAmount === null ? "—" : <MoneyDisplay value={majorOf(p.maxDiscountAmount)} />),
    },
    { key: "period", header: t("common.period"), render: (p) => <span className="mz-num">{`${p.startDate} → ${p.endDate}`}</span> },
    { key: "priority", header: t("promotions.col.priority"), align: "end", render: (p) => <span className="mz-num">{p.priority}</span> },
    {
      key: "status",
      header: t("common.status"),
      render: (p) => {
        const s = deriveState(p);
        return (
          <div className="flex items-center gap-1.5">
            <StatusPill label={t(STATE_KEY[s])} tone={STATE_TONE[s]} />
            {p.requiresCoupon ? <StatusPill label={t("promotions.couponBadge")} tone="info" /> : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("promotions.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<PromotionDTO>
        title={t("promotions.title")}
        description={t("promotions.description")}
        actions={
          <Button variant="primary" onClick={openCreate}>
            {t("promotions.add")}
          </Button>
        }
        listKey="promotions"
        statsCollapsible
        stats={[
          { label: t("promotions.stat.total"), value: <span className="mz-num">{promotions.length}</span> },
          { label: t("promotions.state.active"), value: <span className="mz-num">{counts.active}</span> },
          { label: t("promotions.state.scheduled"), value: <span className="mz-num">{counts.scheduled}</span> },
          {
            label: t("promotions.stat.capped"),
            value: <span className="mz-num">{promotions.filter((p) => p.maxDiscountAmount !== null).length}</span>,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(k) => {
          setStatusFilter(k as "all" | DerivedState);
          setPage(1);
        }}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder={t("promotions.searchPlaceholder")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap items-center gap-[8px]">
            <Chip
              active={couponOnly}
              onClick={() => {
                setCouponOnly((on) => !on);
                setPage(1);
              }}
            >
              {t("promotions.filter.couponOnly")}
            </Chip>
            <Chip
              active={cappedOnly}
              onClick={() => {
                setCappedOnly((on) => !on);
                setPage(1);
              }}
            >
              {t("promotions.filter.cappedOnly")}
            </Chip>
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(p) => p.id}
        onRowClick={openEdit}
        rowAction={(p) => {
          const menuItems: RowMenuItem[] = [
            { key: "edit", label: t("promotions.row.edit"), onSelect: () => openEdit(p) },
            p.active
              ? {
                  key: "stop",
                  label: t("promotions.row.stop"),
                  tone: "danger" as const,
                  onSelect: () => void update.mutateAsync({ id: p.id, patch: { active: false } }),
                }
              : {
                  key: "resume",
                  label: t("promotions.row.resume"),
                  onSelect: () => void update.mutateAsync({ id: p.id, patch: { active: true } }),
                },
            {
              key: "raise",
              label: t("promotions.row.raisePriority"),
              onSelect: () => void update.mutateAsync({ id: p.id, patch: { priority: p.priority + 1 } }),
            },
          ];
          return <RowMenu items={menuItems} label={t("promotions.row.actionsFor", { promo: p.code })} />;
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
        pageSummary={
          <>
            {t("common.show")} <span className="mz-num">{pageRows.length}</span> {t("common.of")}{" "}
            <span className="mz-num">{promotions.length}</span> {t("promotions.showingSuffix")}
          </>
        }
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("common.loading")}</div>
          ) : (
            <EmptyState
              title={t("promotions.empty")}
              description={t("promotions.emptyBody")}
              action={{ label: t("promotions.add"), onClick: openCreate }}
            />
          )
        }
      />

      <div className="mt-[16px]">
        <PromotionUsageReport />
      </div>

      <SidePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={editingId ? t("promotions.panel.editTitle") : t("promotions.panel.title")}
      >
        <div className="flex flex-col gap-4 p-5">
          {error ? (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
              {error}
            </div>
          ) : null}

          <TextField label={t("promotions.field.code")} value={draft.code} onChange={(v) => setDraft((d) => ({ ...d, code: v }))} placeholder="SUMMER25" />
          <TextField
            label={t("promotions.field.name")}
            value={draft.nameAr}
            onChange={(v) => setDraft((d) => ({ ...d, nameAr: v }))}
            placeholder={t("promotions.field.namePlaceholder")}
          />
          <SelectField
            label={t("promotions.field.type")}
            value={draft.type}
            onChange={(v) => setDraft((d) => ({ ...d, type: v as PromotionTypeDTO }))}
            options={Object.entries(TYPE_KEY).map(([value, key]) => ({ value, label: t(key) }))}
          />

          {draft.type === "percentage" ? (
            <NumberField
              label={t("promotions.field.percent")}
              value={draft.percentValue}
              onChange={(v) => setDraft((d) => ({ ...d, percentValue: v }))}
              min={0}
              max={100}
            />
          ) : null}
          {draft.type === "fixed_amount" || draft.type === "special_price" || draft.type === "bundle" ? (
            <div>
              <div className="mb-[6px] text-[12.5px] font-semibold text-ink">
                {draft.type === "special_price"
                  ? t("promotions.field.specialPrice")
                  : draft.type === "bundle"
                    ? t("promotions.field.bundlePrice")
                    : t("promotions.field.amount")}
              </div>
              <MoneyInput
                value={draft.amountValue}
                onChange={(v) => setDraft((d) => ({ ...d, amountValue: v }))}
                aria-label={t("promotions.field.amount")}
              />
            </div>
          ) : null}
          {draft.type === "buy_x_get_y" ? (
            <div className="flex gap-[10px]">
              <div className="flex-1">
                <NumberField label={t("promotions.field.buyQty")} value={draft.buyQty} onChange={(v) => setDraft((d) => ({ ...d, buyQty: v }))} min={1} />
              </div>
              <div className="flex-1">
                <NumberField label={t("promotions.field.getQty")} value={draft.getQty} onChange={(v) => setDraft((d) => ({ ...d, getQty: v }))} min={1} />
              </div>
            </div>
          ) : null}

          {draft.type === "bundle" ? (
            <div className="rounded-lg border border-border p-[14px]">
              <div className="mb-[8px] flex items-center justify-between">
                <h3 className="font-display text-[13px] font-bold text-ink">{t("promotions.bundle.heading")}</h3>
                <Button size="sm" onClick={() => setDraft((d) => ({ ...d, bundle: [...d.bundle, blankBundleRow()] }))}>
                  {t("promotions.bundle.add")}
                </Button>
              </div>
              <p className="mb-[10px] text-[11.5px] text-ink-faint">{t("promotions.bundle.hint")}</p>
              <div className="flex flex-col gap-[8px]">
                {draft.bundle.map((row) => (
                  <div key={row.key} className="flex items-end gap-[8px]">
                    <div className="flex-1">
                      <EntityPicker
                        value={optionFor(row.itemId)}
                        onChange={(option) =>
                          setDraft((d) => ({
                            ...d,
                            bundle: d.bundle.map((r) => (r.key === row.key ? { ...r, itemId: option?.id ?? "" } : r)),
                          }))
                        }
                        options={itemOptions}
                        placeholder={t("promotions.bundle.chooseItem")}
                        aria-label={t("common.item")}
                      />
                    </div>
                    <div className="w-[110px]">
                      <QtyInput
                        value={row.qty}
                        min={1}
                        onChange={(v) =>
                          setDraft((d) => ({ ...d, bundle: d.bundle.map((r) => (r.key === row.key ? { ...r, qty: v } : r)) }))
                        }
                        aria-label={t("common.qty")}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => setDraft((d) => ({ ...d, bundle: d.bundle.filter((r) => r.key !== row.key) }))}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <SelectField
            label={t("promotions.field.scope")}
            value={draft.scopeType}
            onChange={(v) => setDraft((d) => ({ ...d, scopeType: v as PromotionScopeDTO["type"], scopeIds: [] }))}
            options={Object.entries(SCOPE_KEY).map(([value, key]) => ({ value, label: t(key) }))}
          />
          {draft.scopeType === "item" ? (
            <div className="rounded-lg border border-border p-[14px]">
              <h3 className="mb-[8px] font-display text-[13px] font-bold text-ink">{t("promotions.scope.itemsHeading")}</h3>
              <div className="mb-[8px] flex flex-col gap-[6px]">
                {draft.scopeIds.map((id) => (
                  <div key={id} className="flex items-center justify-between rounded-md border border-border px-[10px] py-[7px] text-[12.5px]">
                    <span className="text-ink">{itemById.get(id)?.nameAr ?? id}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDraft((d) => ({ ...d, scopeIds: d.scopeIds.filter((x) => x !== id) }))}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                ))}
              </div>
              <EntityPicker
                value={null}
                onChange={(option) => {
                  if (!option) return;
                  setDraft((d) => (d.scopeIds.includes(option.id) ? d : { ...d, scopeIds: [...d.scopeIds, option.id] }));
                }}
                options={itemOptions}
                placeholder={t("promotions.scope.addItem")}
                aria-label={t("promotions.scope.addItem")}
              />
            </div>
          ) : null}

          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("promotions.field.minInvoiceValue")}</div>
            <MoneyInput
              value={draft.minInvoiceValue}
              onChange={(v) => setDraft((d) => ({ ...d, minInvoiceValue: v }))}
              aria-label={t("promotions.field.minInvoiceValue")}
            />
          </div>
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("promotions.field.minQty")}</div>
            <QtyInput
              value={draft.minQty ?? 0}
              min={0}
              onChange={(v) => setDraft((d) => ({ ...d, minQty: v <= 0 ? null : v }))}
              aria-label={t("promotions.field.minQty")}
            />
            <div className="mt-[6px] text-[11.5px] text-ink-faint">{t("promotions.field.minQtyHint")}</div>
          </div>
          <div>
            <div className="mb-[6px] text-[12.5px] font-semibold text-ink">{t("promotions.field.cap")}</div>
            <MoneyInput
              value={draft.maxDiscountAmount}
              onChange={(v) => setDraft((d) => ({ ...d, maxDiscountAmount: v }))}
              aria-label={t("promotions.field.cap")}
            />
            <div className="mt-[6px] text-[11.5px] text-ink-faint">{t("promotions.field.capHint")}</div>
          </div>

          <NumberField
            label={t("promotions.field.priority")}
            value={draft.priority}
            onChange={(v) => setDraft((d) => ({ ...d, priority: v }))}
            min={0}
            hint={t("promotions.field.priorityHint")}
          />
          <TextField label={t("promotions.field.startDate")} value={draft.startDate} onChange={(v) => setDraft((d) => ({ ...d, startDate: v }))} placeholder="YYYY-MM-DD" />
          <TextField label={t("promotions.field.endDate")} value={draft.endDate} onChange={(v) => setDraft((d) => ({ ...d, endDate: v }))} placeholder="YYYY-MM-DD" />
          <ToggleField
            label={t("promotions.field.requiresCoupon")}
            checked={draft.requiresCoupon}
            onChange={(v) => setDraft((d) => ({ ...d, requiresCoupon: v }))}
            hint={t("promotions.field.requiresCouponHint")}
          />
          {editingId ? (
            <ToggleField label={t("common.active")} checked={draft.active} onChange={(v) => setDraft((d) => ({ ...d, active: v }))} />
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => setPanelOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={create.isPending || update.isPending || !draft.code.trim() || !draft.nameAr.trim()}
            >
              {editingId ? t("promotions.saveEdits") : t("common.add")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

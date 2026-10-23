import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Chip,
  DocumentList,
  EmptyState,
  Money as MoneyDisplay,
  MoneyInput,
  QtyInput,
  RowMenu,
  SidePanel,
  StatusPill,
  TextArea,
  type DocumentListColumn,
  type DocumentListStatusChip,
  type RowMenuItem,
} from "@mezan/ui";
import type { ItemDTO, PriceListDTO, PriceListLineDTO } from "@mezan/contracts";
import { Field, TextField, ToggleField } from "../settings/form-controls";
import { useCreatePriceList, useItemsByIds, usePriceLists, useUpdatePriceList } from "../data/hooks";
import { ItemPicker, itemOption } from "./ItemPicker";
import { useNameSubPage, useSubPage } from "../navigation";
import { useAppTranslation } from "../i18n";
import { majorOf } from "../lib/money";
import { Money, Qty, roundMoney } from "@mezan/domain";
import { EMPTY } from "../lib/empty";
import { useUrlNumber, useUrlParam, useUrlSearch } from "../lib/url-state";

/**
 * قوائم الأسعار (Price Lists — docs/archive/catalog/01). Real data only: the list, the
 * create form and every count on this screen come from `GET/POST/PATCH
 * /price-lists` through TanStack Query — no sample arrays.
 *
 * A list quotes an item once per MINIMUM-QUANTITY tier (R3.11): 100.00 from 1,
 * 85.00 from 50. The tier a line lands on is chosen server-side by
 * `resolvePriceTier`, so the grid here edits the thresholds and never decides
 * which one an invoice takes.
 */

const PAGE_SIZES = [10, 25, 50, 100] as const;

interface TierDraft {
  key: string;
  itemId: string;
  unitCode: string;
  minQty: string;
  price: string | null;
  item?: ItemDTO;
}

let tierSeq = 0;
function tierKey(): string {
  tierSeq += 1;
  return `t${tierSeq}`;
}

function typedDecimal(value: number): string | null {
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  return fraction === "" ? whole : `${whole}.${fraction.slice(0, 6)}`;
}

function typedPrice(value: number | null): string | null {
  const text = value === null ? null : typedDecimal(value);
  return text === null ? null : roundMoney(Money.fromMajor(text), 2).toString();
}

function typedQty(value: number): string {
  return Qty.fromMajor(typedDecimal(value) ?? "0").toString();
}

function draftFrom(list: PriceListDTO): TierDraft[] {
  return list.lines.map((line) => ({
    key: tierKey(),
    itemId: line.itemId,
    unitCode: line.unitCode ?? "",
    minQty: Qty.fromMajor(line.minQty).toString(),
    price: Money.fromMajor(line.price).toString(),
  }));
}

/**
 * The tier grid for one list — item, unit, minimum quantity, the item's own
 * base price, and the custom price this list charges from that quantity up.
 */
function PriceListTiers({ list }: { list: PriceListDTO }) {
  const { t } = useAppTranslation();
  const update = useUpdatePriceList();
  const [tiers, setTiers] = useState<TierDraft[]>(() => draftFrom(list));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTiers(draftFrom(list));
    setError(null);
    setSaved(false);
  }, [list]);

  const { byId: itemById } = useItemsByIds(tiers.map((row) => row.itemId));

  function setTier(key: string, patch: Partial<TierDraft>) {
    setTiers((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addTier() {
    setTiers((rows) => [...rows, { key: tierKey(), itemId: "", unitCode: "", minQty: Qty.fromMajor("1").toString(), price: null }]);
    setSaved(false);
  }

  async function save() {
    setError(null);
    setSaved(false);
    const rows = tiers.filter((row) => row.itemId !== "");
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.itemId}@${row.minQty}`;
      if (seen.has(key)) {
        setError(t("priceLists.tier.duplicate"));
        return;
      }
      seen.add(key);
    }
    const lines: PriceListLineDTO[] = rows.map((row) => ({
      itemId: row.itemId,
      unitCode: row.unitCode.trim() === "" ? null : row.unitCode.trim(),
      minQty: row.minQty,
      price: row.price ?? Money.zero().toString(),
    }));
    try {
      await update.mutateAsync({ id: list.id, patch: { lines } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("priceLists.tier.saveFailed"));
    }
  }

  return (
    <Card className="p-[18px_20px]">
      <div className="mb-[10px] flex flex-wrap items-center justify-between gap-[10px]">
        <div>
          <h2 className="font-display text-[15px] font-bold text-ink">{t("priceLists.tier.heading")}</h2>
          <p className="mt-[3px] max-w-[62ch] text-[12.5px] text-ink-muted">{t("priceLists.tier.hint")}</p>
        </div>
        <Button onClick={addTier}>{t("priceLists.tier.add")}</Button>
      </div>

      {tiers.length === 0 ? (
        <EmptyState
          title={t("priceLists.tier.emptyTitle")}
          description={t("priceLists.tier.emptyBody")}
          action={{ label: t("priceLists.tier.add"), onClick: addTier }}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-[12px] text-ink-muted">
                <th className="p-[10px] text-start font-semibold">{t("common.item")}</th>
                <th className="p-[10px] text-start font-semibold">{t("priceLists.tier.unit")}</th>
                <th className="p-[10px] text-start font-semibold">{t("priceLists.tier.minQty")}</th>
                <th className="p-[10px] text-end font-semibold">{t("priceLists.tier.basePrice")}</th>
                <th className="p-[10px] text-end font-semibold">{t("priceLists.tier.customPrice")}</th>
                <th className="p-[10px] text-end font-semibold">{t("priceLists.tier.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((row) => {
                const item = row.item ?? itemById.get(row.itemId) ?? null;
                const basePrice = item?.salePrice ?? 0;
                return (
                  <tr key={row.key} className="border-b border-border align-top">
                    <td className="p-[8px_10px]">
                      <ItemPicker
                        value={item ? itemOption(item) : row.itemId ? { id: row.itemId, label: row.itemId } : null}
                        onChange={(picked) =>
                          setTier(row.key, {
                            itemId: picked?.id ?? "",
                            item: picked ?? undefined,
                            unitCode: picked ? picked.baseUnitCode : row.unitCode,
                          })
                        }
                        placeholder={t("priceLists.tier.chooseItem")}
                        ariaLabel={t("common.item")}
                      />
                    </td>
                    <td className="p-[8px_10px] text-ink-muted">{row.unitCode || item?.baseUnitCode || "—"}</td>
                    <td className="p-[8px_10px]">
                      <QtyInput
                        value={majorOf(row.minQty)}
                        min={0}
                        onChange={(v) => setTier(row.key, { minQty: typedQty(v) })}
                        aria-label={t("priceLists.tier.minQty")}
                      />
                    </td>
                    <td className="p-[8px_10px] text-end">
                      <MoneyDisplay value={basePrice} />
                    </td>
                    <td className="p-[8px_10px] text-end">
                      <MoneyInput
                        value={row.price === null ? null : majorOf(row.price)}
                        onChange={(v) => setTier(row.key, { price: typedPrice(v) })}
                        aria-label={t("priceLists.tier.customPrice")}
                      />
                    </td>
                    <td className="p-[8px_10px] text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTiers((rows) => rows.filter((r) => r.key !== row.key))}
                      >
                        {t("common.delete")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {error ? (
        <div role="alert" className="mt-[12px] rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink">
          {error}
        </div>
      ) : null}
      {saved ? <div className="mt-[12px] text-[12.5px] text-success-ink">{t("priceLists.tier.saved")}</div> : null}

      <div className="mt-[14px] flex justify-end">
        <Button variant="primary" onClick={save} disabled={update.isPending}>
          {t("priceLists.tier.save")}
        </Button>
      </div>
    </Card>
  );
}

export function PriceListsScreen() {
  const { t } = useAppTranslation();
  const query = usePriceLists();
  const priceLists = query.data ?? EMPTY;
  const create = useCreatePriceList();
  const update = useUpdatePriceList();

  const subPage = useSubPage();
  const [selectedId] = subPage.segments;

  const [panelOpen, setPanelOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [description, setDescription] = useState("");
  const [isBase, setIsBase] = useState(false);

  const [searchText, setSearchText, search] = useUrlSearch();
  const [statusFilter, setStatusFilter] = useUrlParam("status", "all") as [
    "all" | "active" | "inactive",
    (next: string) => void,
  ];
  const [baseOnly, setBaseOnly] = useState(false);
  const [page, setPage] = useUrlNumber("page", 1);
  const [pageSize, setPageSize] = useUrlNumber("size", 25);

  function resetForm() {
    setCode("");
    setNameAr("");
    setDescription("");
    setIsBase(false);
  }

  async function submit() {
    if (!code.trim() || !nameAr.trim()) return;
    try {
      await create.mutateAsync({ code: code.trim(), nameAr: nameAr.trim(), description: description.trim() || null, isBase });
    } catch {
      // The panel stays open on the draft, and `create.isError` below renders
      // the server's message. Swallowed here because nothing awaits submit():
      // an escaping rejection is an unhandled one (D124).
      return;
    }
    setPanelOpen(false);
    resetForm();
  }

  const filtered = useMemo(() => {
    let rows = priceLists;
    if (statusFilter !== "all") rows = rows.filter((pl) => (statusFilter === "active" ? pl.active : !pl.active));
    if (baseOnly) rows = rows.filter((pl) => pl.isBase);
    const q = search.trim().toLowerCase();
    if (q !== "") {
      rows = rows.filter(
        (pl) => pl.nameAr.toLowerCase().includes(q) || pl.code.toLowerCase().includes(q) || (pl.nameEn ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [priceLists, statusFilter, baseOnly, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount, setPage]);

  const activeFilterCount = (statusFilter === "all" ? 0 : 1) + (baseOnly ? 1 : 0);

  const statusChips: DocumentListStatusChip[] = [
    { key: "all", label: t("common.all"), count: priceLists.length },
    { key: "active", label: t("priceLists.active"), count: priceLists.filter((pl) => pl.active).length },
    { key: "inactive", label: t("priceLists.inactive"), count: priceLists.filter((pl) => !pl.active).length },
  ];

  const selected = selectedId ? (priceLists.find((pl) => pl.id === selectedId || pl.code === selectedId) ?? null) : null;
  useNameSubPage(selectedId, selected ? selected.code : null);

  const columns: DocumentListColumn<PriceListDTO>[] = [
    {
      key: "name",
      header: t("priceLists.col.name"),
      render: (pl) => (
        <div>
          <div className="font-semibold text-ink">{pl.nameAr}</div>
          <div className="mz-num text-[11px] text-ink-muted">{pl.code}</div>
        </div>
      ),
    },
    { key: "description", header: t("priceLists.col.description"), render: (pl) => pl.description ?? "—" },
    {
      key: "lines",
      header: t("priceLists.col.items"),
      align: "end",
      render: (pl) => <span className="mz-num">{new Set(pl.lines.map((l) => l.itemId)).size}</span>,
    },
    {
      key: "tiers",
      header: t("priceLists.col.tiers"),
      align: "end",
      render: (pl) => <span className="mz-num">{pl.lines.length}</span>,
    },
    {
      key: "status",
      header: t("priceLists.col.status"),
      render: (pl) => (
        <div className="flex items-center gap-1.5">
          <StatusPill label={pl.active ? t("priceLists.active") : t("priceLists.inactive")} tone={pl.active ? "success" : "neutral"} />
          {pl.isBase ? <StatusPill label={t("priceLists.base")} tone="info" /> : null}
        </div>
      ),
    },
  ];

  if (selected) {
    return (
      <div className="w-full">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t("priceLists.title")}</div>
            <h1 className="font-display text-xl font-bold text-ink">{selected.nameAr}</h1>
            <p className="mt-[4px] text-[12.5px] text-ink-muted">{selected.description ?? t("priceLists.detail.noDescription")}</p>
          </div>
        </div>

        {/* The card selector: every list, the active one raised, the base one badged. */}
        <div className="mb-[16px] flex flex-wrap gap-[10px]">
          {priceLists.map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => subPage.open(pl.id)}
              aria-current={pl.id === selected.id ? "true" : undefined}
              className={
                pl.id === selected.id
                  ? "min-w-[180px] rounded-lg border-2 border-accent bg-accent-soft p-[12px_14px] text-start"
                  : "min-w-[180px] rounded-lg border border-border bg-surface p-[12px_14px] text-start hover:border-accent"
              }
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-semibold text-ink">{pl.nameAr}</span>
                {pl.isBase ? <StatusPill label={t("priceLists.base")} tone="info" /> : null}
              </div>
              <div className="mz-num mt-[4px] text-[11px] text-ink-faint">
                {pl.code} · {t("priceLists.tier.count", { count: pl.lines.length })}
              </div>
            </button>
          ))}
        </div>

        <PriceListTiers list={selected} />
      </div>
    );
  }

  return (
    <div className="w-full">
      {query.isError ? (
        <Card className="mb-[18px] p-[18px_20px]">
          <p className="text-[13px] font-semibold text-danger-ink">{query.error?.message ?? t("priceLists.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}
      <DocumentList<PriceListDTO>
        loadFailed={query.isError}
        title={t("priceLists.title")}
        description={t("priceLists.description")}
        actions={
          <Button variant="primary" onClick={() => setPanelOpen(true)}>
            {t("priceLists.new")}
          </Button>
        }
        listKey="price-lists"
        statsCollapsible
        stats={[
          { label: t("priceLists.stat.total"), value: <span className="mz-num">{priceLists.length}</span> },
          { label: t("priceLists.stat.active"), value: <span className="mz-num">{priceLists.filter((p) => p.active).length}</span> },
          {
            label: t("priceLists.stat.tiers"),
            value: <span className="mz-num">{priceLists.reduce((sum, pl) => sum + pl.lines.length, 0)}</span>,
          },
        ]}
        statusChips={statusChips}
        activeStatusKey={statusFilter}
        onStatusChange={(key) => {
          setStatusFilter(key as typeof statusFilter);
          setPage(1);
        }}
        searchValue={searchText}
        onSearchChange={(value) => {
          setSearchText(value);
          setPage(1);
        }}
        searchPlaceholder={t("priceLists.searchPlaceholder")}
        filterBarCollapsible
        activeFilterCount={activeFilterCount}
        filterBarExtra={
          <div className="flex flex-wrap items-center gap-[8px]">
            <Chip
              toggle
              active={baseOnly}
              onClick={() => {
                setBaseOnly((on) => !on);
                setPage(1);
              }}
            >
              {t("priceLists.filter.baseOnly")}
            </Chip>
          </div>
        }
        columns={columns}
        rows={pageRows}
        loading={query.isLoading}
        rowKey={(pl) => pl.id}
        onRowClick={(pl) => subPage.open(pl.id)}
        rowAction={(pl) => {
          const menuItems: RowMenuItem[] = [
            { key: "prices", label: t("priceLists.row.managePrices"), onSelect: () => subPage.open(pl.id) },
            pl.active
              ? {
                  key: "deactivate",
                  label: t("priceLists.row.deactivate"),
                  tone: "danger" as const,
                  onSelect: () => void update.mutateAsync({ id: pl.id, patch: { active: false } }),
                }
              : {
                  key: "activate",
                  label: t("priceLists.row.activate"),
                  onSelect: () => void update.mutateAsync({ id: pl.id, patch: { active: true } }),
                },
            ...(pl.isBase
              ? []
              : [
                  {
                    key: "make-base",
                    label: t("priceLists.row.makeBase"),
                    onSelect: () => void update.mutateAsync({ id: pl.id, patch: { isBase: true } }),
                  },
                ]),
          ];
          return <RowMenu items={menuItems} label={t("priceLists.row.actionsFor", { list: pl.nameAr })} />;
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
            {t("priceLists.showingPrefix")} <span className="mz-num">{pageRows.length}</span> {t("priceLists.showingOf")}{" "}
            <span className="mz-num">{priceLists.length}</span> {t("priceLists.showingSuffix")}
          </>
        }
        emptyState={
          query.isLoading ? (
            <div className="p-8 text-center text-sm text-ink-muted">{t("priceLists.loading")}</div>
          ) : (
            <EmptyState
              title={t("priceLists.empty")}
              description={t("priceLists.emptyBody")}
              action={{ label: t("priceLists.new"), onClick: () => setPanelOpen(true) }}
            />
          )
        }
      />

      <SidePanel open={panelOpen} onClose={() => setPanelOpen(false)} title={t("priceLists.new")}>
        <div className="flex flex-col gap-4 p-5">
          <TextField label={t("priceLists.field.name")} value={nameAr} onChange={setNameAr} placeholder={t("priceLists.field.namePlaceholder")} />
          <TextField label={t("priceLists.field.code")} value={code} onChange={setCode} placeholder="PL-001" />
          <Field label={t("priceLists.field.description")}>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <ToggleField label={t("priceLists.field.isBase")} checked={isBase} onChange={setIsBase} hint={t("priceLists.field.isBaseHint")} />

          {create.isError ? (
            <div className="rounded-[8px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{create.error.message}</div>
          ) : null}

          <div className="flex gap-2 pt-2">
            <Button variant="default" onClick={() => setPanelOpen(false)}>
              {t("priceLists.cancel")}
            </Button>
            <Button variant="primary" onClick={submit} disabled={create.isPending || !code.trim() || !nameAr.trim()}>
              {t("priceLists.save")}
            </Button>
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

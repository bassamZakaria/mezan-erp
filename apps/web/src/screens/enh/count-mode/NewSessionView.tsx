import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { ENGLISH_LOCALE, Button, Card } from "@mezan/ui";
import { CountZoneKindDTO, type CountZoneSpecDTO, type ItemDTO, type StartCountModeDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";
import { useNavigation } from "../../../navigation";
import { ApiError, useItemCategories, useItemSearch, useWarehouses } from "../../../data/hooks";
import { SelectField, TextField, ToggleField, MultiChipField } from "../../../settings/form-controls";
import { todayIso } from "../../../lib/dates";
import { useSearchTerm } from "../../../lib/use-debounced";
import { useCountModeCounters, useStartCountMode } from "./hooks";

interface ZoneDraft {
  readonly key: string;
  readonly name: string;
  readonly kind: CountZoneKindDTO;
  readonly categoryId: string;
  readonly itemIds: readonly string[];
  readonly counterUserIds: readonly string[];
}

const SEARCH_RESULT_LIMIT = 12;

function blankZone(): ZoneDraft {
  return { key: crypto.randomUUID(), name: "", kind: CountZoneKindDTO.Category, categoryId: "", itemIds: [], counterUserIds: [] };
}

function ItemSearch({ selected, onChange }: { selected: readonly string[]; onChange: (ids: readonly string[]) => void }) {
  const { t, locale } = useAppTranslation();
  const [query, setQuery] = useState("");
  const [byId, setById] = useState<ReadonlyMap<string, ItemDTO>>(new Map());
  const { term, pending } = useSearchTerm(query);
  const search = useItemSearch(term);
  const matches = useMemo(() => {
    if (term === "" || pending || search.isFetching) return [];
    return (search.data ?? []).filter((item) => !selected.includes(item.id)).slice(0, SEARCH_RESULT_LIMIT);
  }, [search.data, search.isFetching, term, pending, selected]);
  const nameOf = (id: string) => {
    const item = byId.get(id);
    if (!item) return id;
    return locale === ENGLISH_LOCALE && item.nameEn ? item.nameEn : item.nameAr;
  };
  return (
    <div className="flex flex-col gap-[8px]">
      <TextField label={t("countMode.new.searchItems")} value={query} onChange={setQuery} placeholder={t("countMode.new.searchItemsPlaceholder")} />
      {matches.length > 0 ? (
        <ul className="divide-y divide-border rounded-md border border-border">
          {matches.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex min-h-[44px] w-full items-center justify-between gap-[8px] px-[12px] text-start text-[13px] hover:bg-surface-2"
                onClick={() => {
                  setById((known) => new Map(known).set(item.id, item));
                  onChange([...selected, item.id]);
                  setQuery("");
                }}
              >
                <span className="truncate">{locale === ENGLISH_LOCALE && item.nameEn ? item.nameEn : item.nameAr}</span>
                <span className="mz-num text-[12px] text-ink-muted">{item.code}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected.length > 0 ? (
        <ul className="flex flex-wrap gap-[6px]" aria-label={t("countMode.new.selectedItems")}>
          {selected.map((id) => (
            <li key={id}>
              <button type="button" className="inline-flex min-h-[36px] items-center gap-[6px] rounded-pill border border-border-strong bg-surface-2 px-[10px] text-[12px]" onClick={() => onChange(selected.filter((x) => x !== id))} aria-label={t("countMode.new.removeItem", { name: nameOf(id) })}>
                {nameOf(id)}
                <X aria-hidden className="h-[12px] w-[12px]" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function NewSessionView() {
  const { t, locale } = useAppTranslation();
  const { openSubPage } = useNavigation();
  const warehousesQuery = useWarehouses();
  const categoriesQuery = useItemCategories();
  const countersQuery = useCountModeCounters(true);
  const start = useStartCountMode();
  const warehouses = warehousesQuery.data ?? [];
  const [warehouseId, setWarehouseId] = useState("");
  const [date, setDate] = useState(todayIso());
  const [memo, setMemo] = useState("");
  const [blind, setBlind] = useState(true);
  const [zones, setZones] = useState<readonly ZoneDraft[]>(() => [blankZone()]);
  const [error, setError] = useState<string | null>(null);

  const effectiveWarehouse = warehouseId || warehouses[0]?.id || "";
  const categoryOptions = [{ value: "", label: t("countMode.new.chooseCategory") }, ...(categoriesQuery.data ?? []).map((c) => ({ value: c.id, label: locale === ENGLISH_LOCALE && c.nameEn ? c.nameEn : c.nameAr }))];
  const counterOptions = (countersQuery.data ?? []).map((c) => ({ value: c.userId, label: c.name }));

  function patchZone(key: string, next: Partial<ZoneDraft>) {
    setZones((list) => list.map((zone) => (zone.key === key ? { ...zone, ...next } : zone)));
  }

  const ready =
    effectiveWarehouse !== "" &&
    zones.length > 0 &&
    zones.every((z) => z.name.trim() !== "" && z.counterUserIds.length > 0 && (z.kind === CountZoneKindDTO.Category ? z.categoryId !== "" : z.itemIds.length > 0));

  async function submit() {
    setError(null);
    const body: StartCountModeDTO = {
      warehouseId: effectiveWarehouse,
      date,
      memo: memo.trim() === "" ? undefined : memo.trim(),
      blind,
      zones: zones.map(
        (z): CountZoneSpecDTO => ({
          name: z.name.trim(),
          kind: z.kind,
          counterUserIds: [...z.counterUserIds],
          ...(z.kind === CountZoneKindDTO.Category ? { categoryId: z.categoryId } : { itemIds: [...z.itemIds] }),
        }),
      ),
    };
    try {
      const session = await start.mutateAsync(body);
      openSubPage([session.id]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("countMode.startFailed"));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-[14px]">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("countMode.new.title")}</h1>
        <p className="mt-[4px] text-[12.5px] text-ink-muted">{t("countMode.new.subtitle")}</p>
      </div>
      <Card className="flex flex-col gap-[12px] p-[16px]">
        <SelectField label={t("countMode.new.warehouse")} value={effectiveWarehouse} onChange={setWarehouseId} options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        <TextField label={t("countMode.new.date")} value={date} onChange={setDate} placeholder="YYYY-MM-DD" />
        <TextField label={t("countMode.new.memo")} value={memo} onChange={setMemo} />
        <ToggleField label={t("countMode.new.blind")} checked={blind} onChange={setBlind} hint={t("countMode.new.blindHint")} />
      </Card>

      {zones.map((zone, index) => (
        <Card key={zone.key} className="flex flex-col gap-[12px] p-[16px]">
          <div className="flex items-center justify-between gap-[8px]">
            <h2 className="text-[14px] font-semibold text-ink">{t("countMode.new.zoneHeading", { n: index + 1 })}</h2>
            {zones.length > 1 ? (
              <Button size="sm" variant="danger-outline" onClick={() => setZones((list) => list.filter((z) => z.key !== zone.key))} aria-label={t("countMode.new.removeZone", { n: index + 1 })}>
                <Trash2 aria-hidden className="h-[14px] w-[14px]" />
                {t("countMode.new.remove")}
              </Button>
            ) : null}
          </div>
          <TextField label={t("countMode.new.zoneName")} value={zone.name} onChange={(name) => patchZone(zone.key, { name })} placeholder={t("countMode.new.zoneNamePlaceholder")} />
          <SelectField
            label={t("countMode.new.zoneKind")}
            value={zone.kind}
            onChange={(kind) => patchZone(zone.key, { kind: kind as CountZoneKindDTO })}
            options={[
              { value: CountZoneKindDTO.Category, label: t("countMode.new.kindCategory") },
              { value: CountZoneKindDTO.AdHoc, label: t("countMode.new.kindAdHoc") },
            ]}
          />
          {zone.kind === CountZoneKindDTO.Category ? (
            <SelectField label={t("countMode.new.category")} value={zone.categoryId} onChange={(categoryId) => patchZone(zone.key, { categoryId })} options={categoryOptions} hint={t("countMode.new.categoryHint")} />
          ) : (
            <ItemSearch selected={zone.itemIds} onChange={(itemIds) => patchZone(zone.key, { itemIds })} />
          )}
          <MultiChipField label={t("countMode.new.counters")} hint={counterOptions.length === 0 ? t("countMode.new.noCounters") : t("countMode.new.countersHint")} options={counterOptions} value={[...zone.counterUserIds]} onChange={(counterUserIds) => patchZone(zone.key, { counterUserIds })} />
        </Card>
      ))}

      <div>
        <Button onClick={() => setZones((list) => [...list, blankZone()])}>
          <Plus aria-hidden className="h-[14px] w-[14px]" />
          {t("countMode.new.addZone")}
        </Button>
      </div>

      {error ? (
        <div role="alert" className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[13px] text-danger-ink">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-[9px]">
        <Button onClick={() => openSubPage([])}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!ready || start.isPending} onClick={() => void submit()}>
          {start.isPending ? t("countMode.new.starting") : t("countMode.new.start")}
        </Button>
      </div>
    </div>
  );
}

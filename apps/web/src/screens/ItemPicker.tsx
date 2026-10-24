import { useState } from "react";
import { EntityPicker, type EntityPickerOption } from "@mezan/ui";
import type { ItemDTO } from "@mezan/contracts";
import { ITEM_TYPES, ItemStatusCode, itemTypeIsBomComponent, itemTypeIsPurchasable, itemTypeIsSellable, itemTypeTracksStock } from "@mezan/domain";
import { useItemSearch, useItemsByIds, type ItemSearchFilter } from "../data/hooks";
import { useSearchTerm } from "../lib/use-debounced";

export const STOCKED_ITEMS: ItemSearchFilter = { types: ITEM_TYPES.filter(itemTypeTracksStock) };
export const PURCHASABLE_ITEMS: ItemSearchFilter = { types: ITEM_TYPES.filter(itemTypeIsPurchasable) };
export const SELLABLE_ITEMS: ItemSearchFilter = { status: ItemStatusCode.Active, types: ITEM_TYPES.filter(itemTypeIsSellable) };
export const BOM_COMPONENT_ITEMS: ItemSearchFilter = { types: ITEM_TYPES.filter(itemTypeIsBomComponent) };
export const ACTIVE_ITEMS: ItemSearchFilter = { status: ItemStatusCode.Active };
export const LOT_TRACKED_ITEMS: ItemSearchFilter = { lotTracked: true };

export interface ItemPickerProps {
  readonly value: EntityPickerOption | null;
  readonly onChange: (item: ItemDTO | null) => void;
  readonly filter?: ItemSearchFilter;
  readonly accept?: (item: ItemDTO) => boolean;
  readonly sublabel?: (item: ItemDTO) => string | undefined;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly emptyMessage?: string;
  readonly id?: string;
  readonly className?: string;
}

export function itemOption(item: Pick<ItemDTO, "id" | "nameAr" | "code">): EntityPickerOption {
  return { id: item.id, label: item.nameAr, sublabel: item.code };
}

export function ItemPicker({ value, onChange, filter, accept, sublabel, ...rest }: ItemPickerProps) {
  const [query, setQuery] = useState("");
  const { term, pending } = useSearchTerm(query);
  const search = useItemSearch(term, filter);
  const matches = (search.data ?? []).filter((item) => !accept || accept(item));
  const options = matches.map((item) => ({ ...itemOption(item), sublabel: sublabel ? sublabel(item) : item.code }));
  return (
    <EntityPicker
      {...rest}
      value={value}
      options={options}
      onQueryChange={setQuery}
      loading={pending || search.isFetching}
      error={search.isError}
      onChange={(option) => onChange(option ? (matches.find((item) => item.id === option.id) ?? null) : null)}
    />
  );
}

export interface LineItems {
  readonly itemOf: (id: string) => ItemDTO | undefined;
  readonly itemName: (id: string) => string;
  readonly itemValue: (id: string) => EntityPickerOption | null;
  readonly remember: (item: ItemDTO | null) => void;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

export function useLineItems(ids: readonly (string | null | undefined)[]): LineItems {
  const [picked, setPicked] = useState<ReadonlyMap<string, ItemDTO>>(new Map());
  const fetched = useItemsByIds(ids);
  const itemOf = (id: string) => picked.get(id) ?? fetched.byId.get(id);
  return {
    itemOf,
    itemName: (id) => itemOf(id)?.nameAr ?? id,
    itemValue: (id) => {
      if (id === "") return null;
      const item = itemOf(id);
      return item ? itemOption(item) : { id, label: id };
    },
    remember: (item) => {
      if (item) setPicked((prev) => new Map(prev).set(item.id, item));
    },
    isLoading: fetched.isLoading,
    isError: fetched.isError,
  };
}

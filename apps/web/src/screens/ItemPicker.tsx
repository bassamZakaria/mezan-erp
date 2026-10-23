import { useState } from "react";
import { EntityPicker, type EntityPickerOption } from "@mezan/ui";
import type { ItemDTO } from "@mezan/contracts";
import { useItemSearch, type ItemSearchFilter } from "../data/hooks";

export interface ItemPickerProps {
  /** The chosen item as the row already knows it: its real id and the name to show. */
  readonly value: EntityPickerOption | null;
  readonly onChange: (item: ItemDTO | null) => void;
  readonly filter?: ItemSearchFilter;
  /** Narrows the server's matches further when the API has no filter for the rule. */
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
  const search = useItemSearch(query, filter);
  const matches = (search.data ?? []).filter((item) => !accept || accept(item));
  const options = matches.map((item) => ({ ...itemOption(item), sublabel: sublabel ? sublabel(item) : item.code }));
  return (
    <EntityPicker
      {...rest}
      value={value}
      options={options}
      onQueryChange={setQuery}
      loading={search.isFetching}
      onChange={(option) => onChange(option ? (matches.find((item) => item.id === option.id) ?? null) : null)}
    />
  );
}

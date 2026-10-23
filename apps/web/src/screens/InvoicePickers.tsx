import { useState } from "react";
import { EntityPicker, type EntityPickerOption } from "@mezan/ui";
import type { PurchaseInvoiceDTO, PurchaseInvoiceListQueryDTO, SalesInvoiceDTO, SalesInvoiceListQueryDTO } from "@mezan/contracts";
import { usePurchaseInvoices, useSalesInvoices } from "../data/hooks";
import { useSearchTerm } from "../lib/use-debounced";

const INVOICE_SEARCH_PAGE_SIZE = 20;

interface InvoicePickerProps<T> {
  readonly value: T | null;
  readonly onChange: (invoice: T | null) => void;
  readonly optionOf: (invoice: T) => EntityPickerOption;
  readonly accept?: (invoice: T) => boolean;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly emptyMessage?: string;
  readonly id?: string;
  readonly className?: string;
}

interface SearchResult<T> {
  readonly data?: T[];
  readonly isFetching: boolean;
  readonly isError: boolean;
}

function SearchPicker<T extends { readonly id: string }>({
  value,
  onChange,
  optionOf,
  accept,
  search,
  pending,
  onQueryChange,
  ...rest
}: InvoicePickerProps<T> & { readonly search: SearchResult<T>; readonly pending: boolean; readonly onQueryChange: (query: string) => void }) {
  const matches = (search.data ?? []).filter((invoice) => !accept || accept(invoice));
  return (
    <EntityPicker
      {...rest}
      value={value ? optionOf(value) : null}
      options={matches.map(optionOf)}
      onQueryChange={onQueryChange}
      loading={pending || search.isFetching}
      error={search.isError}
      onChange={(option) => onChange(option ? (matches.find((invoice) => invoice.id === option.id) ?? null) : null)}
    />
  );
}

export function SalesInvoicePicker({
  filter,
  ...props
}: InvoicePickerProps<SalesInvoiceDTO> & { readonly filter: Partial<SalesInvoiceListQueryDTO> }) {
  const [query, setQuery] = useState("");
  const { term, pending } = useSearchTerm(query);
  const search = useSalesInvoices({ ...filter, search: term || undefined, page: 1, pageSize: INVOICE_SEARCH_PAGE_SIZE });
  return <SearchPicker {...props} search={search} pending={pending} onQueryChange={setQuery} />;
}

export function PurchaseInvoicePicker({
  filter,
  ...props
}: InvoicePickerProps<PurchaseInvoiceDTO> & { readonly filter: Partial<PurchaseInvoiceListQueryDTO> }) {
  const [query, setQuery] = useState("");
  const { term, pending } = useSearchTerm(query);
  const search = usePurchaseInvoices({ ...filter, search: term || undefined, page: 1, pageSize: INVOICE_SEARCH_PAGE_SIZE });
  return <SearchPicker {...props} search={search} pending={pending} onQueryChange={setQuery} />;
}

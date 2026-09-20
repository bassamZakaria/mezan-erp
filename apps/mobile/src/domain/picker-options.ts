export interface PickerOption {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string | null;
}

/**
 * For a picker over a small, already-fetched list (a branch, a warehouse, a
 * treasury account) the caller filters client-side instead of re-querying
 * the server on every keystroke — unlike the item/customer pickers, which
 * pass a live, server-driven query straight through to their own hook.
 */
export function filterPickerOptions(options: readonly PickerOption[], query: string): PickerOption[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter(
    (option) => option.label.toLowerCase().includes(needle) || (option.sublabel ?? "").toLowerCase().includes(needle),
  );
}

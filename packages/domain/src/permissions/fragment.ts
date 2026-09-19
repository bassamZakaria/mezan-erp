export type PermissionRow = readonly [code: string, deps?: string, flags?: "s" | "p" | "sp"];

export interface PermissionModuleFragment {
  readonly id: string;
  readonly labelAr: string;
}

// DEC-14: a row lands in the same change as the route it gates — never ahead of it.
export interface PermissionFragment {
  readonly modules?: readonly PermissionModuleFragment[];
  readonly rows: readonly PermissionRow[];
  readonly actions?: readonly string[];
}

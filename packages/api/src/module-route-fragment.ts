export interface ModuleRouteFragment {
  readonly prefixes: ReadonlyArray<readonly [prefix: string, moduleId: string]>;
  readonly namesAr?: Readonly<Record<string, string>>;
}

export function mergeModuleRouteFragments(fragments: readonly ModuleRouteFragment[]): ModuleRouteFragment {
  return {
    prefixes: fragments.flatMap((f) => f.prefixes),
    namesAr: Object.assign({}, ...fragments.map((f) => f.namesAr ?? {})) as Record<string, string>,
  };
}

import type { LucideIcon } from "lucide-react";
import type { ModuleId } from "@mezan/domain";
import type { ScreenModuleLoader } from "./router/screens";

export interface NavSectionSpec {
  readonly key: string;
  readonly itemKeys: readonly string[];
  readonly defaultCollapsed?: boolean;
}

export interface NavGroupSpec {
  readonly key: string;
  readonly itemKeys: readonly string[];
  readonly sections?: readonly NavSectionSpec[];
  readonly defaultCollapsed?: boolean;
}

export interface NavItemAccess {
  readonly permission?: string;
  readonly module?: string;
}

/** A workspace a fragment adds, placed after `after` (or before `setup` when omitted). */
export interface NavFragmentGroup extends NavGroupSpec {
  readonly after?: string;
}

/** Items appended to an existing workspace — to its bar, or to one of its shelves (created when missing). */
export interface NavPlacement {
  readonly group: string;
  readonly section?: string;
  readonly itemKeys: readonly string[];
}

/**
 * Parsed as a literal by `e2e/support/screen-catalog.ts`: keep every value a
 * plain string, boolean, array or object — no computed keys, calls or spreads.
 */
export interface NavFragment {
  readonly groups?: readonly NavFragmentGroup[];
  readonly placements?: readonly NavPlacement[];
  readonly access?: Readonly<Record<string, NavItemAccess>>;
  readonly groupModules?: Readonly<Record<string, ModuleId>>;
  readonly itemModules?: Readonly<Record<string, ModuleId>>;
}

export interface NavIconFragment {
  readonly items?: Readonly<Record<string, LucideIcon>>;
  readonly groups?: Readonly<Record<string, LucideIcon>>;
}

export type ScreenLoaderFragment = Readonly<Record<string, ScreenModuleLoader>>;

export interface WebFragment {
  readonly navFragment: NavFragment;
  readonly icons: NavIconFragment;
}

/**
 * Merges the fragments into the core tree. Shelves and workspaces that end up
 * empty are dropped, so a fragment may declare a shelf another lane fills.
 */
export function applyNavFragments(core: readonly NavGroupSpec[], fragments: readonly NavFragment[]): NavGroupSpec[] {
  const groups: { spec: NavGroupSpec; itemKeys: string[]; sections: { spec: NavSectionSpec; itemKeys: string[] }[] }[] = core.map(
    (spec) => ({ spec, itemKeys: [...spec.itemKeys], sections: (spec.sections ?? []).map((s) => ({ spec: s, itemKeys: [...s.itemKeys] })) }),
  );

  for (const fragment of fragments) {
    for (const added of fragment.groups ?? []) {
      const { after, ...spec } = added;
      const entry = { spec, itemKeys: [...spec.itemKeys], sections: (spec.sections ?? []).map((s) => ({ spec: s, itemKeys: [...s.itemKeys] })) };
      const afterIndex = after === undefined ? -1 : groups.findIndex((g) => g.spec.key === after);
      const setupIndex = groups.findIndex((g) => g.spec.key === "setup");
      groups.splice(afterIndex >= 0 ? afterIndex + 1 : setupIndex >= 0 ? setupIndex : groups.length, 0, entry);
    }
  }

  for (const fragment of fragments) {
    for (const placement of fragment.placements ?? []) {
      const group = groups.find((g) => g.spec.key === placement.group);
      if (!group) throw new Error(`nav fragment places items into unknown workspace "${placement.group}"`);
      if (placement.section === undefined) {
        group.itemKeys.push(...placement.itemKeys);
        continue;
      }
      let section = group.sections.find((s) => s.spec.key === placement.section);
      if (!section) {
        section = { spec: { key: placement.section, itemKeys: [], defaultCollapsed: true }, itemKeys: [] };
        group.sections.push(section);
      }
      section.itemKeys.push(...placement.itemKeys);
    }
  }

  return groups
    .map(({ spec, itemKeys, sections }) => {
      const kept = sections.filter((s) => s.itemKeys.length > 0).map((s) => ({ ...s.spec, itemKeys: s.itemKeys }));
      return { ...spec, itemKeys, ...(spec.sections || kept.length > 0 ? { sections: kept } : {}) };
    })
    .filter((g) => g.itemKeys.length > 0 || (g.sections?.length ?? 0) > 0);
}

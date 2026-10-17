export interface PartyDirectoryEntry {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
}

export interface PartyDirectory {
  findAll(): Promise<readonly PartyDirectoryEntry[]>;
}

export function normalizedSearchTerm(search: string | null | undefined): string | undefined {
  return search?.trim().toLowerCase() || undefined;
}

export async function partyIdsNamed(
  search: string | null | undefined,
  ...directories: readonly (PartyDirectory | undefined)[]
): Promise<ReadonlySet<string>> {
  const term = normalizedSearchTerm(search);
  const ids = new Set<string>();
  if (!term) return ids;
  for (const directory of directories) {
    if (!directory) continue;
    for (const party of await directory.findAll()) {
      if (party.nameAr.toLowerCase().includes(term) || (party.nameEn ?? "").toLowerCase().includes(term)) ids.add(party.id);
    }
  }
  return ids;
}

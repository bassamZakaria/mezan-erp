import type { JournalEntry } from "../journal.js";
import type { LedgerRepository } from "./ledger.js";

type EntryLookup = Pick<LedgerRepository, "findById">;

function generationId(base: string, generation: number): string {
  return generation === 1 ? base : `${base}#${generation}`;
}

/**
 * A document that posts under a deterministic entry id posts again, after its
 * entry was reversed, under the next generation of that id. INVARIANT: a
 * generation is skipped only when its entry is reversed, so a standing entry
 * still collides and the second posting is refused as a duplicate.
 */
export async function nextEntryGenerationId(ledger: EntryLookup, base: string): Promise<string> {
  for (let generation = 1; ; generation += 1) {
    const id = generationId(base, generation);
    const taken = await ledger.findById(id);
    if (!taken || taken.status !== "reversed") return id;
  }
}

export async function standingEntryGeneration(ledger: EntryLookup, base: string): Promise<JournalEntry | null> {
  for (let generation = 1; ; generation += 1) {
    const found = await ledger.findById(generationId(base, generation));
    if (!found) return null;
    if (found.status !== "reversed") return found;
  }
}

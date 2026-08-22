/**
 * @mezan/contracts — Zod schemas + inferred types shared by api, domain and web.
 *
 * This package is the single source of truth for over-the-wire shapes. It has
 * no dependency on domain, persistence, api or any driver, so every layer can
 * import it without pulling in a runtime.
 */
export {
  journalLineSchema,
  createJournalEntrySchema,
  type JournalLineDTO,
  type CreateJournalEntryDTO,
} from "./journal.js";

/** Placeholder marker type until the full contract surface is filled in. */
export type ContractsPackage = "@mezan/contracts";

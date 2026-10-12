import { DuplicateRecordIdError } from "../duplicate-record-id.js";

/** The in-memory twin of the store's insert-only write: a taken id is refused, never replaced. */
export function insertOnly<T>(rows: Map<string, T>, id: string, row: T): void {
  if (rows.has(id)) throw new DuplicateRecordIdError(id);
  rows.set(id, row);
}

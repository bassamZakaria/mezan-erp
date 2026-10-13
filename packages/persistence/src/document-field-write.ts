import type Database from "better-sqlite3";
import { DocumentField } from "@mezan/domain";

export const FRAMEWORK_DOCUMENT_COLUMNS: Readonly<Record<DocumentField, readonly string[]>> = {
  [DocumentField.DocNo]: ["doc_no"],
  [DocumentField.Status]: ["status"],
  [DocumentField.ConfirmedAt]: ["confirmed_at"],
  [DocumentField.JournalEntryId]: ["journal_entry_id"],
  [DocumentField.WorkflowRequestId]: ["workflow_request_id"],
  [DocumentField.ReversedByDocId]: ["reversed_by_doc_id"],
  [DocumentField.Lines]: ["lines_json"],
};

export interface GuardedRowWrite {
  readonly table: string;
  readonly row: Readonly<Record<string, unknown>>;
  readonly columns: readonly string[];
  readonly id: string;
  readonly expectedStatuses: readonly string[];
  readonly and?: { readonly sql: string; readonly params: readonly unknown[] };
}

export function writeRowColumnsWhere(sqlite: Database.Database, write: GuardedRowWrite): boolean {
  if (write.columns.length === 0 || write.expectedStatuses.length === 0) return false;
  const assignments = write.columns.map((column) => `${column} = ?`).join(", ");
  const statuses = write.expectedStatuses.map(() => "?").join(",");
  const extra = write.and ? ` AND ${write.and.sql}` : "";
  const changes = sqlite
    .prepare(`UPDATE ${write.table} SET ${assignments} WHERE id = ? AND status IN (${statuses})${extra}`)
    .run(...write.columns.map((column) => write.row[column]), write.id, ...write.expectedStatuses, ...(write.and?.params ?? [])).changes;
  return changes === 1;
}

export function columnsOf<Field extends string>(map: Readonly<Record<Field, readonly string[]>>, fields: readonly Field[]): readonly string[] {
  return [...new Set(fields.flatMap((field) => map[field]))];
}

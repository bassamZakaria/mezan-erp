import type Database from "better-sqlite3";
import type { InvoiceDocumentKind } from "@mezan/domain";

const REGISTER_INVOICE_COLUMN = "invoice_id";

// INVARIANT: an invoice raised before its kind was stored is marked ONLY when
// a release register names it by id. Nothing about the invoice itself — the
// item on its line, the shape of its id — says what it is: a normal sale can
// carry the release item, and marking it would keep it from the tax authority.
export function markInvoicesNamedByRegister(
  sqlite: Database.Database,
  mark: { readonly table: string; readonly register: string; readonly kind: InvoiceDocumentKind },
): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${mark.register})`).all() as { name: string }[];
  if (!columns.some((column) => column.name === REGISTER_INVOICE_COLUMN)) return;
  sqlite
    .prepare(
      `UPDATE ${mark.table} SET document_kind = ?
        WHERE id IN (SELECT ${REGISTER_INVOICE_COLUMN} FROM ${mark.register} WHERE ${REGISTER_INVOICE_COLUMN} IS NOT NULL)`,
    )
    .run(mark.kind);
}

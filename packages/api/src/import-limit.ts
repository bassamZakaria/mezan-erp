import type { MiddlewareHandler } from "hono";
import { IMPORT_ROW_LIMIT, ImportRefusal } from "@mezan/contracts";
import { MutatingMethod } from "./audit-boundary.js";

const PAYLOAD_TOO_LARGE = 413;

export function rowsOfImport(body: unknown): number {
  const rows = (body as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}

export function linesOfCsvImport(body: unknown): number {
  const csv = (body as { csv?: unknown } | null)?.csv;
  return typeof csv === "string" ? csv.split("\n").filter((line) => line.trim() !== "").length : 0;
}

// SECURITY / AVAILABILITY CONSTRAINT: an import is written in ONE transaction,
// so that a failure leaves nothing behind, and for as long as that transaction
// is open every other write of the tenant waits. The limit keeps that wait
// short; without it one file can hold the tenant's connection for seconds.
export function importRowLimit(countRows: (body: unknown) => number = rowsOfImport, limit: number = IMPORT_ROW_LIMIT): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== MutatingMethod.Post) return next();
    const body: unknown = await c.req.json().catch(() => null);
    const rows = countRows(body);
    if (rows <= limit) return next();
    return c.json(
      {
        error: ImportRefusal.TooLarge,
        rows,
        limit,
        message: `الملف يحتوي ${rows} صفًا، والحد الأقصى للاستيراد في المرة الواحدة ${limit} صف. قسّم الملف إلى أجزاء واستورد كل جزء على حدة.`,
        messageEn: `The file holds ${rows} rows and one import takes at most ${limit}. Split the file and import each part separately.`,
      },
      PAYLOAD_TOO_LARGE,
    );
  };
}

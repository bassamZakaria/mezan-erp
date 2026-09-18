import { z } from "zod";
import { Money } from "../money/index.js";
import type { JournalEntryStatus } from "../journal.js";
import type { ReportDefinition } from "./types.js";
import { sumRows, countRows } from "./kpi.js";
import { CUSTOMER_OPENING_BALANCE_DOC_TYPE, SUPPLIER_OPENING_BALANCE_DOC_TYPE } from "./aging-open-items.js";

/**
 * تكرار ترحيل الأرصدة الافتتاحية — Duplicate Opening-Balance Postings (D241).
 *
 * The customers/suppliers screen posts an opening balance under one entry id
 * and, before this defect was fixed, the start-up backfill looked for a
 * different one and posted the same figure again — so a books file that had
 * already restarted under the old code carries a real, permanently posted
 * duplicate. Accounting practice forbids editing or deleting a posted entry,
 * so the only legal repair is a reversing entry (`opening-balance-repair.ts`
 * at the API layer); this report is the read-only list of who still needs
 * one. A party never appears here from an ordinary correction (D142) —
 * reversing the superseded entry and posting the new balance nets to exactly
 * the party's current `openingBalance`, so `excess` is zero and the row is
 * dropped.
 */

/** One opening-balance entry as the report needs it — a thin projection of `JournalEntry`, one per posted (or reversed) entry. */
export interface OpeningBalanceEntryRef {
  readonly id: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly status: JournalEntryStatus;
  readonly sourceDocType: string | null;
  readonly sourceDocId: string | null;
  /** This entry's net movement on the control account, signed debit-minus-credit. */
  readonly controlMovement: Money;
}

export interface OpeningBalancePartyRef {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly openingBalance: Money;
}

export interface OpeningBalanceDuplicatesContext {
  readonly customers: readonly OpeningBalancePartyRef[];
  readonly suppliers: readonly OpeningBalancePartyRef[];
  /** Every CUSTOMER_OPENING_BALANCE / SUPPLIER_OPENING_BALANCE entry ever posted, any status but draft. */
  readonly entries: readonly OpeningBalanceEntryRef[];
}

export interface OpeningBalanceDuplicateRow {
  readonly key: string;
  readonly kind: "customer" | "supplier";
  readonly partyId: string;
  readonly code: string;
  readonly nameAr: string;
  /** What the party's own record says the opening balance should be, signed on the control account's natural side. */
  readonly wanted: number;
  /** What is actually posted to the control account across every contributing entry. */
  readonly totalPosted: number;
  /** `totalPosted − wanted` — the amount a reversing entry must remove. Always non-zero for a reported row. */
  readonly excess: number;
  readonly entryIds: readonly string[];
  readonly entryCount: number;
}

/**
 * Groups every non-draft opening-balance entry by the party it names
 * (`sourceDocId`), then flags a party whose entries net to something other
 * than its own record — which, with two or more contributing entries, can
 * only mean one of them should never have posted. `kind` selects which
 * document type and control-account sign to read (D241 also checks
 * suppliers, not customers alone).
 */
export function findOpeningBalanceDuplicates(
  kind: "customer" | "supplier",
  parties: readonly OpeningBalancePartyRef[],
  entries: readonly OpeningBalanceEntryRef[],
): OpeningBalanceDuplicateRow[] {
  const docType = kind === "customer" ? CUSTOMER_OPENING_BALANCE_DOC_TYPE : SUPPLIER_OPENING_BALANCE_DOC_TYPE;
  const byParty = new Map<string, OpeningBalanceEntryRef[]>();
  for (const entry of entries) {
    if (entry.status === "draft" || entry.sourceDocType !== docType || !entry.sourceDocId) continue;
    const list = byParty.get(entry.sourceDocId) ?? [];
    list.push(entry);
    byParty.set(entry.sourceDocId, list);
  }

  const rows: OpeningBalanceDuplicateRow[] = [];
  for (const party of parties) {
    const list = byParty.get(party.id);
    if (!list || list.length < 2) continue; // "posted more than once" needs at least two contributing entries
    const totalPosted = list.reduce((acc, e) => acc.add(e.controlMovement), Money.zero());
    const wanted = kind === "customer" ? party.openingBalance : party.openingBalance.negate();
    const excess = totalPosted.add(wanted.negate());
    if (excess.scaled === 0n) continue; // a legitimate D142 correction nets to zero — not a duplicate
    rows.push({
      key: `${kind}:${party.id}`,
      kind,
      partyId: party.id,
      code: party.code,
      nameAr: party.nameAr,
      wanted: Number(wanted.toString()),
      totalPosted: Number(totalPosted.toString()),
      excess: Number(excess.toString()),
      entryIds: list.map((e) => e.id),
      entryCount: list.length,
    });
  }
  return rows;
}

const KIND_LABEL: Record<"customer" | "supplier", string> = { customer: "عميل", supplier: "مورد" };

const paramsSchema = z.object({});

export function createOpeningBalanceDuplicatesReport(): ReportDefinition<
  Record<string, never>,
  OpeningBalanceDuplicateRow,
  OpeningBalanceDuplicatesContext
> {
  return {
    id: "gl.opening-balance-duplicates",
    titleAr: "تكرار ترحيل الأرصدة الافتتاحية",
    descriptionAr: "عملاء وموردون تم ترحيل رصيدهم الافتتاحي أكثر من مرة — كل صف يحتاج قيد عكسي بقيمة الفائض.",
    paramsSchema,
    defaultParams: {},
    paramFields: [],
    rowKey: (row) => row.key,
    columns: [
      { key: "kindLabel", header: "النوع", format: "text", value: (row) => KIND_LABEL[row.kind] },
      { key: "code", header: "الكود", format: "text", value: (row) => row.code },
      { key: "nameAr", header: "الاسم", format: "text", value: (row) => row.nameAr },
      { key: "wanted", header: "الرصيد المطلوب", format: "money", align: "end", value: (row) => row.wanted },
      { key: "totalPosted", header: "المُرحّل فعلاً", format: "money", align: "end", value: (row) => row.totalPosted },
      { key: "excess", header: "الفائض (يحتاج عكسًا)", format: "money", align: "end", total: true, value: (row) => row.excess },
      { key: "entryCount", header: "عدد القيود", format: "qty", align: "end", value: (row) => row.entryCount },
    ],
    kpis: [
      { key: "excess", labelAr: "إجمالي الفائض المطلوب عكسه", format: "money", value: (rows) => sumRows(rows, (r) => r.excess), tone: (value) => (value === 0 ? "success" : "danger") },
      { key: "partyCount", labelAr: "عدد الأطراف المتأثرة", format: "qty", value: (rows) => rows.length, tone: (value) => (value > 0 ? "danger" : "success") },
      { key: "customerCount", labelAr: "من العملاء", format: "qty", value: (rows) => countRows(rows, (r) => r.kind === "customer") },
      { key: "supplierCount", labelAr: "من الموردين", format: "qty", value: (rows) => countRows(rows, (r) => r.kind === "supplier") },
    ],
    run: (_params, ctx) => [
      ...findOpeningBalanceDuplicates("customer", ctx.customers, ctx.entries),
      ...findOpeningBalanceDuplicates("supplier", ctx.suppliers, ctx.entries),
    ],
  };
}

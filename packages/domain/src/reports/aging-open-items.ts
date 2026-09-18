import type { Money } from "../money/index.js";

/**
 * A party balance the control account holds that no invoice carries: an
 * opening balance typed in at go-live (D204), a manual journal line naming
 * the party (D205), the open remainder of a document imported from the
 * previous system (D210), or a refund paid back across the control account
 * (D211). Signed on the party's natural side: positive is more owed (a debit
 * to a customer, a credit to a supplier). A positive item ages from its date;
 * a negative one nets like an unallocated voucher.
 */
export type AgingOpenItemSource = "opening" | "journal" | "imported" | "refund";

export interface AgingOpenItem {
  readonly partyId: string;
  readonly source: AgingOpenItemSource;
  /** What the statement names it by: an entry number, a document number. */
  readonly reference?: string | null;
  /** The day it arose; a ladder as of an earlier day leaves it out. */
  readonly date: string;
  /** The day it ages from, when that is not `date` (an imported invoice's due date). */
  readonly dueDate?: string | null;
  readonly amount: Money;
  readonly branchId?: string | null;
}

/** `sourceDocType` of the entry that posts a party's opening balance to its control account (B-2). */
export const CUSTOMER_OPENING_BALANCE_DOC_TYPE = "CUSTOMER_OPENING_BALANCE";
export const SUPPLIER_OPENING_BALANCE_DOC_TYPE = "SUPPLIER_OPENING_BALANCE";

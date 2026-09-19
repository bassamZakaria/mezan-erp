import type { Money } from "../money/index.js";

export enum BankEntryKind {
  BankCharge = "bank_charge",
  Interest = "interest",
}

export interface BankEntryPostInput {
  readonly voucherId: string;
  readonly kind: BankEntryKind;
  readonly date: string;
  /** Always positive; the direction follows from `kind`. */
  readonly amount: Money;
  readonly treasuryAccountId: string;
  readonly counterAccountId: string;
  readonly costCenterId: string | null;
  readonly memo: string;
  readonly reference: string | null;
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
}

export type BankEntryPostResult =
  | { readonly held: false; readonly voucherId: string; readonly voucherNo: string | null; readonly entryId: string }
  | { readonly held: true; readonly voucherId: string; readonly voucherNo: string | null };

/** Posts the voucher behind a statement line the books never recorded (a bank charge, interest earned). */
export interface BankEntryPoster {
  post(input: BankEntryPostInput): Promise<BankEntryPostResult>;
}

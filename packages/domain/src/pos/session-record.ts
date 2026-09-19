import type { Money } from "../money/index.js";

export const POS_SESSION_STATUSES = ["open", "closing", "closed"] as const;
export type PosSessionStatus = (typeof POS_SESSION_STATUSES)[number];

/**
 * وردية الكاشير — one cash-drawer session on one terminal. The schema lands
 * with the master data so every later POS lane can point at it; the lifecycle
 * (close, blind count, variance) is the sessions lane's.
 */
export interface PosSessionRecord {
  readonly id: string;
  readonly docNo: string | null;
  readonly terminalId: string;
  readonly branchId: string;
  readonly cashierUserId: string;
  readonly shiftTemplateId: string | null;
  readonly status: PosSessionStatus;
  readonly openedAt: string;
  readonly openingFloat: Money;
  readonly closedAt: string | null;
}

export class PosSessionAlreadyOpenError extends Error {
  readonly code = "POS_SESSION_ALREADY_OPEN";
  constructor(readonly scope: "terminal" | "cashier") {
    super(scope === "terminal" ? "يوجد وردية مفتوحة على هذا الجهاز بالفعل" : "لديك وردية مفتوحة على جهاز آخر بالفعل");
    this.name = "PosSessionAlreadyOpenError";
  }
}

export interface PosSessionRepository {
  /** Refuses with `PosSessionAlreadyOpenError` when the terminal or the cashier already holds an unclosed session. */
  open(session: PosSessionRecord): Promise<void>;
  findOpenForTerminal(terminalId: string): Promise<PosSessionRecord | null>;
}

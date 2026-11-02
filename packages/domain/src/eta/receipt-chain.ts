/**
 * سلسلة الإيصالات لكل جهاز — the previousUUID chain, kept per POS device serial.
 *
 * EXTERNAL CONTRACT (SDK, Receipt v1.2 header.previousUUID): every receipt names
 * the UUID of the receipt issued before it BY THE SAME DEVICE, and an empty
 * previousUUID is accepted only on that device's first receipt. The chain is how
 * the authority detects a receipt that was printed and never reported, so two
 * receipts naming the same predecessor — or one skipping a link — break it.
 *
 * The head is a row of its own (DEC-25), advanced in the same transaction that
 * stores the receipt, with a compare-and-set on the previous head. Deriving it by
 * scanning every submission (D283) was slow and let two concurrent sales both
 * chain onto the same predecessor.
 */
import type { EtaSubmission, EtaSubmissionRepository } from "./submission.js";

export interface EtaReceiptChainHead {
  readonly serial: string;
  /** Null until the device's first receipt. */
  readonly lastUuid: string | null;
  /** How many receipts this device has issued; the next is `lastSeq + 1`. */
  readonly lastSeq: number;
  readonly lastReceiptNumber: string | null;
  readonly updatedAt: string | null;
}

export interface EtaReceiptChainAppend {
  readonly serial: string;
  /** The head the receipt was built on. The append fails if the head has moved since. */
  readonly expectedPreviousUuid: string | null;
  readonly submission: EtaSubmission;
}

export interface EtaReceiptChainRepository {
  head(serial: string): Promise<EtaReceiptChainHead | null>;
  list(): Promise<EtaReceiptChainHead[]>;
  /**
   * Stores the receipt's submission AND advances its serial's head, atomically,
   * only if the head still equals `expectedPreviousUuid`. False means another
   * issue won the race and nothing was written.
   */
  append(entry: EtaReceiptChainAppend): Promise<boolean>;
}

export class EtaReceiptChainConflictError extends Error {
  readonly code = "ETA_RECEIPT_CHAIN_CONFLICT";
  readonly messageEn: string;
  constructor(readonly serial: string) {
    super(
      `تعذّر إصدار الإيصال: تغيّرت سلسلة إيصالات الجهاز ${serial} أثناء الإصدار. أعد المحاولة. ` +
        `The receipt chain of device ${serial} moved while the receipt was being issued; retry.`,
    );
    this.messageEn = `The receipt could not be issued: the receipt chain of device ${serial} changed while the receipt was being issued. Try again.`;
    this.name = "EtaReceiptChainConflictError";
  }
}

/**
 * The chain for a process that holds its submissions in memory (tests, and any
 * wiring without SQLite). A single process has no interleaving inside
 * `append`, so the compare-and-set is exact here too.
 */
export function createInMemoryEtaReceiptChain(submissions: EtaSubmissionRepository): EtaReceiptChainRepository {
  const heads = new Map<string, EtaReceiptChainHead>();
  return {
    async head(serial) {
      return heads.get(serial) ?? null;
    },
    async list() {
      return [...heads.values()];
    },
    async append({ serial, expectedPreviousUuid, submission }) {
      const current = heads.get(serial) ?? null;
      if ((current?.lastUuid ?? null) !== expectedPreviousUuid) return false;
      await submissions.create(submission);
      heads.set(serial, {
        serial,
        lastUuid: submission.etaUuid,
        lastSeq: submission.receiptSeq ?? (current?.lastSeq ?? 0) + 1,
        lastReceiptNumber: submission.internalId,
        updatedAt: submission.createdAt,
      });
      return true;
    },
  };
}

/**
 * Runs one task at a time per key. Issuing a receipt awaits between reading the
 * head and writing the next link (the UUID hash is async), so two sales on one
 * till must queue behind each other or both would chain onto the same head.
 */
export function createKeyedSerializer(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}

export enum EtaReceiptSourceKind {
  Invoice = "invoice",
  Return = "return",
}

export function parseEtaReceiptSourceKind(value: string): EtaReceiptSourceKind | null {
  return Object.values(EtaReceiptSourceKind).find((kind) => kind === value) ?? null;
}

/**
 * إيصال لم يصدر — a consumer sale or return that should have been receipted
 * and was not (no device, missing registration, no original receipt…). Kept
 * durably so the reporting-window counters can see it: a sale with no receipt
 * row is otherwise invisible to every queue summary, and the confirm that
 * produced it has already posted.
 */
export interface EtaReceiptGap {
  /** The receipt number it would have carried (the document number). */
  readonly internalId: string;
  readonly docType: EtaReceiptSourceKind;
  readonly docId: string;
  /** The sale (or return) moment the reporting window runs from. */
  readonly issuedAt: string;
  readonly code: string;
  readonly reason: string;
  readonly recordedAt: string;
}

export interface EtaReceiptGapRepository {
  record(gap: EtaReceiptGap): Promise<void>;
  clear(internalId: string): Promise<void>;
  list(): Promise<EtaReceiptGap[]>;
}

export function createInMemoryEtaReceiptGaps(): EtaReceiptGapRepository {
  const gaps = new Map<string, EtaReceiptGap>();
  return {
    async record(gap) {
      gaps.set(gap.internalId, gap);
    },
    async clear(internalId) {
      gaps.delete(internalId);
    },
    async list() {
      return [...gaps.values()];
    },
  };
}

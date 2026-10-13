export enum OutsideWork {
  EtaHttp = "eta-http",
  EtaSigning = "eta-signing",
  Mail = "mail",
}

// REQUIRED: each is shorter than the wait a holder whose outside work completed
// is given to take the connection again (persistence COMPLETED_RETAKE_TIMEOUT_MS).
// A call with no deadline keeps its request — and everything that request
// holds — for as long as the outside world chooses.
export const OUTSIDE_WORK_DEADLINES_MS: Readonly<Record<OutsideWork, number>> = {
  [OutsideWork.EtaHttp]: 30_000,
  [OutsideWork.EtaSigning]: 60_000,
  [OutsideWork.Mail]: 60_000,
};

export class OutsideWorkDeadlineError extends Error {
  constructor(readonly work: OutsideWork, waitedMs: number) {
    super(`${work} did not answer within ${waitedMs}ms`);
    this.name = "OutsideWorkDeadlineError";
  }
}

export function withinDeadline<T>(work: OutsideWork, run: () => Promise<T>, deadlines: Readonly<Record<OutsideWork, number>> = OUTSIDE_WORK_DEADLINES_MS): Promise<T> {
  const waitMs = deadlines[work];
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OutsideWorkDeadlineError(work, waitMs)), waitMs);
    timer.unref?.();
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

import type { CardCheckoutService, CardCheckoutSweepOptions, CardCheckoutSweepResult } from "./card-checkout.js";

const SWEEP_INTERVAL_MS = 15 * 60_000;

export interface CardCheckoutSweepTimerOptions extends CardCheckoutSweepOptions {
  readonly intervalMs?: number;
  readonly onError?: (err: unknown) => void;
  readonly onResult?: (result: CardCheckoutSweepResult) => void;
}

export interface CardCheckoutSweepTimer {
  stop(): void;
}

function settledAnything(result: CardCheckoutSweepResult): boolean {
  return result.paid + result.declined + result.unapplied + result.expired + result.unavailable + result.failed > 0;
}

function logResult(result: CardCheckoutSweepResult): void {
  if (settledAnything(result)) console.log(`[billing] card checkout sweep ${JSON.stringify(result)}`);
}

/**
 * Same shape as the dunning timer: one pass at boot, then on an interval that
 * never keeps the process alive. The service itself refuses to run two passes
 * at once, so a slow provider cannot stack them.
 */
export function startCardCheckoutSweepTimer(
  service: Pick<CardCheckoutService, "sweepPending">,
  options: CardCheckoutSweepTimerOptions = {},
): CardCheckoutSweepTimer {
  const onResult = options.onResult ?? logResult;
  const run = () => {
    service
      .sweepPending({ pendingAfterMs: options.pendingAfterMs, expireAfterMs: options.expireAfterMs })
      .then(onResult)
      .catch((err) => options.onError?.(err));
  };
  run();

  const timer = setInterval(run, options.intervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
    },
  };
}

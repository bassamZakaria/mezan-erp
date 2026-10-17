import { createLogger, type JobTracker } from "@mezan/api";
import type { CardCheckoutService, CardCheckoutSweepOptions, CardCheckoutSweepResult } from "./card-checkout.js";

const SWEEP_INTERVAL_MS = 15 * 60_000;

export interface CardCheckoutSweepTimerOptions extends CardCheckoutSweepOptions {
  readonly intervalMs?: number;
  readonly onError?: (err: unknown) => void;
  readonly onResult?: (result: CardCheckoutSweepResult) => void;
  readonly job?: JobTracker;
}

export interface CardCheckoutSweepTimer {
  stop(): void;
}

function settledAnything(result: CardCheckoutSweepResult): boolean {
  return result.paid + result.declined + result.unapplied + result.expired + result.unavailable + result.failed > 0;
}

const log = createLogger("billing");

function logResult(result: CardCheckoutSweepResult): void {
  if (settledAnything(result)) log.info({ result }, "card checkout sweep settled checkouts");
}

export function startCardCheckoutSweepTimer(
  service: Pick<CardCheckoutService, "sweepPending">,
  options: CardCheckoutSweepTimerOptions = {},
): CardCheckoutSweepTimer {
  const onResult = options.onResult ?? logResult;
  const run = () => {
    const sweep = () => service.sweepPending({ pendingAfterMs: options.pendingAfterMs, expireAfterMs: options.expireAfterMs });
    (options.job ? options.job.run(sweep, (result) => result.paid + result.declined + result.expired) : sweep())
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

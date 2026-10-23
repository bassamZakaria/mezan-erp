import { createLogger, type JobTracker } from "@mezan/api";
import type { CardCheckoutService, CardCheckoutSweepOptions, CardCheckoutSweepResult } from "./card-checkout.js";

const SWEEP_INTERVAL_MS = 15 * 60_000;
// Shutdown awaits a running sweep, so it must end well inside the process's shutdown budget.
const TIMER_SWEEP_BUDGET_MS = 30_000;

export interface CardCheckoutSweepTimerOptions extends CardCheckoutSweepOptions {
  readonly intervalMs?: number;
  readonly onError?: (err: unknown) => void;
  readonly onResult?: (result: CardCheckoutSweepResult) => void;
  readonly job?: JobTracker;
}

export interface CardCheckoutSweepTimer {
  /** Resolves once the sweep in flight, if any, has settled. */
  stop(): Promise<void>;
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
  let current: Promise<void> = Promise.resolve();
  const run = () => {
    const sweep = () => service.sweepPending({ pendingAfterMs: options.pendingAfterMs, expireAfterMs: options.expireAfterMs, budgetMs: options.budgetMs ?? TIMER_SWEEP_BUDGET_MS });
    current = (options.job ? options.job.run(sweep, (result) => result.paid + result.declined + result.expired) : sweep())
      .then(onResult)
      .catch((err: unknown) => options.onError?.(err));
  };
  run();

  const timer = setInterval(run, options.intervalMs ?? SWEEP_INTERVAL_MS);
  timer.unref();

  return {
    stop() {
      clearInterval(timer);
      return current;
    },
  };
}

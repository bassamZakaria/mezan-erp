export enum PowerSaveMode {
  PreventAppSuspension = "prevent-app-suspension",
}

export interface PowerSaveBlockerPort {
  start(type: `${PowerSaveMode}`): number;
  stop(id: number): void;
}

export interface TillWakeLockOptions {
  readonly blocker: PowerSaveBlockerPort;
  readonly connectedDevices: () => Promise<readonly unknown[]>;
  readonly intervalMs?: number;
  readonly log?: (line: string) => void;
}

export interface TillWakeLock {
  refresh(): Promise<void>;
  isHolding(): boolean;
  stop(): void;
}

const DEFAULT_INTERVAL_MS = 30_000;

/**
 * Keeps the LAN host awake while at least one till holds a seat, and lets it
 * sleep again once none does: a host that suspends mid-shift takes every
 * paired till's books with it.
 */
export function startTillWakeLock(options: TillWakeLockOptions): TillWakeLock {
  let blockerId: number | null = null;
  let stopped = false;

  const hold = () => {
    if (blockerId !== null) return;
    blockerId = options.blocker.start(PowerSaveMode.PreventAppSuspension);
    options.log?.("[lan] a till is connected — holding the host awake");
  };
  const release = () => {
    if (blockerId === null) return;
    options.blocker.stop(blockerId);
    blockerId = null;
    options.log?.("[lan] no till is connected — the host may sleep again");
  };

  const refresh = async () => {
    if (stopped) return;
    let connected: number;
    try {
      connected = (await options.connectedDevices()).length;
    } catch {
      return;
    }
    if (stopped) return;
    if (connected > 0) hold();
    else release();
  };

  const timer = setInterval(() => void refresh(), options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref?.();
  void refresh();

  return {
    refresh,
    isHolding: () => blockerId !== null,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      release();
    },
  };
}

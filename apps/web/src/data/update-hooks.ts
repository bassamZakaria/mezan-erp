import { useCallback, useEffect, useState } from "react";

/**
 * Desktop auto-update, from the renderer's side (docs/archive/plan.md §2.3).
 * The main process owns the electron-updater flow and the Ed25519 signature
 * check; this hook only reflects its pushed status and relays the user's
 * consent (check / download / install). On the web edition `window.mezan` is
 * absent, so `supported` is false and the banner never shows.
 */

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "verifying"
  | "ready"
  | "error"
  | "rejected";

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly version?: string;
  readonly releaseNotes?: string;
  readonly percent?: number;
  readonly reason?: string;
}

type UpdateAction = "check" | "download" | "install";

interface UpdateBridge {
  update(action: UpdateAction): Promise<UpdateStatus>;
  onUpdateEvent(listener: (status: UpdateStatus) => void): () => void;
}

function getBridge(): UpdateBridge | undefined {
  const bridge = (globalThis as { mezan?: Partial<UpdateBridge> }).mezan;
  return bridge && typeof bridge.update === "function" && typeof bridge.onUpdateEvent === "function"
    ? (bridge as UpdateBridge)
    : undefined;
}

export interface UseUpdatesResult {
  readonly supported: boolean;
  readonly status: UpdateStatus;
  check(): void;
  download(): void;
  install(): void;
}

export function useUpdates(): UseUpdatesResult {
  const [status, setStatus] = useState<UpdateStatus>({ phase: "idle" });
  const bridge = getBridge();

  useEffect(() => {
    if (!bridge) return;
    return bridge.onUpdateEvent(setStatus);
  }, [bridge]);

  const run = useCallback(
    (action: UpdateAction) => {
      if (!bridge) return;
      void bridge.update(action).then(setStatus);
    },
    [bridge],
  );

  return {
    supported: bridge !== undefined,
    status,
    check: () => run("check"),
    download: () => run("download"),
    install: () => run("install"),
  };
}

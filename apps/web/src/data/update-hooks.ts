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
  | "rejected"
  /** No feed and no vendor key in this build — information, not a failure. */
  | "unavailable"
  /** Consented, and it happens when the app is next closed. */
  | "scheduled"
  /** The launch-time pre-update backup is running. */
  | "migrating";

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
  /** Puts the banner away. The state it was reporting is not lost — it is re-pushed. */
  dismiss(): void;
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
      // THE MISSING CATCH. On a client machine the update channel is refused,
      // and an `ipcMain.handle` rejection with no handler here left the button
      // silently dead — press, nothing, forever. A rejection is a state to
      // render, not an unhandled promise.
      void bridge.update(action).then(setStatus, (err: unknown) =>
        setStatus({
          phase: "error",
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
    },
    [bridge],
  );

  return {
    supported: bridge !== undefined,
    status,
    check: () => run("check"),
    download: () => run("download"),
    install: () => run("install"),
    dismiss: () => setStatus({ phase: "idle" }),
  };
}

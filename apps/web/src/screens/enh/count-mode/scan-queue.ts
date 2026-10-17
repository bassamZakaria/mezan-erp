import { useCallback, useEffect, useRef, useState } from "react";
import { CountScanOutcomeDTO, type CountModeScanInputDTO, type CountModeScanResultDTO } from "@mezan/contracts";
import type { CountModeScanResult } from "./hooks";

export enum ScanEntryStatus {
  Pending = "pending",
  Counted = "counted",
  Rejected = "rejected",
  Failed = "failed",
}

export interface ScanEntry {
  readonly key: string;
  readonly label: string;
  readonly status: ScanEntryStatus;
  readonly result: CountModeScanResultDTO | null;
  readonly error: string | null;
  readonly body: CountModeScanInputDTO;
}

const HISTORY_LIMIT = 30;

export interface ScanQueueHandlers {
  readonly send: (body: CountModeScanInputDTO) => Promise<CountModeScanResult>;
  readonly onSettled: (entry: ScanEntry) => void;
  readonly onIdle: () => void;
}

export function useScanQueue(handlers: ScanQueueHandlers) {
  const [entries, setEntries] = useState<readonly ScanEntry[]>([]);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const waiting = useRef<string[]>([]);
  const bodies = useRef(new Map<string, ScanEntry>());
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = useCallback((key: string, next: Partial<ScanEntry>) => {
    const current = bodies.current.get(key);
    if (!current) return undefined;
    const merged: ScanEntry = { ...current, ...next };
    bodies.current.set(key, merged);
    if (mounted.current) setEntries((list) => list.map((entry) => (entry.key === key ? merged : entry)));
    return merged;
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let key = waiting.current.shift(); key !== undefined; key = waiting.current.shift()) {
        const entry = bodies.current.get(key);
        if (!entry) continue;
        const answer = await handlersRef.current.send(entry.body);
        const settled = answer.ok
          ? patch(key, {
              status: answer.result.outcome === CountScanOutcomeDTO.Counted ? ScanEntryStatus.Counted : ScanEntryStatus.Rejected,
              result: answer.result,
              error: null,
            })
          : patch(key, { status: ScanEntryStatus.Failed, error: answer.failure.message });
        if (settled) handlersRef.current.onSettled(settled);
      }
    } finally {
      running.current = false;
      handlersRef.current.onIdle();
    }
  }, [patch]);

  const enqueue = useCallback(
    (body: CountModeScanInputDTO, label: string) => {
      const key = body.clientKey ?? crypto.randomUUID();
      const entry: ScanEntry = { key, label, status: ScanEntryStatus.Pending, result: null, error: null, body: { ...body, clientKey: key } };
      bodies.current.set(key, entry);
      setEntries((list) => [entry, ...list].slice(0, HISTORY_LIMIT));
      waiting.current.push(key);
      void drain();
      return key;
    },
    [drain],
  );

  const retry = useCallback(
    (key: string) => {
      const entry = bodies.current.get(key);
      if (!entry || entry.status !== ScanEntryStatus.Failed) return;
      patch(key, { status: ScanEntryStatus.Pending, error: null });
      waiting.current.push(key);
      void drain();
    },
    [drain, patch],
  );

  const pending = entries.filter((entry) => entry.status === ScanEntryStatus.Pending).length;
  const failed = entries.filter((entry) => entry.status === ScanEntryStatus.Failed).length;
  return { entries, enqueue, retry, pending, failed };
}

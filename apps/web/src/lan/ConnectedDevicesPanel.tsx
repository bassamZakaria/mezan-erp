import { useCallback, useEffect, useState } from "react";
import { Button, Card, StatusPill, formatTime, type Locale } from "@mezan/ui";
import type { DeviceSessionDTO, LanSessionsListDTO, LanStatusDTO } from "@mezan/contracts";
import { useAppTranslation } from "../i18n";

/**
 * Admin panel for LAN multi-till (docs/archive/plan.md §6.3.3): shows the connected
 * devices holding a seat, with a per-row disconnect action. Reads/writes the
 * `/lan/status`, `/lan/sessions` routes exposed by @mezan/api's lan/routes.ts
 * — this panel is a thin view over that API, no business logic of its own.
 *
 * Per-row actions are scoped to the row acting on them, not the panel as a
 * whole: only the device being disconnected shows a pending state, a second
 * click on ANY row while one is in flight is a no-op (guarded in the
 * handler), and the pending flag always clears — success or failure.
 */
export interface ConnectedDevicesPanelProps {
  /** Base URL of the LAN host's API (e.g. "http://192.168.1.10:4173"). Empty targets same-origin. */
  baseUrl?: string;
  /** Injectable fetch for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Poll interval in ms for refreshing the device list; 0 disables polling. */
  pollIntervalMs?: number;
}

function clockTime(epochMs: number, locale: Locale): string {
  return formatTime(epochMs, { locale });
}

export function ConnectedDevicesPanel({
  baseUrl = "",
  fetchImpl = fetch,
  pollIntervalMs = 5000,
}: ConnectedDevicesPanelProps) {
  const { t, locale } = useAppTranslation();
  const [status, setStatus] = useState<LanStatusDTO | null>(null);
  const [sessions, setSessions] = useState<DeviceSessionDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const statusRes = await fetchImpl(`${baseUrl}/lan/status`);
      const statusBody = (await statusRes.json()) as LanStatusDTO;
      setStatus(statusBody);
      setError(null);

      if (!statusBody.licensed) {
        setSessions([]);
        return;
      }

      const listRes = await fetchImpl(`${baseUrl}/lan/sessions`);
      if (!listRes.ok) throw new Error(`HTTP ${listRes.status}`);
      const listBody = (await listRes.json()) as LanSessionsListDTO;
      setSessions(listBody.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("devices.couldNotLoadTheConnected"));
    }
  }, [baseUrl, fetchImpl, t]);

  useEffect(() => {
    void refresh();
    if (!pollIntervalMs) return;
    const id = setInterval(() => void refresh(), pollIntervalMs);
    return () => clearInterval(id);
  }, [refresh, pollIntervalMs]);

  const handleDisconnect = useCallback(
    async (sessionId: string) => {
      if (disconnectingId) return; // one in-flight disconnect at a time
      setDisconnectingId(sessionId);
      try {
        await fetchImpl(`${baseUrl}/lan/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        });
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("devices.couldNotDisconnectTheDevice"));
      } finally {
        setDisconnectingId(null);
      }
    },
    [baseUrl, fetchImpl, disconnectingId, refresh, t],
  );

  if (status && !status.licensed) {
    return (
      <Card className="p-[18px]">
        <div className="text-[13px] font-semibold text-ink">{t("devices.devicesConnectedOverTheLocal")}</div>
        <p className="mt-2 text-[12.5px] text-ink-muted">
          {t("devices.multiTillOverTheLocal")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-[18px]">
      <div className="flex items-center justify-between gap-[12px]">
        <div>
          <div className="text-[13px] font-semibold text-ink">{t("devices.devicesConnectedOverTheLocal")}</div>
          <p className="mt-1 text-[12px] text-ink-muted">
            {status ? (
              <>
                <span className="mz-num font-semibold text-ink">{status.connected}</span>
                {" / "}
                <span className="mz-num">{status.seats}</span> {t("devices.seatInUse")}
              </>
            ) : (
              t("common.loading")
            )}
          </p>
        </div>
        {status && status.connected >= status.seats ? (
          <StatusPill label={t("devices.everySeatIsTaken")} tone="warning" />
        ) : (
          <StatusPill label={t("devices.available")} tone="success" />
        )}
      </div>

      {error ? <p className="mt-[10px] text-[12px] text-danger-ink">{error}</p> : null}

      <div className="mt-[14px] overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-ink-muted">
              <th className="p-[8px] text-start font-semibold">{t("devices.device")}</th>
              <th className="p-[8px] text-start font-semibold">{t("devices.connectedSince")}</th>
              <th className="p-[8px] text-start font-semibold">{t("devices.lastSeen")}</th>
              <th className="p-[8px] text-start font-semibold">{t("devices.action")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-[16px] text-center text-ink-faint">
                  {t("devices.noDevicesAreConnectedRight")}
                </td>
              </tr>
            ) : (
              sessions.map((session) => (
                <tr key={session.sessionId} className="border-b border-border last:border-b-0">
                  <td className="p-[8px] font-semibold text-ink">{session.deviceLabel}</td>
                  <td className="p-[8px] mz-num text-ink-muted">{clockTime(session.connectedAt, locale)}</td>
                  <td className="p-[8px] mz-num text-ink-muted">{clockTime(session.lastSeenAt, locale)}</td>
                  <td className="p-[8px]">
                    <Button
                      variant="danger-outline"
                      size="sm"
                      disabled={disconnectingId === session.sessionId}
                      onClick={() => void handleDisconnect(session.sessionId)}
                    >
                      {disconnectingId === session.sessionId ? t("devices.disconnecting") : t("devices.disconnect")}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

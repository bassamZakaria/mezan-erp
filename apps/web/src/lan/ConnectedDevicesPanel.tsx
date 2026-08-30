import { useCallback, useState, type ReactNode } from "react";
import { Button, Card, StatusPill, formatDate, formatTime, type Locale } from "@mezan/ui";
import {
  isDesktopHost,
  useDesktopLicence,
  useDisconnectLanSession,
  useLanSessions,
  useLanStatus,
} from "../data/hooks";
import { useAppTranslation } from "../i18n";

/**
 * Admin panel for LAN multi-till (docs/archive/plan.md §6.3.3): the devices
 * holding a seat, with a per-row disconnect.
 *
 * IT WENT THROUGH A BARE `fetch`, with no `Authorization` header, and that was
 * invisible until every `/lan` route started requiring a session. After that
 * `GET /lan/status` answered 401, this component parsed the ERROR BODY as a
 * status DTO, read `licensed` as `undefined`, and rendered the "multi-till is
 * not licensed" card — so a licensed shop was told its licence was missing,
 * with no error shown anywhere on the screen. The disconnect never checked
 * `res.ok` either, so a 403 rendered as a successful disconnect that silently
 * did nothing. Everything now goes through `useApi()` like every other screen.
 *
 * Per-row actions stay scoped to the row acting on them: only the device being
 * disconnected shows a pending state, a second click while one is in flight is
 * a no-op (guarded in the handler, not by disabling every row), and the pending
 * flag always clears — success or failure.
 */
export interface ConnectedDevicesPanelProps {
  /** Poll interval is owned by the query now; kept so existing callers still compile. */
  pollIntervalMs?: number;
}

function clockTime(epochMs: number, locale: Locale): string {
  return formatTime(epochMs, { locale });
}

/**
 * WHAT THE OWNER SEES WHEN THE LICENCE IS WRONG — which, until now, was
 * nothing at all.
 *
 * `resolveDesktopEntitlements` answered a missing, malformed, invalid or (once
 * it started checking) expired licence with a `console.warn` and a silent fall
 * to zero seats and no modules. The window opened and the product was simply
 * ABSENT: no message, no date, and no code the owner could read down the phone
 * to support, so "what does a user see on an expired licence?" had the honest
 * answer "an app that quietly does less".
 *
 * Exported so the shell can mount it once too — a licence problem is not a
 * connected-devices problem — which needs one line in AppLayout.tsx.
 *
 * It renders NOTHING while the reading is still in flight, and nothing on the
 * browser build, which holds no licence file: a screen that has not been told
 * the licence is fine must not say so, and must not say the opposite either.
 */
export function LicenceStatusNotice() {
  const { t, locale } = useAppTranslation();
  const desktop = isDesktopHost();
  const licence = useDesktopLicence();

  if (!desktop) return null;

  const failureMessage = licence.error
    ? licence.error.message
    : licence.data && !licence.data.ok
      ? licence.data.message
      : null;
  if (failureMessage) {
    return (
      <Card className="mb-[14px] border-danger p-[14px]">
        <p role="alert" className="text-[12.5px] text-danger-ink">
          {failureMessage}
        </p>
      </Card>
    );
  }

  const data = licence.data;
  if (!data || !data.ok || data.code === "LIC-OK") return null;

  return (
    <Card className="mb-[14px] border-warning bg-warning-soft p-[14px]">
      <div className="text-[13px] font-semibold text-ink">{t("licence.problem")}</div>
      <p className="mt-1 text-[12.5px] text-ink">{data.messageAr}</p>
      {data.expiresAt ? (
        <p className="mt-1 text-[12px] text-ink-muted">
          {t("licence.expiryDate")}{" "}
          <span className="mz-num" dir="ltr">
            {formatDate(data.expiresAt, { locale })}
          </span>
        </p>
      ) : null}
      <p className="mt-[6px] text-[12px] text-ink-muted">
        {t("licence.supportCode")}{" "}
        <span className="mz-num font-semibold text-ink" dir="ltr">
          {data.code}
        </span>
      </p>
    </Card>
  );
}

/**
 * THE ADDRESS A TILL IS POINTED AT.
 *
 * `startLanHost` logged `http://<host>:<port>` to a console the shop never
 * opens, so provisioning a till meant a consultant finding the host's IP by
 * hand — the file's own comment called this screen "a future 'show me the LAN
 * address' UI".
 *
 * Every branch below states only what it was told. The browser build cannot
 * know the host's address and says exactly that instead of printing a
 * plausible one; a bound socket with no dialable address (the `0.0.0.0`
 * fallback in lan-host.ts) reads as unknown, not as `http://0.0.0.0:4173`.
 */
function LanAddress() {
  const { t } = useAppTranslation();
  const desktop = isDesktopHost();
  const licence = useDesktopLicence();
  const [copied, setCopied] = useState(false);

  const line = (text: string, alert = false) => (
    <p
      {...(alert ? { role: "alert" } : {})}
      className={`text-[12.5px] ${alert ? "text-danger-ink" : "text-ink-muted"}`}
    >
      {text}
    </p>
  );

  let body: ReactNode;
  if (!desktop) {
    body = line(t("devices.lanAddressDesktopOnly"));
  } else if (licence.error) {
    body = line(licence.error.message, true);
  } else if (!licence.data) {
    body = line(t("common.loading"));
  } else if (!licence.data.ok) {
    body = line(licence.data.message, true);
  } else if (!licence.data.lan.listening) {
    body = line(t("devices.lanNotRunning"));
  } else if (!licence.data.lan.url) {
    body = line(t("devices.lanAddressUnknown"));
  } else {
    const url = licence.data.lan.url;
    // Read at render, not inside the handler: a button that cannot copy must
    // not be on screen at all. The address itself stays selectable either way.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    body = (
      <div className="flex flex-wrap items-center gap-[10px]">
        <code
          dir="ltr"
          className="mz-num select-all rounded-[6px] bg-surface-2 px-[8px] py-[4px] text-[13px] font-semibold text-ink"
        >
          {url}
        </code>
        {clipboard ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void clipboard
                .writeText(url)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {t("devices.copyAddress")}
          </Button>
        ) : null}
        {copied ? <span className="text-[12px] text-ink-muted">{t("devices.addressCopied")}</span> : null}
      </div>
    );
  }

  return (
    <div className="mt-[14px] border-t border-border pt-[12px]">
      <div className="text-[12.5px] font-semibold text-ink">{t("devices.lanAddress")}</div>
      <p className="mb-[6px] mt-1 text-[12px] text-ink-muted">{t("devices.lanAddressHint")}</p>
      {body}
    </div>
  );
}

export function ConnectedDevicesPanel(_props: ConnectedDevicesPanelProps = {}) {
  const { t, locale } = useAppTranslation();
  const status = useLanStatus();
  const licensed = status.data?.licensed === true;
  const sessions = useLanSessions(licensed);
  const disconnect = useDisconnectLanSession();
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDisconnect = useCallback(
    async (sessionId: string) => {
      if (disconnectingId) return; // one in-flight disconnect at a time
      setDisconnectingId(sessionId);
      setActionError(null);
      try {
        await disconnect.mutateAsync(sessionId);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : t("devices.couldNotDisconnectTheDevice"));
      } finally {
        setDisconnectingId(null);
      }
    },
    [disconnect, disconnectingId, t],
  );

  // A REFUSAL IS NOT AN ANSWER. Only a status the server actually gave, saying
  // `licensed: false`, may render the unlicensed card — an error must render as
  // an error, or the screen states something about the licence that it does not
  // know.
  if (status.data && !status.data.licensed) {
    return (
      <Card className="p-[18px]">
        <div className="text-[13px] font-semibold text-ink">{t("devices.devicesConnectedOverTheLocal")}</div>
        <p className="mt-2 text-[12.5px] text-ink-muted">{t("devices.multiTillOverTheLocal")}</p>
      </Card>
    );
  }

  const loadError = status.error ?? sessions.error ?? null;
  const rows = sessions.data?.sessions ?? [];
  // An error is not a reading. While the seat count could not be fetched, the
  // panel must not print "Loading…" forever, and must not render an empty table
  // whose "no devices are connected" line states a fact it does not have —
  // that is the same mistake as the unlicensed card, one step quieter.
  const loaded = status.data !== undefined;

  return (
    <Card className="p-[18px]">
      <div className="flex items-center justify-between gap-[12px]">
        <div>
          <div className="text-[13px] font-semibold text-ink">{t("devices.devicesConnectedOverTheLocal")}</div>
          <p className="mt-1 text-[12px] text-ink-muted">
            {status.data ? (
              <>
                <span className="mz-num font-semibold text-ink">{status.data.connected}</span>
                {" / "}
                <span className="mz-num">{status.data.seats}</span> {t("devices.seatInUse")}
              </>
            ) : loadError ? (
              t("devices.seatUsageUnknown")
            ) : (
              t("common.loading")
            )}
          </p>
        </div>
        {status.data && status.data.connected >= status.data.seats ? (
          <StatusPill label={t("devices.everySeatIsTaken")} tone="warning" />
        ) : status.data ? (
          <StatusPill label={t("devices.available")} tone="success" />
        ) : null}
      </div>

      {loadError ? (
        <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">
          {loadError.message}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">
          {actionError}
        </p>
      ) : null}

      <LanAddress />

      {loaded ? (
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-[16px] text-center text-ink-faint">
                  {t("devices.noDevicesAreConnectedRight")}
                </td>
              </tr>
            ) : (
              rows.map((session) => (
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
      ) : null}
    </Card>
  );
}

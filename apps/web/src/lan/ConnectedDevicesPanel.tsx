import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Card, StatusPill, TextInput, formatDate, formatTime, type Locale } from "@mezan/ui";
import {
  isDesktopHost,
  useDesktopLicence,
  useDisconnectLanSession,
  useLanSessions,
  useLanStatus,
} from "../data/hooks";
import { CopyableValue, PlaintextKeyRiskBanner } from "../settings/SupportInfoCard";
import { pickLocalized, pickMessage } from "../data/server-message";
import { useAppTranslation } from "../i18n";
// lan-ux
import { useConfirmAction } from "../lib/use-confirm-action";
import { pairing, pairingSupported } from "./pairing-bridge";

/**
 * Mirrors main/lan-host.ts's `LanClosedReason`. Declared here rather than
 * imported: the web build compiles with no desktop package present.
 */
type LanClosedReason = "NOT_LICENSED" | "PORT_IN_USE" | "TLS_UNAVAILABLE" | "NO_INTERFACE";

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
      ? pickMessage(licence.data, locale)
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
  if (!data || !data.ok) return null;

  return (
    <>
      {/*
        The two plaintext files, which are a risk whatever the licence says —
        so this renders even on a perfectly licensed install.
      */}
      <PlaintextKeyRiskBanner />
      {data.code === "LIC-OK" ? null : (
        <Card className="mb-[14px] border-warning bg-warning-soft p-[14px]">
          <div className="text-[13px] font-semibold text-ink">{t("licence.problem")}</div>
          <p className="mt-1 text-[12.5px] text-ink">{pickLocalized(data.messageAr, data.messageEn, locale)}</p>
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
          {/*
            THE FINGERPRINT, on the notice itself. A replacement PC restoring its
            backup meets `FINGERPRINT_MISMATCH`, and neither the owner nor
            support could obtain the one string that would let a new licence be
            issued: there was no flag, no panel and no log carrying it.
          */}
          {data.fingerprint ? (
            <div className="mt-[8px] flex flex-col gap-[4px] text-[12px] text-ink-muted">
              <span>{t("licenceUi.fingerprint")}</span>
              <CopyableValue
                value={data.fingerprint}
                copyLabel={t("licenceUi.copy")}
                copiedLabel={t("licenceUi.copied")}
              />
            </div>
          ) : null}
        </Card>
      )}
    </>
  );
}

function line(text: string, alert = false) {
  return (
    <p
      {...(alert ? { role: "alert" } : {})}
      className={`text-[12.5px] ${alert ? "text-danger-ink" : "text-ink-muted"}`}
    >
      {text}
    </p>
  );
}

/**
 * A verbatim value the operator has to READ OFF THE SCREEN and compare — an
 * address, a certificate fingerprint. `dir="ltr"` and `select-all` because
 * both are Latin/hex inside an RTL page, where an unmarked run reorders and a
 * consultant then compares two strings that differ only in how they were laid
 * out.
 */
function VerbatimFact({
  value,
  copyLabel,
  copiedLabel,
  copied,
  onCopied,
}: {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  copied: boolean;
  onCopied: (ok: boolean) => void;
}) {
  // Read at render, not inside the handler: a button that cannot copy must not
  // be on screen at all. The value itself stays selectable either way.
  const clipboard = navigator.clipboard as Clipboard | undefined;
  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <code
        dir="ltr"
        className="mz-num select-all break-all rounded-[6px] bg-surface-2 px-[8px] py-[4px] text-[13px] font-semibold text-ink"
      >
        {value}
      </code>
      {clipboard ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void clipboard
              .writeText(value)
              .then(() => onCopied(true))
              .catch(() => onCopied(false));
          }}
        >
          {copyLabel}
        </Button>
      ) : null}
      {copied ? <span className="text-[12px] text-ink-muted">{copiedLabel}</span> : null}
    </div>
  );
}

/**
 * THE ADDRESS A TILL IS POINTED AT, AND THE FINGERPRINT IT PINS.
 *
 * `startLanHost` logged the address to a console the shop never opens, so
 * provisioning a till meant a consultant finding the host's IP by hand — the
 * file's own comment called this screen "a future 'show me the LAN address'
 * UI".
 *
 * The fingerprint is here for a harder reason. That socket now serves TLS, but
 * with a self-signed certificate no chain validates (there is no CA a shop LAN
 * can reach), so encryption alone still lets any laptop that answers first on
 * `192.168.1.7:4173` present its own key and collect the password. What closes that
 * is the till PINNING this exact SHA-256 — and the only place a human can read
 * it is the host's own screen, which is this one.
 *
 * Every branch below states only what it was told. The browser build cannot
 * know either fact and says exactly that instead of printing a plausible one;
 * a bound socket with no dialable address (the `0.0.0.0` fallback in
 * lan-host.ts) reads as unknown, not as `https://0.0.0.0:4173`.
 */
function LanAddress() {
  const { t, locale } = useAppTranslation();
  const desktop = isDesktopHost();
  const licence = useDesktopLicence();
  const [copied, setCopied] = useState<"address" | "fingerprint" | null>(null);

  let body: ReactNode;
  if (!desktop) {
    body = line(t("devices.lanAddressDesktopOnly"));
  } else if (licence.error) {
    body = line(licence.error.message, true);
  } else if (!licence.data) {
    body = line(t("common.loading"));
  } else if (!licence.data.ok) {
    body = line(pickMessage(licence.data, locale), true);
  } else if (!licence.data.lan.listening) {
    // lan-ux (N-5): four faults, four different fixes. «الشبكة المحلية غير
    // مشغّلة» named none of them and the distinguishing reason went to a
    // console — one sentence, and the shop cannot act on any of it.
    const reason = (licence.data.lan as { closedReason?: LanClosedReason | null }).closedReason ?? null;
    body = (
      <>
        {line(t("devices.lanNotRunning"))}
        {reason ? (
          <p className="mt-[6px] text-[12.5px] text-ink">{t(`devices.lanClosed.${reason}`)}</p>
        ) : null}
      </>
    );
  } else if (!licence.data.lan.url) {
    body = line(t("devices.lanAddressUnknown"));
  } else {
    body = (
      <VerbatimFact
        value={licence.data.lan.url}
        copyLabel={t("devices.copyAddress")}
        copiedLabel={t("devices.addressCopied")}
        copied={copied === "address"}
        onCopied={(ok) => setCopied(ok ? "address" : null)}
      />
    );
  }

  // Shown independently of `listening`: the fingerprint is read from the
  // certificate on disk, so the host can name it in the moment between the
  // identity being loaded and the socket binding. Suppressed entirely while
  // the licence read is in flight or has failed — the alert above already says
  // what went wrong, and a second "unknown" under it would read as a separate
  // fault.
  let fingerprintBody: ReactNode = null;
  if (!desktop) {
    fingerprintBody = line(t("devices.lanFingerprintDesktopOnly"));
  } else if (licence.data?.ok) {
    const fingerprint = licence.data.lan.fingerprintSha256;
    fingerprintBody = fingerprint ? (
      <VerbatimFact
        value={fingerprint}
        copyLabel={t("devices.copyFingerprint")}
        copiedLabel={t("devices.fingerprintCopied")}
        copied={copied === "fingerprint"}
        onCopied={(ok) => setCopied(ok ? "fingerprint" : null)}
      />
    ) : (
      line(t("devices.lanFingerprintUnknown"))
    );
  }

  return (
    <div className="mt-[14px] border-t border-border pt-[12px]">
      <div className="text-[12.5px] font-semibold text-ink">{t("devices.lanAddress")}</div>
      <p className="mb-[6px] mt-1 text-[12px] text-ink-muted">{t("devices.lanAddressHint")}</p>
      {body}
      <ReachabilityTest />
      {fingerprintBody ? (
        <div className="mt-[12px]">
          <div className="text-[12.5px] font-semibold text-ink">{t("devices.lanFingerprint")}</div>
          <p className="mb-[6px] mt-1 text-[12px] text-ink-muted">{t("devices.lanFingerprintHint")}</p>
          {fingerprintBody}
        </div>
      ) : null}
    </div>
  );
}

/**
 * «اختبر الوصول» — the host asking whether it can reach its OWN LAN address.
 *
 * The only probe in the product that separates "Mezan is not listening" from
 * "something between the till and this machine is dropping the packets", which
 * `INSTALL.md §7A.3` names as the most likely LAN failure there is and which
 * nothing could diagnose from either side. A host that fails its own test has a
 * local firewall rule in the way; a host that passes it while a till still
 * cannot connect has a network problem the till's own message names.
 */
function ReachabilityTest() {
  const { t } = useAppTranslation();
  const [state, setState] = useState<
    { readonly phase: "idle" | "running" } | { readonly phase: "done"; readonly message: string }
  >({ phase: "idle" });

  if (!pairingSupported()) return null;

  return (
    <div className="mt-[10px]">
      <Button
        variant="ghost"
        size="sm"
        disabled={state.phase === "running"}
        onClick={() => {
          setState({ phase: "running" });
          void pairing({ kind: "selftest" })
            .then((res) => {
              if (res?.kind !== "selftest") {
                setState({ phase: "done", message: t("devices.reachability.unknown") });
                return;
              }
              setState({
                phase: "done",
                message: res.reachable
                  ? t("devices.reachability.ok", { address: res.address ?? "" })
                  : res.detail === "NO_INTERFACE"
                    ? t("devices.reachability.noInterface")
                    : res.detail === "TIMEOUT"
                      ? t("devices.reachability.blocked")
                      : t("devices.reachability.notListening"),
              });
            })
            .catch(() => setState({ phase: "done", message: t("devices.reachability.unknown") }));
        }}
      >
        {state.phase === "running" ? t("devices.reachability.testing") : t("devices.reachability.test")}
      </Button>
      {state.phase === "done" ? (
        <p role="status" className="mt-[6px] text-[12.5px] text-ink">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * THE ADDRESS THIS TILL IS POINTED AT, EDITABLE — the recovery for a router
 * reboot, which is the failure that takes three tills down at once.
 *
 * The pinned certificate is NOT editable here and cannot be: `relocate` on the
 * desktop side moves the address while keeping the pin and the device id, so
 * this can never walk a till onto a different machine, and re-pointing does not
 * burn a second seat. «ابحث عن الجهاز الرئيسي» does the same thing without
 * anybody having to know an IP address at all.
 */
function ClientHostAddress() {
  const { t, locale } = useAppTranslation();
  const [hostUrl, setHostUrl] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!pairingSupported()) return;
    void pairing({ kind: "state" }).then((res) => {
      if (res?.kind !== "state" || res.role !== "client") return;
      setHostUrl(res.hostUrl);
      setTyped(res.hostUrl ?? "");
    });
  }, []);

  if (hostUrl === null) return null;

  async function apply(address: string) {
    setBusy(true);
    setNotice(null);
    const res = await pairing({ kind: "relocate", accept: address }).catch(() => null);
    setBusy(false);
    if (res?.kind === "relocate" && res.ok) setNotice(t("devices.hostUrl.saved"));
    else setNotice(res?.kind === "relocate" ? pickMessage(res, locale) : t("devices.hostUrl.failed"));
  }

  return (
    <div className="mt-[14px] border-t border-border pt-[12px]">
      <div className="text-[12.5px] font-semibold text-ink">{t("devices.hostUrl.title")}</div>
      <p className="mb-[6px] mt-1 text-[12px] text-ink-muted">{t("devices.hostUrl.hint")}</p>
      <div className="flex flex-wrap items-center gap-[8px]">
        <TextInput dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <Button
          variant="default"
          size="sm"
          disabled={busy || typed.trim() === "" || typed.trim() === hostUrl}
          onClick={() => void apply(typed.trim())}
        >
          {busy ? t("devices.hostUrl.saving") : t("devices.hostUrl.save")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNotice(null);
            void pairing({ kind: "relocate" })
              .then((res) => {
                setBusy(false);
                if (res?.kind === "relocate" && res.ok) {
                  setTyped(res.found);
                  setNotice(t("devices.hostUrl.found", { address: res.found }));
                } else {
                  setNotice(res?.kind === "relocate" ? pickMessage(res, locale) : t("devices.hostUrl.failed"));
                }
              })
              .catch(() => {
                setBusy(false);
                setNotice(t("devices.hostUrl.failed"));
              });
          }}
        >
          {t("devices.hostUrl.search")}
        </Button>
      </div>
      {notice ? (
        <p role="status" className="mt-[8px] text-[12.5px] text-ink">
          {notice}
        </p>
      ) : null}
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
  /**
   * lan-ux (N-8): DISCONNECTING A TILL IS DESTRUCTIVE AND FIRED ON CLICK.
   *
   * It revokes that device's bearer token, so the cashier three metres away
   * loses the invoice they were typing — and this row sat one mis-aimed tap
   * away from doing it, on a screen whose own hint encourages pressing it. The
   * dialog names the DEVICE and says what will happen to it, because "are you
   * sure?" is not a question anybody can answer.
   */
  const confirm = useConfirmAction();

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
                      onClick={() =>
                        confirm.ask({
                          title: t("devices.confirmDisconnect.title", { device: session.deviceLabel }),
                          consequence: t("devices.confirmDisconnect.consequence", {
                            device: session.deviceLabel,
                          }),
                          confirmLabel: t("devices.confirmDisconnect.confirm"),
                          onConfirm: () => handleDisconnect(session.sessionId),
                        })
                      }
                    >
                      {disconnectingId === session.sessionId ? t("devices.disconnecting") : t("devices.disconnect")}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="mt-[8px] text-[12px] text-ink-muted">{t("devices.staleSeatHint")}</p>
      </div>
      ) : null}

      <ClientHostAddress />
      {confirm.dialog}
    </Card>
  );
}

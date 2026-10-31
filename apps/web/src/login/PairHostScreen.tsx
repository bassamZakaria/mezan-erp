import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { BrandMark, Button, Card, TextInput } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import {
  fingerprintGroups,
  lanErrorKey,
  pairing,
  pairingSupported,
  sameFingerprint,
  type DiscoveredHostDTO,
} from "../lan/pairing-bridge";

/**
 * «الاتصال بجهاز رئيسي» — pairing a till, and re-pairing one whose host no
 * longer matches, without a command line.
 *
 * WHAT IT REPLACES. Pairing was `--pair-host=… --pair-fingerprint=…`, so a shop
 * could never add its own fourth till and every rollout was a consultant at a
 * terminal on each machine; and a certificate mismatch — the state that means
 * either "the host was reinstalled" or "somebody else is answering on that
 * address" — surfaced as two 64-hex strings inside an English sentence with no
 * button anywhere. `INSTALL.md §6.3` described comparing the fingerprint by eye
 * as a step the operator performs; there was nothing on screen to compare.
 *
 * THE COMPARISON IS THE SECURITY CONTROL, and the whole layout is built around
 * making it performable. The certificate is self-signed and chain-validated by
 * nothing, so what stops a laptop answering first on `192.168.1.7:4173` and
 * collecting the password is one human, once, checking that the value this screen
 * shows is the value on the host's own «الأجهزة المتصلة» screen. That is why
 * the fingerprints are grouped in fours, marked `dir="ltr"` inside an RTL page,
 * and why «الشهادتان متطابقتان — اقترن» is a separate, deliberate press rather
 * than a step the flow takes on the operator's behalf.
 *
 * Discovery is a CONVENIENCE ONLY. mDNS is unauthenticated — anything on the
 * wifi can advertise — and it is blocked outright on plenty of networks, so
 * typing the address is always available and an empty list never reads as
 * "there is no host here".
 */

type Mode = "choose" | "compare" | "mismatch" | "unreachable";

interface Candidate {
  readonly hostUrl: string;
  readonly presentedFingerprint: string;
}

function Fingerprint({ value, tone }: { value: string; tone?: "danger" | "success" }) {
  const groups = fingerprintGroups(value);
  return (
    <code
      dir="ltr"
      className={`mz-num block select-all break-all rounded-[6px] px-[10px] py-[8px] text-[13px] font-semibold leading-[1.9] ${
        tone === "danger"
          ? "bg-danger-soft text-danger-ink"
          : tone === "success"
            ? "bg-success-soft text-ink"
            : "bg-surface-2 text-ink"
      }`}
    >
      {groups.join("  ")}
    </code>
  );
}

export function PairHostScreen() {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // `fault` is how the shell hands this screen a transport failure it already
  // diagnosed, so the operator lands on the screen that matches what went
  // wrong instead of on a generic form.
  const fault = params.get("fault");
  const [mode, setMode] = useState<Mode>(
    fault === "PIN_MISMATCH" ? "mismatch" : fault ? "unreachable" : "choose",
  );

  const [hosts, setHosts] = useState<readonly DiscoveredHostDTO[]>([]);
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  const [pairedHost, setPairedHost] = useState<string | null>(params.get("host"));
  const [presented, setPresented] = useState<string | null>(params.get("presented"));
  const [relocated, setRelocated] = useState<string | null>(null);
  const [searchedForHost, setSearchedForHost] = useState(false);

  const supported = pairingSupported();

  useEffect(() => {
    if (!supported) return;
    void pairing({ kind: "state" }).then((res) => {
      if (res?.kind !== "state") return;
      setPinned(res.pinnedFingerprint);
      setPairedHost((current) => current ?? res.hostUrl);
      setDeviceLabel((current) => current || res.deviceLabel);
    });
  }, [supported]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    const res = await pairing({ kind: "discover" }).catch(() => null);
    setScanning(false);
    if (res?.kind === "discover") setHosts(res.hosts);
  }, []);

  useEffect(() => {
    if (supported && mode === "choose") void scan();
  }, [supported, mode, scan]);

  /**
   * Looks for the PINNED host at a new address. Not a pairing: the certificate
   * this client accepts does not change, so a machine found this way is
   * provably the same one — which is what makes accepting it safe without
   * another human comparison.
   */
  const findMovedHost = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await pairing({ kind: "relocate" }).catch(() => null);
    setBusy(false);
    setSearchedForHost(true);
    if (res?.kind === "relocate" && res.ok) setRelocated(res.found);
    else if (res?.kind === "relocate") setError(res.message);
  }, []);

  useEffect(() => {
    if (mode === "unreachable" && supported && !searchedForHost) void findMovedHost();
  }, [mode, supported, searchedForHost, findMovedHost]);

  async function probe(hostUrl: string) {
    setBusy(true);
    setError(null);
    const res = await pairing({ kind: "probe", hostUrl }).catch(() => null);
    setBusy(false);
    if (!res || res.kind !== "probe") {
      setError(t("pair.probeFailed"));
      return;
    }
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setCandidate({ hostUrl: res.hostUrl, presentedFingerprint: res.presentedFingerprint });
    setMode("compare");
  }

  async function confirmPairing() {
    if (!candidate) return;
    setBusy(true);
    setError(null);
    const res = await pairing({
      kind: "confirm",
      hostUrl: candidate.hostUrl,
      fingerprintSha256: candidate.presentedFingerprint,
      deviceLabel: deviceLabel.trim() || undefined,
    }).catch(() => null);
    setBusy(false);
    if (res?.kind === "confirm" && res.ok) {
      setError(null);
      setMode("choose");
      setCandidate(null);
      // The app restarts itself into client mode; nothing else here runs.
      return;
    }
    setError(res?.kind === "confirm" ? res.message : t("pair.confirmFailed"));
  }

  async function acceptMove() {
    if (!relocated) return;
    setBusy(true);
    await pairing({ kind: "relocate", accept: relocated }).catch(() => null);
    // Relaunching; the button stays busy until the window goes away.
  }

  if (!supported) {
    return (
      <Shell title={t("pair.title")}>
        <p className="text-[12.5px] text-ink-muted">{t("pair.desktopOnly")}</p>
        <Button variant="ghost" size="sm" className="mt-[12px]" onClick={() => void navigate("/")}>
          {t("pair.back")}
        </Button>
      </Shell>
    );
  }

  /**
   * THE MISMATCH SCREEN. The one state where the product must be loud and must
   * not offer a way past: the machine answering on the paired address is not
   * the machine this till was paired with, and the two innocent explanations
   * (the host was reinstalled) and the dangerous one (somebody else is
   * answering) are indistinguishable from here. So it says what happened, says
   * that NOTHING was sent, shows both fingerprints, and offers re-pairing —
   * which is a compare-and-confirm, not a "trust it" button.
   */
  if (mode === "mismatch") {
    return (
      <Shell title={t("pair.mismatch.title")} tone="danger">
        <p className="text-[13px] text-danger-ink">{t("pair.mismatch.body")}</p>
        <p className="mt-[8px] text-[12.5px] font-semibold text-ink">{t("pair.mismatch.nothingSent")}</p>
        {pairedHost ? (
          <p className="mt-[10px] text-[12px] text-ink-muted">
            {t("pair.pairedWith")} <span dir="ltr" className="mz-num">{pairedHost}</span>
          </p>
        ) : null}
        <div className="mt-[14px] grid gap-[12px]">
          <div>
            <div className="mb-[4px] text-[12px] font-semibold text-ink-muted">{t("pair.expected")}</div>
            {pinned ? <Fingerprint value={pinned} tone="success" /> : <p className="text-[12px] text-ink-faint">{t("pair.unknown")}</p>}
          </div>
          <div>
            <div className="mb-[4px] text-[12px] font-semibold text-ink-muted">{t("pair.presented")}</div>
            {presented ? <Fingerprint value={presented} tone="danger" /> : <p className="text-[12px] text-ink-faint">{t("pair.unknown")}</p>}
          </div>
        </div>
        <p className="mt-[14px] rounded-[6px] border border-warning bg-warning-soft p-[10px] text-[12.5px] text-ink">
          {t("pair.mismatch.warning")}
        </p>
        <div className="mt-[14px] flex flex-wrap gap-[8px]">
          <Button
            variant="danger-outline"
            size="sm"
            onClick={() => {
              setPresented(null);
              setCandidate(null);
              setMode("choose");
            }}
          >
            {t("pair.mismatch.repair")}
          </Button>
        </div>
      </Shell>
    );
  }

  /**
   * THE UNREACHABLE SCREEN. Named, with the paired address on it, a retry, a
   * way into the pairing settings — and, when the pinned certificate has been
   * found somewhere else on the subnet, the one-press recovery for the failure
   * that actually causes this: the router handed the host a new address.
   */
  if (mode === "unreachable") {
    return (
      <Shell title={t("lan.unreachable.title")}>
        <p className="text-[13px] text-ink">{t(lanErrorKey(fault), { host: pairedHost ?? "" })}</p>
        {pairedHost ? (
          <p className="mt-[10px] text-[12px] text-ink-muted">
            {t("pair.pairedWith")} <span dir="ltr" className="mz-num">{pairedHost}</span>
          </p>
        ) : null}

        {relocated ? (
          <div className="mt-[14px] rounded-[6px] border border-brand bg-surface-2 p-[12px]">
            <p className="text-[12.5px] text-ink">
              {t("pair.moved", { address: relocated })}
            </p>
            <Button variant="default" size="sm" className="mt-[10px]" disabled={busy} onClick={() => void acceptMove()}>
              {t("pair.moved.accept")}
            </Button>
          </div>
        ) : searchedForHost && !busy ? (
          <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("pair.notFoundOnNetwork")}</p>
        ) : (
          <p className="mt-[12px] text-[12.5px] text-ink-muted">{t("pair.searching")}</p>
        )}

        {error ? <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">{error}</p> : null}

        <div className="mt-[14px] flex flex-wrap gap-[8px]">
          <Button variant="default" size="sm" onClick={() => window.location.reload()}>
            {t("lan.unreachable.retry")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setSearchedForHost(false);
              setRelocated(null);
              void findMovedHost();
            }}
          >
            {t("pair.searchAgain")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode("choose")}>
            {t("lan.unreachable.openPairing")}
          </Button>
        </div>
      </Shell>
    );
  }

  if (mode === "compare" && candidate) {
    const matchesPin = sameFingerprint(pinned, candidate.presentedFingerprint);
    return (
      <Shell title={t("pair.compare.title")}>
        <p className="text-[12.5px] text-ink-muted">{t("pair.compare.hint")}</p>
        <p className="mt-[10px] text-[12px] text-ink-muted">
          {t("pair.address")} <span dir="ltr" className="mz-num font-semibold text-ink">{candidate.hostUrl}</span>
        </p>

        <div className="mt-[14px] grid gap-[12px]">
          {pinned ? (
            <div>
              <div className="mb-[4px] text-[12px] font-semibold text-ink-muted">{t("pair.expected")}</div>
              <Fingerprint value={pinned} tone={matchesPin ? "success" : "danger"} />
            </div>
          ) : null}
          <div>
            <div className="mb-[4px] text-[12px] font-semibold text-ink-muted">{t("pair.presented")}</div>
            <Fingerprint value={candidate.presentedFingerprint} tone={pinned && !matchesPin ? "danger" : undefined} />
          </div>
        </div>

        <label className="mt-[14px] block text-[12px] font-semibold text-ink-muted" htmlFor="pair-device-label">
          {t("pair.deviceLabel")}
        </label>
        <TextInput
          id="pair-device-label"
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.target.value)}
          placeholder={t("pair.deviceLabelPlaceholder")}
        />

        {error ? <p role="alert" className="mt-[10px] text-[12px] text-danger-ink">{error}</p> : null}

        <div className="mt-[14px] flex flex-wrap gap-[8px]">
          <Button variant="default" size="sm" disabled={busy} onClick={() => void confirmPairing()}>
            {busy ? t("pair.working") : t("pair.confirm")}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setCandidate(null); setMode("choose"); }}>
            {t("pair.cancel")}
          </Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={t("pair.title")}>
      <p className="text-[12.5px] text-ink-muted">{t("pair.hint")}</p>

      <div className="mt-[14px]">
        <div className="flex items-center justify-between gap-[8px]">
          <div className="text-[12.5px] font-semibold text-ink">{t("pair.discovered")}</div>
          <Button variant="ghost" size="sm" disabled={scanning} onClick={() => void scan()}>
            {scanning ? t("pair.scanning") : t("pair.rescan")}
          </Button>
        </div>
        {hosts.length === 0 ? (
          <p className="mt-[8px] text-[12px] text-ink-muted">
            {scanning ? t("pair.scanning") : t("pair.noneFound")}
          </p>
        ) : (
          <ul className="mt-[8px] grid gap-[8px]">
            {hosts.map((host) => (
              <li key={host.hostUrl}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void probe(host.hostUrl)}
                  className="w-full rounded-[6px] border border-border bg-surface-2 p-[10px] text-start hover:border-brand"
                >
                  <div className="text-[12.5px] font-semibold text-ink">{host.name}</div>
                  <div dir="ltr" className="mz-num text-[12px] text-ink-muted">{host.hostUrl}</div>
                  {host.advertisedFingerprint ? (
                    <div dir="ltr" className="mz-num mt-[4px] break-all text-[11px] text-ink-faint">
                      {fingerprintGroups(host.advertisedFingerprint).slice(0, 4).join("  ")}…
                    </div>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-[16px] border-t border-border pt-[12px]">
        <label className="block text-[12px] font-semibold text-ink-muted" htmlFor="pair-host-url">
          {t("pair.typeAddress")}
        </label>
        <p className="mb-[6px] mt-[2px] text-[12px] text-ink-faint">{t("pair.typeAddressHint")}</p>
        <div className="flex flex-wrap items-center gap-[8px]">
          <TextInput
            id="pair-host-url"
            dir="ltr"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="https://192.168.1.7:4173"
          />
          <Button
            variant="default"
            size="sm"
            disabled={busy || typed.trim() === ""}
            onClick={() => void probe(typed.trim())}
          >
            {busy ? t("pair.working") : t("pair.connect")}
          </Button>
        </div>
      </div>

      {error ? <p role="alert" className="mt-[12px] text-[12px] text-danger-ink">{error}</p> : null}

      <Button variant="ghost" size="sm" className="mt-[14px]" onClick={() => void navigate("/")}>
        {t("pair.back")}
      </Button>
    </Shell>
  );
}

function Shell({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[20px]">
      <Card className={`w-full max-w-[560px] p-[22px] ${tone === "danger" ? "border-danger" : ""}`}>
        <div className="mb-[12px] flex items-center gap-[10px]">
          <BrandMark />
          <h1 className="font-display text-[16px] font-bold text-ink">{title}</h1>
        </div>
        {children}
      </Card>
    </div>
  );
}

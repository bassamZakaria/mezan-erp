import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Button, Card } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { lanErrorKey, pairing, pairingSupported } from "./pairing-bridge";

/**
 * ON A CLIENT MACHINE, "THE HOST IS NOT ANSWERING" IS A SCREEN.
 *
 * It used to be a login form that failed after a thirty-second freeze with one
 * bilingual sentence carrying a URL and a millisecond count — the same sentence
 * for a sleeping host, a closed app, a changed IP, a firewall and a certificate
 * mismatch. Five faults, five different things to do, one message.
 *
 * The probe is `GET /health`, which is on the LAN socket's public list for
 * exactly this reason: it is how a till tells "the host is off" from "the host
 * refused me". On a client the transport answers it over the pinned socket, so
 * a failure here is a TRANSPORT failure and the 502 body carries the code that
 * says which one (main/ipc.ts).
 *
 * NON-BLOCKING BY DESIGN. Children render immediately and are replaced only
 * once a probe has actually failed: a gate that waited for a round trip before
 * painting would add the host's latency to every launch, including the host's
 * own, where this component has nothing to do at all.
 */

interface LanFailure {
  readonly code: string;
  readonly host: string;
  readonly presentedFingerprint?: string;
  readonly expectedFingerprint?: string;
}

/** The five codes the transport produces. Anything else falls back to UNREACHABLE. */
const KNOWN_CODES = new Set(["PIN_MISMATCH", "UNREACHABLE", "TIMEOUT", "NO_SEAT", "VERSION_MISMATCH"]);

interface DesktopFetch {
  (input: string, init?: RequestInit): Promise<{ status: number; body: string }>;
}

function desktopFetch(): DesktopFetch | undefined {
  return (globalThis as { mezan?: { fetch?: DesktopFetch } }).mezan?.fetch;
}

export async function probeHost(): Promise<LanFailure | null> {
  const call = desktopFetch();
  if (!call) return null;
  let response: { status: number; body: string };
  try {
    response = await call("http://mezan.local/health");
  } catch {
    return { code: "UNREACHABLE", host: "" };
  }
  if (response.status !== 502) return null;
  try {
    const body = JSON.parse(response.body) as Partial<LanFailure> & { code?: string };
    const code = body.code && KNOWN_CODES.has(body.code) ? body.code : "UNREACHABLE";
    return {
      code,
      host: body.host ?? "",
      ...(body.presentedFingerprint ? { presentedFingerprint: body.presentedFingerprint } : {}),
      ...(body.expectedFingerprint ? { expectedFingerprint: body.expectedFingerprint } : {}),
    };
  } catch {
    return { code: "UNREACHABLE", host: "" };
  }
}

export function LanHostGate({ children }: { children: ReactNode }) {
  const { t } = useAppTranslation();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<LanFailure | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (!pairingSupported()) return;
    const state = await pairing({ kind: "state" }).catch(() => null);
    if (state?.kind !== "state" || state.role !== "client") return;
    setChecking(true);
    const result = await probeHost();
    setChecking(false);
    setFailure(result);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!failure) return <>{children}</>;

  const pairingHref =
    `/pair-host?fault=${encodeURIComponent(failure.code)}` +
    `&host=${encodeURIComponent(failure.host)}` +
    (failure.presentedFingerprint ? `&presented=${encodeURIComponent(failure.presentedFingerprint)}` : "");

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-[20px]">
      <Card className="w-full max-w-[520px] border-danger p-[22px]">
        <h1 className="font-display text-[16px] font-bold text-ink">{t("lan.unreachable.title")}</h1>
        <p role="alert" className="mt-[10px] text-[13px] text-ink">
          {t(lanErrorKey(failure.code), { host: failure.host })}
        </p>
        {failure.host ? (
          <p className="mt-[10px] text-[12px] text-ink-muted">
            {t("pair.pairedWith")}{" "}
            <span dir="ltr" className="mz-num font-semibold text-ink">
              {failure.host}
            </span>
          </p>
        ) : null}
        <div className="mt-[16px] flex flex-wrap gap-[8px]">
          <Button variant="default" size="sm" disabled={checking} onClick={() => void check()}>
            {checking ? t("lan.unreachable.retrying") : t("lan.unreachable.retry")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void navigate(pairingHref)}>
            {t("lan.unreachable.openPairing")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { connect as tlsConnect } from "node:tls";

/**
 * FINDING THE HOST WITHOUT A CONSULTANT AT A TERMINAL.
 *
 * Pairing a till used to be `--pair-host=https://192.168.1.7:4173
 * --pair-fingerprint=AB:CD:…` typed at a command line, which means the shop can
 * never add a fourth till by itself and every DHCP change is another site
 * visit. Two mechanisms replace that, and they answer different questions:
 *
 *   - `advertiseLanHost` publishes `_mezan._tcp` on the subnet with the host's
 *     certificate fingerprint in TXT, so a machine that has never been paired
 *     can LIST the hosts it can see rather than being told an address.
 *   - `probeSubnetForFingerprint` walks the local /24 looking for the ONE
 *     certificate a client already pinned, which is what recovers a paired till
 *     after the router hands the host a new address.
 *
 * NEITHER IS A TRUST DECISION. mDNS is unauthenticated — anything on the wifi
 * can answer, and the fingerprint in a TXT record is whatever the responder
 * chose to put there. It is a way to save typing an address, nothing more: what
 * makes a pairing safe is still a human comparing the fingerprint the host
 * shows on its own screen against the one the candidate presented on the wire
 * (`probeHostCertificate` below reads the second, and reads it from the
 * HANDSHAKE, not from the advertisement).
 *
 * `bonjour-service` is imported LAZILY and THROUGH A VARIABLE, so this module
 * loads on a machine where it was never installed and discovery simply reports
 * nothing. Typing an address by hand is the fallback that must always work —
 * mDNS is blocked outright on plenty of shop networks — so a missing dependency
 * degrades to the same path a blocked multicast does rather than to a crash on
 * the first-run screen.
 */

/** The DNS-SD service type. `_mezan._tcp`, as the responder spells it. */
const SERVICE_TYPE = "mezan";

/** TXT key carrying the host certificate's SHA-256 fingerprint. */
const TXT_FINGERPRINT = "fp";

export interface DiscoveredHost {
  /** The advertised instance name — the shop's own machine name. */
  readonly name: string;
  /** `https://192.168.1.7:4173`, built from the answer's address and port. */
  readonly hostUrl: string;
  /**
   * The fingerprint the ADVERTISEMENT claimed, or null when it carried none.
   *
   * Never pinned from here. It is shown beside the one the handshake actually
   * presented so a disagreement between the two is visible; the handshake wins.
   */
  readonly advertisedFingerprint: string | null;
}

interface BonjourLike {
  publish(config: {
    name: string;
    type: string;
    port: number;
    txt?: Record<string, string>;
  }): { stop?: (cb?: () => void) => void };
  find(
    config: { type: string },
    onUp: (service: {
      name?: string;
      port?: number;
      addresses?: string[];
      txt?: Record<string, string>;
    }) => void,
  ): { stop?: () => void };
  unpublishAll(cb?: () => void): void;
  destroy(): void;
}

async function loadBonjour(): Promise<(new () => BonjourLike) | null> {
  // A VARIABLE specifier, deliberately: a literal one makes the package a hard
  // build-time dependency of a module whose whole contract is that it works
  // without it.
  const specifier = "bonjour-service";
  try {
    const mod: unknown = await import(specifier);
    const ctor = (mod as { Bonjour?: unknown })?.Bonjour;
    return typeof ctor === "function" ? (ctor as new () => BonjourLike) : null;
  } catch {
    return null;
  }
}

export interface AdvertiseOptions {
  readonly port: number;
  readonly fingerprintSha256: string;
  /** What the till's list calls this machine. */
  readonly name: string;
}

/**
 * Publishes this host on the subnet. Returns a stop function that is safe to
 * call whether or not the advertisement ever started.
 *
 * Nothing here is allowed to throw into the caller: a host whose mDNS
 * responder cannot bind must still serve tills that were paired by hand.
 */
export function advertiseLanHost(options: AdvertiseOptions): () => Promise<void> {
  let instance: BonjourLike | null = null;
  let stopped = false;

  const started = loadBonjour()
    .then((Bonjour) => {
      if (!Bonjour || stopped) {
        if (!Bonjour) {
          console.warn(
            "[lan] mDNS discovery is unavailable on this build (bonjour-service is not installed). " +
              "Tills can still be paired by typing the address shown on the connected-devices screen.",
          );
        }
        return;
      }
      instance = new Bonjour();
      instance.publish({
        name: options.name,
        type: SERVICE_TYPE,
        port: options.port,
        txt: { [TXT_FINGERPRINT]: options.fingerprintSha256 },
      });
      console.log(`[lan] advertising _${SERVICE_TYPE}._tcp as "${options.name}" on port ${options.port}`);
    })
    .catch((err: unknown) => {
      console.warn("[lan] could not advertise this host over mDNS", err);
    });

  return async () => {
    stopped = true;
    await started;
    const live = instance;
    if (!live) return;
    instance = null;
    await new Promise<void>((resolve) => {
      try {
        live.unpublishAll(() => {
          live.destroy();
          resolve();
        });
      } catch {
        resolve();
      }
    });
  };
}

/**
 * Every Mezan host answering on this subnet, collected for `timeoutMs`.
 *
 * Time-boxed rather than streamed: the screen this feeds shows a list and a
 * «ابحث مرة أخرى» button, and a list that grows under the operator's cursor
 * while they are reading a fingerprint is worse than one that settles.
 */
export async function discoverLanHosts(timeoutMs = 3_000): Promise<readonly DiscoveredHost[]> {
  const Bonjour = await loadBonjour();
  if (!Bonjour) return [];

  const found = new Map<string, DiscoveredHost>();
  let instance: BonjourLike | null = null;
  try {
    instance = new Bonjour();
  } catch {
    return [];
  }

  const browser = instance.find({ type: SERVICE_TYPE }, (service) => {
    const address = (service.addresses ?? []).find((a) => isIP(a) === 4);
    if (!address || !service.port) return;
    const hostUrl = `https://${address}:${service.port}`;
    found.set(hostUrl, {
      name: service.name?.trim() || address,
      hostUrl,
      advertisedFingerprint: service.txt?.[TXT_FINGERPRINT]?.toUpperCase() ?? null,
    });
  });

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });

  try {
    browser.stop?.();
    instance.destroy();
  } catch {
    // A responder that is already gone is the state we wanted.
  }

  return [...found.values()];
}

export interface ProbedCertificate {
  /** `AB:CD:…` exactly as a pinning client computes it. */
  readonly fingerprintSha256: string;
  /** The certificate's subject CN, for the "is this even a Mezan host" line. */
  readonly subject: string | null;
}

export type ProbeFailureCode = "REFUSED" | "TIMEOUT" | "UNREACHABLE";

export class HostProbeError extends Error {
  constructor(
    message: string,
    readonly code: ProbeFailureCode,
  ) {
    super(message);
    this.name = "HostProbeError";
  }
}

/**
 * Reads the certificate a candidate host presents, and NOTHING ELSE.
 *
 * The handshake completes and the socket is destroyed before a byte of
 * application data is written, which is what makes this safe to point at an
 * address a human just typed: a wrong address learns the operator's PIN only if
 * something is sent to it, and nothing is.
 *
 * ECONNREFUSED AND A TIMEOUT ARE DIFFERENT ANSWERS and are reported as such.
 * `INSTALL.md §7A.3` names the Windows firewall as the single most likely LAN
 * failure, and the two are exactly how a client tells them apart: a refusal
 * means a machine answered and nothing is listening (Mezan is not running); a
 * timeout means nothing answered at all (a firewall dropped it, or the machine
 * is asleep or on another network).
 */
export function probeHostCertificate(hostUrl: string, timeoutMs = 5_000): Promise<ProbedCertificate> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(hostUrl);
    } catch {
      reject(new HostProbeError(`${hostUrl} is not a valid address.`, "UNREACHABLE"));
      return;
    }

    const socket = tlsConnect(
      {
        host: url.hostname,
        port: Number(url.port || 443),
        ...(isIP(url.hostname) ? {} : { servername: url.hostname }),
        // Nothing is trusted here on purpose: this call EXISTS to report what
        // the peer presented so a human can compare it. Validating a chain that
        // cannot validate would refuse every legitimate host.
        rejectUnauthorized: false,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.destroy();
        const fingerprint = cert.fingerprint256 ?? "";
        if (!fingerprint) {
          reject(new HostProbeError(`${url.origin} presented no certificate.`, "UNREACHABLE"));
          return;
        }
        resolve({
          fingerprintSha256: fingerprint.toUpperCase(),
          subject: typeof cert.subject?.CN === "string" ? cert.subject.CN : null,
        });
      },
    );

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new HostProbeError(`No answer from ${url.origin}.`, "TIMEOUT"));
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      socket.destroy();
      reject(
        new HostProbeError(
          `${url.origin}: ${err.message}`,
          err.code === "ECONNREFUSED" ? "REFUSED" : err.code === "ETIMEDOUT" ? "TIMEOUT" : "UNREACHABLE",
        ),
      );
    });
  });
}

/**
 * Every IPv4 address on this machine's own /24s, minus this machine's own.
 *
 * Capped at a /24 per interface. A shop LAN is a /24 in every install this
 * ships to, and sweeping a /16 would be 65,000 connections — a scan that reads
 * as an attack to any device on the segment and never finishes anyway.
 */
export function subnetCandidates(): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = String(entry.family);
      if (family !== "IPv4" && family !== "4") continue;
      if (entry.netmask !== "255.255.255.0") continue;
      const parts = entry.address.split(".");
      if (parts.length !== 4) continue;
      const prefix = parts.slice(0, 3).join(".");
      for (let host = 1; host <= 254; host += 1) {
        const candidate = `${prefix}.${host}`;
        if (candidate === entry.address || seen.has(candidate)) continue;
        seen.add(candidate);
        out.push(candidate);
      }
    }
  }
  return out;
}

/**
 * Finds the machine on this subnet presenting `fingerprintSha256`.
 *
 * THE PIN IS THE SEARCH KEY, which is what makes moving a paired till safe: the
 * address changes, the certificate does not, so a host that answers on a new
 * address with the SAME certificate is provably the same machine and the client
 * can re-point itself with no human comparison at all. Anything else on the
 * subnet is skipped in silence.
 *
 * Bounded concurrency and a short per-address timeout: 254 addresses at 24 in
 * flight with a 1.2s cap finishes in about thirteen seconds on a dead subnet
 * and in well under one when the host is up.
 */
export async function probeSubnetForFingerprint(
  fingerprintSha256: string,
  port: number,
  options: { readonly perHostTimeoutMs?: number; readonly concurrency?: number } = {},
): Promise<string | null> {
  const wanted = fingerprintSha256.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  if (wanted.length === 0) return null;

  const candidates = subnetCandidates();
  const perHostTimeoutMs = options.perHostTimeoutMs ?? 1_200;
  const concurrency = options.concurrency ?? 24;

  let next = 0;
  let hit: string | null = null;

  async function worker(): Promise<void> {
    while (hit === null) {
      const index = next;
      next += 1;
      const address = candidates[index];
      if (address === undefined) return;
      const hostUrl = `https://${address}:${port}`;
      const probed = await probeHostCertificate(hostUrl, perHostTimeoutMs).catch(() => null);
      if (!probed) continue;
      if (probed.fingerprintSha256.replace(/[^0-9A-F]/g, "") === wanted) {
        hit = hostUrl;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));
  return hit;
}

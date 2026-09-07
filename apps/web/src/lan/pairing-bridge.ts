/**
 * The desktop pairing bridge, as the renderer sees it.
 *
 * Declared HERE rather than imported from apps/desktop, the same way
 * `transport.ts` and `data/hooks.ts` declare theirs: the web build must compile
 * with no desktop package present, and on the browser edition every call below
 * is simply absent — which the screens branch on rather than pretending.
 */

export interface DiscoveredHostDTO {
  readonly name: string;
  readonly hostUrl: string;
  /**
   * What the mDNS ADVERTISEMENT claimed. It is not evidence: anything on the
   * wifi can answer. Shown next to what the handshake presented so a
   * disagreement is visible; only the handshake's value is ever pinned.
   */
  readonly advertisedFingerprint: string | null;
}

export type PairingResponse =
  | {
      readonly kind: "state";
      readonly role: "host" | "client";
      readonly hostUrl: string | null;
      readonly pinnedFingerprint: string | null;
      readonly deviceLabel: string;
      readonly mayPair: boolean;
    }
  | {
      readonly kind: "discover";
      readonly hosts: readonly DiscoveredHostDTO[];
      readonly discoveryAvailable: boolean;
    }
  | {
      readonly kind: "probe";
      readonly ok: true;
      readonly hostUrl: string;
      readonly presentedFingerprint: string;
      readonly subject: string | null;
    }
  | {
      readonly kind: "probe";
      readonly ok: false;
      readonly hostUrl: string;
      readonly code: "REFUSED" | "TIMEOUT" | "UNREACHABLE";
      readonly message: string;
    }
  | {
      readonly kind: "confirm";
      readonly ok: true;
      readonly hostUrl: string;
      readonly fingerprintSha256: string;
      readonly deviceLabel: string;
    }
  | { readonly kind: "confirm"; readonly ok: false; readonly message: string }
  | { readonly kind: "relocate"; readonly ok: true; readonly found: string; readonly applied: boolean }
  | { readonly kind: "relocate"; readonly ok: false; readonly message: string }
  | {
      readonly kind: "selftest";
      readonly reachable: boolean;
      readonly address: string | null;
      readonly detail: string | null;
    };

export type PairingRequestMessage =
  | { readonly kind: "state" }
  | { readonly kind: "discover" }
  | { readonly kind: "probe"; readonly hostUrl: string }
  | {
      readonly kind: "confirm";
      readonly hostUrl: string;
      readonly fingerprintSha256: string;
      readonly deviceLabel?: string;
    }
  | { readonly kind: "relocate"; readonly accept?: string | null }
  | { readonly kind: "selftest" };

type PairingCall = (message: PairingRequestMessage) => Promise<PairingResponse>;

function bridge(): PairingCall | undefined {
  return (globalThis as { mezan?: { pairing?: PairingCall } }).mezan?.pairing;
}

/** True only on a desktop build new enough to carry the pairing channel. */
export function pairingSupported(): boolean {
  return typeof bridge() === "function";
}

/**
 * Calls the bridge, or resolves to null when there is none.
 *
 * Null rather than a thrown error: on the browser edition the honest answer is
 * "this machine cannot pair", which is a state the screens render, not a
 * failure they report.
 */
export async function pairing(message: PairingRequestMessage): Promise<PairingResponse | null> {
  const call = bridge();
  if (!call) return null;
  return call(message);
}

/**
 * The catalog key for a transport failure code.
 *
 * A LOOKUP, not a template literal, and that is the point: the codes arrive
 * from the main process as plain strings, and `\`lan.error.${code}\`` would let
 * an unknown one through to `t()` as a key that does not exist — which renders
 * the raw key on screen, the exact failure docs/archive/reference-parity
 * records the reference app shipping. Anything unrecognised falls back to the
 * honest general answer.
 */
const LAN_ERROR_KEYS = {
  PIN_MISMATCH: "lan.error.PIN_MISMATCH",
  UNREACHABLE: "lan.error.UNREACHABLE",
  TIMEOUT: "lan.error.TIMEOUT",
  NO_SEAT: "lan.error.NO_SEAT",
  VERSION_MISMATCH: "lan.error.VERSION_MISMATCH",
} as const;

export type LanErrorKey = (typeof LAN_ERROR_KEYS)[keyof typeof LAN_ERROR_KEYS];

export function lanErrorKey(code: string | null | undefined): LanErrorKey {
  return LAN_ERROR_KEYS[code as keyof typeof LAN_ERROR_KEYS] ?? LAN_ERROR_KEYS.UNREACHABLE;
}

/**
 * Splits a fingerprint into readable groups.
 *
 * A human comparing two 64-hex strings by eye is the whole of the LAN's
 * defence against an impostor, and an unbroken run is exactly how that
 * comparison is done badly. Four pairs to a group, in LTR — the value is Latin
 * hex inside an RTL page, where an unmarked run reorders and the operator ends
 * up comparing two strings that differ only in how they were laid out.
 */
export function fingerprintGroups(value: string): readonly string[] {
  const pairs = value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase().match(/.{1,2}/g) ?? [];
  const groups: string[] = [];
  for (let i = 0; i < pairs.length; i += 4) groups.push(pairs.slice(i, i + 4).join(":"));
  return groups;
}

/** True when two fingerprints are the same certificate, however they are spelled. */
export function sameFingerprint(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const normalize = (v: string) => v.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return normalize(a).length > 0 && normalize(a) === normalize(b);
}

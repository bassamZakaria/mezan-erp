import { rename } from "node:fs/promises";
import { hostname as osHostname } from "node:os";
import { ipcMain } from "electron";
import {
  MEZAN_PAIRING_CHANNEL,
  type PairingConfirmResult,
  type PairingDiscoverResult,
  type PairingProbeResult,
  type PairingRelocateResult,
  type PairingRequestMessage,
  type PairingResponse,
  type PairingStateResult,
} from "../shared/ipc-contract.js";
import {
  readClientConfig,
  updateClientHostUrl,
  writeClientConfig,
  type ClientConfig,
} from "./client-config.js";
import {
  discoverLanHosts,
  HostProbeError,
  probeHostCertificate,
  probeSubnetForFingerprint,
} from "./lan-discovery.js";
import type { LanHostHandle } from "./lan-host.js";

/**
 * PAIRING A TILL FROM INSIDE THE APP.
 *
 * Everything below existed only as a command-line flag, which meant a shop
 * could never add its own fourth till and every DHCP change was another site
 * visit. Five actions, and the split between them is the safety property:
 *
 *   discover  — list the hosts answering on this subnet. mDNS is
 *               unauthenticated, so this is a way to save typing an address and
 *               nothing more.
 *   probe     — complete a TLS handshake with a candidate and report the
 *               certificate it PRESENTED. Nothing is sent to it. This is the
 *               value the operator compares against the host's own screen.
 *   confirm   — write client.json. Only reachable after a probe, and only from
 *               a machine that holds no books (see `mayPair`).
 *   state     — what this machine currently is, so the screen can render the
 *               truth rather than an assumption.
 *   relocate  — a PAIRED client looking for its OWN host at a new address, by
 *               its pinned fingerprint. Not a pairing: the pin does not change,
 *               so this cannot walk a till onto a different machine.
 *
 * NO SESSION TOKEN GATES THESE, deliberately, and the reasoning is worth
 * writing down because every other privileged channel in this process takes
 * one. The two moments these exist for are exactly the moments no session can
 * exist: a machine that has never been set up, and a paired till that cannot
 * reach the host it would sign in to. What stands in for a credential is that
 * neither destructive action can be taken blind — `confirm` refuses on any
 * machine whose tenant has been claimed, and `relocate` cannot change which
 * certificate this client accepts.
 */

export interface PairingIpcDeps {
  readonly dbPath: string;
  /**
   * True when this machine holds no books yet, so becoming a client would
   * orphan nothing. Asked of the running backend (`GET /bootstrap/status`)
   * rather than of the file system: a first launch has ALREADY created and
   * seeded an empty database by the time a window exists, so "the file is
   * absent" — which is what the CLI flag checks, before anything opens it — is
   * always false here and would refuse every in-app pairing.
   */
  readonly tenantIsClaimed: () => Promise<boolean>;
  /** `app.relaunch(); app.exit(0)` — a role change is decided at startup, so it has to restart. */
  readonly relaunch: () => void;
  /** Present only on a machine that is already a client. */
  readonly client?: ClientConfig;
  /** The port a subnet sweep dials when looking for a moved host. */
  readonly hostPort?: number;
  /**
   * The live LAN handle on a HOST, for «اختبر الوصول». Through a getter because
   * the socket binds asynchronously, and absent on a client, which listens on
   * nothing.
   */
  readonly lanHost?: () => LanHostHandle | undefined;
}

const DEFAULT_HOST_PORT = 4173;

type ProbeRefusalCode = "REFUSED" | "TIMEOUT" | "UNREACHABLE";

function probeFailureMessage(err: unknown): { code: ProbeRefusalCode; message: string } {
  if (err instanceof HostProbeError) {
    switch (err.code) {
      case "REFUSED":
        return {
          code: "REFUSED",
          message:
            "الجهاز موجود على الشبكة لكنه لا يستقبل اتصالات على هذا المنفذ. تأكد أن برنامج مزان مفتوح على الجهاز الرئيسي.",
        };
      case "TIMEOUT":
        return {
          code: "TIMEOUT",
          message:
            "لا يوجد رد من هذا العنوان. غالباً جدار الحماية على الجهاز الرئيسي يحجب الاتصال، أو الجهاز نائم أو على شبكة أخرى.",
        };
      default:
        return {
          code: "UNREACHABLE",
          message: "تعذّر الوصول إلى هذا العنوان. تأكد من كتابته بشكل صحيح ومن أن الجهازين على نفس الشبكة.",
        };
    }
  }
  return {
    code: "UNREACHABLE",
    message: "تعذّر الوصول إلى هذا العنوان. تأكد من كتابته بشكل صحيح ومن أن الجهازين على نفس الشبكة.",
  };
}

export function registerPairingOverIpc(deps: PairingIpcDeps): void {
  const hostPort = deps.hostPort ?? DEFAULT_HOST_PORT;

  async function discover(): Promise<PairingDiscoverResult> {
    const hosts = await discoverLanHosts().catch(() => []);
    return {
      kind: "discover",
      hosts: hosts.map((h) => ({
        name: h.name,
        hostUrl: h.hostUrl,
        advertisedFingerprint: h.advertisedFingerprint,
      })),
      // Told plainly rather than left to look like "no hosts exist": mDNS is
      // blocked on plenty of shop networks, and an empty list on a network
      // where discovery never ran must not read as "there is no host here".
      discoveryAvailable: hosts.length > 0,
    };
  }

  async function probe(hostUrl: string): Promise<PairingProbeResult> {
    try {
      const probed = await probeHostCertificate(hostUrl);
      return {
        kind: "probe",
        ok: true,
        hostUrl,
        presentedFingerprint: probed.fingerprintSha256,
        subject: probed.subject,
      };
    } catch (err) {
      const { code, message } = probeFailureMessage(err);
      return { kind: "probe", ok: false, hostUrl, code, message };
    }
  }

  async function confirm(input: {
    hostUrl: string;
    fingerprintSha256: string;
    deviceLabel?: string;
  }): Promise<PairingConfirmResult> {
    if (await deps.tenantIsClaimed()) {
      return {
        kind: "confirm",
        ok: false,
        message:
          "هذا الجهاز يحتفظ بدفاتر خاصة به بالفعل، ولا يمكن تحويله إلى محطة متصلة — سيصبح ما فيه غير مقروء لأحد. " +
          "احتفظ بنسخة احتياطية وابدأ من تثبيت جديد إذا كان هذا فعلاً ما تريده.",
      };
    }

    // THE PRESENTED CERTIFICATE, RE-READ, NOT THE ONE THE SCREEN PASSED BACK.
    // The renderer showed the operator a fingerprint; pinning whatever it hands
    // back would make the compare-and-confirm step decorative, because a
    // compromised or simply stale renderer state would pin a value nobody
    // looked at. Re-reading it here means what gets written to client.json is
    // what the host is presenting at the moment of the decision.
    const probed = await probeHostCertificate(input.hostUrl).catch(() => null);
    if (!probed) {
      return {
        kind: "confirm",
        ok: false,
        message: "تعذّر الوصول إلى الجهاز الرئيسي في لحظة الاقتران. حاول مرة أخرى.",
      };
    }
    if (probed.fingerprintSha256.replace(/[^0-9A-F]/g, "") !== input.fingerprintSha256.toUpperCase().replace(/[^0-9A-F]/g, "")) {
      return {
        kind: "confirm",
        ok: false,
        message:
          "تغيّرت شهادة الجهاز الرئيسي أثناء الاقتران. لم يتم حفظ أي شيء. أعد المقارنة من البداية.",
      };
    }

    let config: ClientConfig;
    try {
      config = await writeClientConfig(deps.dbPath, {
        hostUrl: input.hostUrl,
        fingerprintSha256: probed.fingerprintSha256,
        deviceLabel: input.deviceLabel?.trim() || osHostname(),
      });
    } catch (err) {
      console.error("[pair] could not write the pairing", err);
      return { kind: "confirm", ok: false, message: "تعذّر حفظ إعدادات الاقتران على هذا الجهاز." };
    }

    // The empty database this launch created is MOVED ASIDE, not deleted. It
    // holds nothing but a seed, and on the one occasion it holds more than that
    // — somebody pairing a machine they should not have — the file is still
    // there to be put back.
    await rename(deps.dbPath, `${deps.dbPath}.pre-pairing`).catch(() => undefined);

    console.log(
      `[pair] this machine is now a Mezan CLIENT of ${config.hostUrl} (device ${config.deviceLabel})`,
    );
    setTimeout(() => deps.relaunch(), 750);
    return {
      kind: "confirm",
      ok: true,
      hostUrl: config.hostUrl,
      fingerprintSha256: config.fingerprintSha256,
      deviceLabel: config.deviceLabel,
    };
  }

  async function relocate(accept: string | null): Promise<PairingRelocateResult> {
    const role = await readClientConfig(deps.dbPath);
    if (role.role !== "client") {
      return { kind: "relocate", ok: false, message: "هذا الجهاز ليس محطة متصلة." };
    }
    const pinned = role.config.fingerprintSha256;

    if (accept) {
      try {
        const updated = await updateClientHostUrl(deps.dbPath, accept);
        setTimeout(() => deps.relaunch(), 750);
        return { kind: "relocate", ok: true, found: updated.hostUrl, applied: true };
      } catch (err) {
        console.error("[pair] could not re-point this client", err);
        return { kind: "relocate", ok: false, message: "تعذّر حفظ العنوان الجديد على هذا الجهاز." };
      }
    }

    // mDNS first — it answers in milliseconds when it is allowed at all — then
    // the sweep, which is slower but works on a network that blocks multicast.
    const advertised = await discoverLanHosts(2_000).catch(() => []);
    const byFingerprint = advertised.find(
      (h) =>
        h.advertisedFingerprint?.replace(/[^0-9A-F]/g, "") === pinned.replace(/[^0-9A-F]/g, ""),
    );
    for (const candidate of byFingerprint ? [byFingerprint.hostUrl] : advertised.map((h) => h.hostUrl)) {
      const probed = await probeHostCertificate(candidate, 1_500).catch(() => null);
      if (probed?.fingerprintSha256.replace(/[^0-9A-F]/g, "") === pinned.replace(/[^0-9A-F]/g, "")) {
        return { kind: "relocate", ok: true, found: candidate, applied: false };
      }
    }

    const port = Number(new URL(role.config.hostUrl).port) || hostPort;
    const swept = await probeSubnetForFingerprint(pinned, port).catch(() => null);
    if (swept) return { kind: "relocate", ok: true, found: swept, applied: false };

    return {
      kind: "relocate",
      ok: false,
      message:
        "لم يُعثر على الجهاز الرئيسي على هذه الشبكة. تأكد أنه مشغّل وأن الجهازين على نفس الشبكة، ثم أعد المحاولة.",
    };
  }

  async function state(): Promise<PairingStateResult> {
    const claimed = await deps.tenantIsClaimed().catch(() => true);
    return {
      kind: "state",
      role: deps.client ? "client" : "host",
      hostUrl: deps.client?.hostUrl ?? null,
      pinnedFingerprint: deps.client?.fingerprintSha256 ?? null,
      deviceLabel: deps.client?.deviceLabel ?? osHostname(),
      mayPair: !deps.client && !claimed,
    };
  }

  ipcMain.handle(
    MEZAN_PAIRING_CHANNEL,
    async (_event, message: PairingRequestMessage): Promise<PairingResponse> => {
      switch (message?.kind) {
        case "discover":
          return discover();
        case "probe":
          return probe(message.hostUrl);
        case "confirm":
          return confirm(message);
        case "relocate":
          return relocate(message.accept ?? null);
        case "selftest": {
          const host = deps.lanHost?.();
          if (!host) return { kind: "selftest", reachable: false, address: null, detail: "NOT_LISTENING" };
          const result = await host.testReachability();
          return { kind: "selftest", ...result };
        }
        case "state":
          return state();
        default:
          return { kind: "state", role: "host", hostUrl: null, pinnedFingerprint: null, deviceLabel: osHostname(), mayPair: false };
      }
    },
  );
}

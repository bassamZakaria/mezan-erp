import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { createServer as createTlsServer, type Server } from "node:tls";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  advertiseLanHost,
  discoverLanHosts,
  HostProbeError,
  probeHostCertificate,
  subnetCandidates,
} from "./lan-discovery.js";
import { loadOrCreateLanTlsIdentity, type LanTlsIdentity } from "./lan-tls.js";

/**
 * guards N-1/N-4/N-6.
 *
 * The probe is the load-bearing half of in-app pairing: the whole safety of the
 * flow is that a human compares the fingerprint the HANDSHAKE presented — not
 * one an mDNS advertisement claimed, which anything on the wifi can forge —
 * and that nothing is sent to a candidate while they decide.
 */
const dirs: string[] = [];
const servers: Server[] = [];

async function identity(): Promise<LanTlsIdentity> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-discovery-"));
  dirs.push(dir);
  return loadOrCreateLanTlsIdentity(path.join(dir, "mezan.db"));
}

afterAll(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("reading what a candidate host actually presents", () => {
  it("reports the certificate a real host presents, byte-identical to what a pinning client computes", async () => {
    const tls = await identity();
    let sawBytes = 0;
    const server = createTlsServer({ key: tls.key, cert: tls.cert }, (socket) => {
      socket.on("data", (chunk: Buffer) => {
        sawBytes += chunk.length;
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;

    const probed = await probeHostCertificate(`https://127.0.0.1:${port}`, 3_000);

    expect(probed.fingerprintSha256).toBe(tls.fingerprintSha256);
    expect(probed.subject).toBe("Mezan LAN host");
    // NOTHING IS SENT while the operator decides. A probe that wrote anything
    // to a machine a human just typed the address of would hand it whatever
    // followed, which is the failure the whole compare-and-confirm step exists
    // to make impossible.
    await new Promise((r) => setTimeout(r, 50));
    expect(sawBytes).toBe(0);
  });

  /**
   * guards N-6: ECONNREFUSED AND SILENCE ARE DIFFERENT FIXES, and reporting
   * both as "unreachable" is what made a firewall undiagnosable from either
   * side. A refusal means a machine answered and Mezan is not running on it.
   */
  it("separates 'nothing is listening' from 'nothing answered at all'", async () => {
    // A port that was bound and then closed: the OS refuses immediately.
    const closed = createTcpServer(() => {});
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", () => resolve()));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    const failure = (await probeHostCertificate(`https://127.0.0.1:${port}`, 1_000).catch(
      (err: unknown) => err,
    )) as HostProbeError;

    expect(failure).toBeInstanceOf(HostProbeError);
    expect(failure.code).toBe("REFUSED");
  });

  it("refuses an address that is not one, rather than throwing something a screen cannot render", async () => {
    const failure = (await probeHostCertificate("not an address", 500).catch(
      (err: unknown) => err,
    )) as HostProbeError;

    expect(failure).toBeInstanceOf(HostProbeError);
    expect(failure.code).toBe("UNREACHABLE");
  });
});

describe("discovery is a convenience, never a dependency", () => {
  /**
   * mDNS is blocked outright on plenty of shop networks, and the package that
   * speaks it is optional. Neither may take the first-run screen down: typing
   * the address by hand is the path that must always work.
   */
  it("returns an empty list rather than throwing when nothing answers", async () => {
    const hosts = await discoverLanHosts(150);
    expect(Array.isArray(hosts)).toBe(true);
  });

  it("hands back a stop function that is safe to call whatever happened", async () => {
    const stop = advertiseLanHost({ port: 0, fingerprintSha256: "AA:BB", name: "Mezan — test" });
    await expect(stop()).resolves.toBeUndefined();
    // Twice, because `will-quit` can fire after an explicit close.
    await expect(stop()).resolves.toBeUndefined();
  });
});

describe("subnetCandidates", () => {
  /**
   * A shop LAN is a /24 in every install this ships to. Sweeping anything
   * wider would be tens of thousands of connections — a scan that reads as an
   * attack to every device on the segment and never finishes.
   */
  it("stays inside a /24 and never includes this machine's own address", () => {
    const candidates = subnetCandidates();
    expect(new Set(candidates).size).toBe(candidates.length);
    for (const address of candidates) {
      expect(address).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
      // .0 is the network and .255 the broadcast; neither is a host.
      const last = Number(address.split(".")[3]);
      expect(last).toBeGreaterThanOrEqual(1);
      expect(last).toBeLessThanOrEqual(254);
    }
    // One /24 per interface, and a machine has few interfaces.
    expect(candidates.length).toBeLessThanOrEqual(254 * 8);
  });
});

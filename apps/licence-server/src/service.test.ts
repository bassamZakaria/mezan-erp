import { describe, expect, it } from "vitest";
import { bytesToHex, licensePublicKeyHex, verifyCheckinResponse } from "@mezan/domain";
import { handleCheckin, handleHealth, type RevocationFile } from "./service.js";

/**
 * guards L-2, L-4: nothing in the repository answered a check-in, so the whole
 * anti-piracy path terminated in a request nobody received, and a `revoked`
 * answer — had one ever arrived — was unsigned JSON any middlebox could mint.
 */
const SECRET = new Uint8Array(32).fill(11);
const PRIVATE_HEX = bytesToHex(SECRET);
const NOW = new Date("2026-09-10T00:00:00.000Z");

async function publicHex(): Promise<string> {
  return licensePublicKeyHex(SECRET);
}

function deps(revoked: readonly string[] = []) {
  const file: RevocationFile = { revoked, seen: {} };
  const recorded: Array<{ licenseId: string; fingerprint: string }> = [];
  return {
    recorded,
    options: {
      revocationsPath: "unused.json",
      privateKey: PRIVATE_HEX,
      now: () => NOW,
      read: () => file,
      record: (_p: string, _c: RevocationFile, claim: { licenseId: string; fingerprint: string }) => {
        recorded.push({ licenseId: claim.licenseId, fingerprint: claim.fingerprint });
      },
    },
  };
}

describe("POST /checkin", () => {
  it("answers a live licence with a signature the install can verify", async () => {
    const { options } = deps();
    const answer = await handleCheckin({ licenseId: "lic-1", fingerprint: "fp-1" }, options);
    expect(answer.status).toBe(200);

    const body = answer.body as { revoked: boolean; serverTime: string; signature: string };
    expect(body.revoked).toBe(false);
    expect(body.serverTime).toBe(NOW.toISOString());
    expect(
      await verifyCheckinResponse(
        { licenseId: "lic-1", fingerprint: "fp-1", revoked: false, serverTime: body.serverTime },
        body.signature,
        await publicHex(),
      ),
    ).toBe(true);
  });

  it("signs a revocation for a licence on the list", async () => {
    const { options } = deps(["lic-bad"]);
    const answer = await handleCheckin({ licenseId: "lic-bad", fingerprint: "fp-1" }, options);
    const body = answer.body as { revoked: boolean; serverTime: string; signature: string };
    expect(body.revoked).toBe(true);
    expect(
      await verifyCheckinResponse(
        { licenseId: "lic-bad", fingerprint: "fp-1", revoked: true, serverTime: body.serverTime },
        body.signature,
        await publicHex(),
      ),
    ).toBe(true);
  });

  /**
   * The signature must bind the MACHINE too, or one shop's "not revoked" answer
   * is every shop's — which is the copied-file case the check-in exists for.
   */
  it("signs an answer that does not verify for a different machine", async () => {
    const { options } = deps();
    const answer = await handleCheckin({ licenseId: "lic-1", fingerprint: "fp-1" }, options);
    const body = answer.body as { serverTime: string; signature: string };
    expect(
      await verifyCheckinResponse(
        { licenseId: "lic-1", fingerprint: "fp-OTHER", revoked: false, serverTime: body.serverTime },
        body.signature,
        await publicHex(),
      ),
    ).toBe(false);
  });

  it("records the (licence, machine) pair as the evidence a revocation is decided on", async () => {
    const { options, recorded } = deps();
    await handleCheckin({ licenseId: "lic-1", fingerprint: "fp-1" }, options);
    expect(recorded).toEqual([{ licenseId: "lic-1", fingerprint: "fp-1" }]);
  });

  it("refuses a malformed request with 400, never with a revocation", async () => {
    const { options } = deps();
    for (const body of [{}, { licenseId: "", fingerprint: "fp" }, { licenseId: "a|b", fingerprint: "fp" }]) {
      const answer = await handleCheckin(body as never, options);
      expect(answer.status).toBe(400);
    }
  });

  /** A mistyped path must not switch every customer off at once. */
  it("revokes nothing when the revocation list cannot be read", async () => {
    const answer = await handleCheckin(
      { licenseId: "lic-1", fingerprint: "fp-1" },
      {
        revocationsPath: "/definitely/not/here.json",
        privateKey: PRIVATE_HEX,
        now: () => NOW,
        record: () => {},
      },
    );
    expect((answer.body as { revoked: boolean }).revoked).toBe(false);
  });
});

describe("GET /health", () => {
  it("is unhealthy without a usable signing key", () => {
    expect(handleHealth({ privateKey: PRIVATE_HEX }).status).toBe(200);
    expect(handleHealth({ privateKey: "" }).status).toBe(503);
  });
});

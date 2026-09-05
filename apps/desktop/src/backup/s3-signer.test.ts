import { describe, expect, it } from "vitest";
import { EMPTY_PAYLOAD_SHA256, sha256Hex, signS3Request } from "./s3-signer.js";

/**
 * AWS's own published SigV4 example for S3 (the "GET Object" vector from the
 * Signature Version 4 test suite documentation), reproduced exactly.
 *
 * This is the only assertion that proves the signer is CORRECT rather than
 * merely self-consistent: every part of SigV4 is a hash of a hash, so an
 * implementation with the canonical request subtly wrong still produces a
 * stable, plausible-looking signature — and fails against a real bucket with a
 * 403 that says nothing about which of the eight inputs was wrong. Pinning a
 * vector whose expected output was computed by AWS, not by this file, is what
 * makes that impossible.
 */
describe("signS3Request — AWS published vector", () => {
  const EXAMPLE = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    // 2013-05-24T00:00:00Z
    now: new Date(Date.UTC(2013, 4, 24, 0, 0, 0)),
  };

  it("reproduces the documented signature for GET /test.txt", () => {
    const signed = signS3Request({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      region: EXAMPLE.region,
      accessKeyId: EXAMPLE.accessKeyId,
      secretAccessKey: EXAMPLE.secretAccessKey,
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      now: EXAMPLE.now,
      extraHeaders: { range: "bytes=0-9" },
    });

    expect(signed.headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });

  it("reproduces the documented signature for PUT /test%24file.text", () => {
    const body = "Welcome to Amazon S3.";
    const signed = signS3Request({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      region: EXAMPLE.region,
      accessKeyId: EXAMPLE.accessKeyId,
      secretAccessKey: EXAMPLE.secretAccessKey,
      payloadSha256: sha256Hex(body),
      now: EXAMPLE.now,
      extraHeaders: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
    });

    expect(signed.headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("signs the ENCODED path — a key with a space is not the key without one", () => {
    const spaced = signS3Request({
      method: "PUT",
      url: new URL("https://b.example.com/mezan backups/a.mezanbak"),
      region: "eu-central-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      now: EXAMPLE.now,
    });
    const unspaced = signS3Request({
      method: "PUT",
      url: new URL("https://b.example.com/mezanbackups/a.mezanbak"),
      region: "eu-central-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      now: EXAMPLE.now,
    });
    expect(spaced.headers["authorization"]).not.toBe(unspaced.headers["authorization"]);
  });

  it("always signs the payload hash, so a tampered body cannot reuse the signature", () => {
    const base = {
      method: "PUT" as const,
      url: new URL("https://b.example.com/x"),
      region: "eu-central-1",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      now: EXAMPLE.now,
    };
    const a = signS3Request({ ...base, payloadSha256: sha256Hex("books") });
    const b = signS3Request({ ...base, payloadSha256: sha256Hex("b00ks") });
    expect(a.headers["authorization"]).not.toBe(b.headers["authorization"]);
    expect(a.headers["x-amz-content-sha256"]).toBe(sha256Hex("books"));
  });
});

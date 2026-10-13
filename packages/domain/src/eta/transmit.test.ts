import { ConnectionTurnLostError } from "../audit/index.js";
import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_CONFIG, resolveEtaEndpoints, type EtaConfig } from "./config.js";
import { EtaOfflineError } from "./errors.js";
import { createEtaHttpTransmitPort, type EtaHttpClient, type EtaHttpRequest, type EtaHttpResponse } from "./transmit.js";
import type { EtaSubmission } from "./submission.js";

/**
 * guards P-1 — the ETA network leg. Every case runs against a fake in-process
 * server; nothing here opens a socket.
 */

const CONFIG: EtaConfig = { ...DEFAULT_ETA_CONFIG, environment: "preproduction", clientId: "cid", hasClientSecret: true };

const SUBMISSION: EtaSubmission = {
  id: "s1",
  internalId: "INV-000014",
  documentType: "invoice",
  status: "ready",
  etaUuid: null,
  payload: { internalID: "INV-000014", totalAmount: "114" },
  errors: [],
  exclusionReason: null,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
  submittedAt: null,
  gatewaySubmissionId: null,
  signature: null,
  transmitLog: [],
};

function fakeServer(handler: (req: EtaHttpRequest) => { status: number; body: string }) {
  const seen: EtaHttpRequest[] = [];
  const http: EtaHttpClient = async (req) => {
    seen.push(req);
    return handler(req);
  };
  return { http, seen };
}

const credentials = { read: async () => ({ clientId: "cid", clientSecret: "shh" }) };
const noCredentials = { read: async () => null };
const nowStamp = () => "2026-09-01T08:00:00.000Z";
const noSleep = async () => {};

function tokenResponse() {
  return { status: 200, body: JSON.stringify({ access_token: "tok", expires_in: 3600 }) };
}

describe("createEtaHttpTransmitPort", () => {
  it("takes an OAuth2 client-credentials token, then posts the document to /documentsubmissions", async () => {
    const { http, seen } = fakeServer((req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse();
      return {
        status: 200,
        body: JSON.stringify({
          submissionId: "SUB-1",
          acceptedDocuments: [{ uuid: "UUID-1", internalId: "INV-000014" }],
          rejectedDocuments: [],
        }),
      };
    });
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    const result = await port.transmit(SUBMISSION, CONFIG);

    expect(result.ok).toBe(true);
    expect(result.etaUuid).toBe("UUID-1");
    expect(result.submissionId).toBe("SUB-1");
    const { identityUrl, apiBaseUrl } = resolveEtaEndpoints(CONFIG);
    expect(seen[0]!.url).toBe(`${identityUrl}/connect/token`);
    expect(seen[0]!.body).toContain("grant_type=client_credentials");
    expect(seen[0]!.body).toContain("scope=InvoicingAPI");
    expect(seen[1]!.url).toBe(`${apiBaseUrl}/documentsubmissions`);
    expect(seen[1]!.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(seen[1]!.body!)).toEqual({ documents: [SUBMISSION.payload] });
  });

  it("uses the production addresses when the config selects production", async () => {
    const { http, seen } = fakeServer((req) =>
      req.url.endsWith("/connect/token")
        ? tokenResponse()
        : { status: 200, body: JSON.stringify({ acceptedDocuments: [{ uuid: "U" }] }) },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    await port.transmit(SUBMISSION, { ...CONFIG, environment: "production" });

    expect(seen[0]!.url).toBe("https://id.eta.gov.eg/connect/token");
    expect(seen[1]!.url).toBe("https://api.invoicing.eta.gov.eg/api/v1/documentsubmissions");
  });

  it("honours a per-install base URL override", async () => {
    const { http, seen } = fakeServer(() => tokenResponse());
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    await port.checkCredentials!({ ...CONFIG, preproductionIdentityUrl: "https://id.test.local/" });

    expect(seen[0]!.url).toBe("https://id.test.local/connect/token");
  });

  it("logs every request and response onto the result, with the client secret redacted", async () => {
    const { http } = fakeServer((req) =>
      req.url.endsWith("/connect/token")
        ? tokenResponse()
        : { status: 200, body: JSON.stringify({ submissionId: "S", acceptedDocuments: [{ uuid: "U" }] }) },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    const result = await port.transmit(SUBMISSION, CONFIG);

    expect(result.log).toHaveLength(2);
    expect(result.log![0]!.requestBody).not.toContain("shh");
    expect(result.log![0]!.requestBody).toContain("client_id=cid");
    expect(result.log![1]!.status).toBe(200);
    expect(result.log![1]!.responseBody).toContain("submissionId");
  });

  it("reports the authority's rejection reasons rather than a generic failure", async () => {
    const { http } = fakeServer((req) =>
      req.url.endsWith("/connect/token")
        ? tokenResponse()
        : {
            status: 200,
            body: JSON.stringify({
              acceptedDocuments: [],
              rejectedDocuments: [
                {
                  internalId: "INV-000014",
                  error: {
                    code: "1002",
                    message: "Invalid item code",
                    details: [{ propertyPath: "invoiceLines[0].itemCode", message: "EGS code not registered" }],
                  },
                },
              ],
            }),
          },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    const result = await port.transmit(SUBMISSION, CONFIG);

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "Invalid item code",
      "invoiceLines[0].itemCode: EGS code not registered",
    ]);
  });

  it("retries a 500 with backoff and succeeds on a later attempt", async () => {
    let submissions = 0;
    const delays: number[] = [];
    const { http } = fakeServer((req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse();
      submissions += 1;
      if (submissions < 3) return { status: 503, body: "" };
      return { status: 200, body: JSON.stringify({ acceptedDocuments: [{ uuid: "U" }] }) };
    });
    const port = createEtaHttpTransmitPort({
      http,
      credentials,
      now: nowStamp,
      sleep: async (ms) => {
        delays.push(ms);
      },
      retry: { attempts: 3, baseDelayMs: 10 },
    });

    const result = await port.transmit(SUBMISSION, CONFIG);

    expect(result.ok).toBe(true);
    expect(submissions).toBe(3);
    expect(delays).toEqual([10, 20]);
  });

  it("does not retry a 400 — a malformed document is not a transient fault", async () => {
    let submissions = 0;
    const { http } = fakeServer((req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse();
      submissions += 1;
      return { status: 400, body: JSON.stringify({ error: { message: "Bad document" } }) };
    });
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep, retry: { attempts: 3, baseDelayMs: 1 } });

    const result = await port.transmit(SUBMISSION, CONFIG);

    expect(submissions).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Bad document"]);
  });

  it("refuses OFFLINE and opens no socket when no credentials are stored", async () => {
    const { http, seen } = fakeServer(() => tokenResponse());
    const port = createEtaHttpTransmitPort({ http, credentials: noCredentials, now: nowStamp, sleep: noSleep });

    await expect(port.transmit(SUBMISSION, CONFIG)).rejects.toBeInstanceOf(EtaOfflineError);
    expect(seen).toHaveLength(0);
  });

  it("reads clearance from GET /documents/{uuid}/raw", async () => {
    const { http, seen } = fakeServer((req) =>
      req.url.endsWith("/connect/token") ? tokenResponse() : { status: 200, body: JSON.stringify({ status: "Valid" }) },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    const result = await port.fetchStatus!({ ...SUBMISSION, etaUuid: "UUID-1", status: "submitted" }, CONFIG);

    expect(result.state).toBe("accepted");
    expect(seen[1]!.url).toBe(`${resolveEtaEndpoints(CONFIG).apiBaseUrl}/documents/UUID-1/raw`);
    expect(seen[1]!.method).toBe("GET");
  });

  it("reads a rejection, with the failing validation steps, from the same endpoint", async () => {
    const { http } = fakeServer((req) =>
      req.url.endsWith("/connect/token")
        ? tokenResponse()
        : {
            status: 200,
            body: JSON.stringify({
              status: "Invalid",
              validationResults: {
                status: "Invalid",
                validationSteps: [
                  { status: "Valid" },
                  { status: "Invalid", error: { message: "Signature could not be verified" } },
                ],
              },
            }),
          },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    const result = await port.fetchStatus!({ ...SUBMISSION, etaUuid: "UUID-1", status: "submitted" }, CONFIG);

    expect(result.state).toBe("rejected");
    expect(result.errors).toEqual(["Signature could not be verified"]);
  });

  it("checkCredentials makes a REAL token request and says what came back", async () => {
    const ok = createEtaHttpTransmitPort({
      http: fakeServer(() => tokenResponse()).http,
      credentials,
      now: nowStamp,
      sleep: noSleep,
    });
    await expect(ok.checkCredentials!(CONFIG)).resolves.toMatchObject({ ok: true, reason: "connected" });

    const refused = createEtaHttpTransmitPort({
      http: fakeServer(() => ({ status: 401, body: JSON.stringify({ error: "invalid_client" }) })).http,
      credentials,
      now: nowStamp,
      sleep: noSleep,
    });
    await expect(refused.checkCredentials!(CONFIG)).resolves.toMatchObject({ ok: false, reason: "rejected" });

    const unset = createEtaHttpTransmitPort({
      http: fakeServer(() => tokenResponse()).http,
      credentials: noCredentials,
      now: nowStamp,
      sleep: noSleep,
    });
    await expect(unset.checkCredentials!(CONFIG)).resolves.toMatchObject({ ok: false, reason: "missing_credentials" });
  });
});

/**
 * guards D284 — an e-receipt goes down the RECEIPT leg: the device's own POS
 * credentials and headers at the identity server, then /receiptsubmissions.
 */
describe("createEtaHttpTransmitPort — the e-receipt leg", () => {
  const RECEIPT_UUID = "e".repeat(64);
  const RECEIPT: EtaSubmission = {
    ...SUBMISSION,
    id: "r1",
    internalId: "INV-000099",
    documentType: "receipt",
    etaUuid: RECEIPT_UUID,
    receiptSerial: "POS-0001",
    receiptSeq: 1,
    payload: {
      header: { dateTimeIssued: "2026-09-01T08:00:00Z", receiptNumber: "INV-000099", uuid: RECEIPT_UUID, previousUUID: "" },
      seller: { deviceSerialNumber: "POS-0001" },
      totalAmount: "114.00000",
    },
  };
  const device = {
    serial: "POS-0001",
    clientId: "pos-cid",
    clientSecret: "pos-shh",
    osVersion: "windows",
    modelFramework: "1",
    presharedKey: "psk-secret",
  };
  const posCredentials = { forSerial: async (serial: string) => (serial === "POS-0001" ? device : null) };
  const accepted = () => ({
    status: 202,
    body: JSON.stringify({
      submissionUUID: "SUBR-1",
      acceptedDocuments: [{ uuid: RECEIPT_UUID, longId: "LONG", receiptNumber: "INV-000099" }],
      rejectedDocuments: [],
    }),
  });

  it("authenticates AS THE DEVICE — POS client id/secret in the body, posserial/pososversion/posmodelframework/presharedkey headers", async () => {
    const { http, seen } = fakeServer((req) => (req.url.endsWith("/connect/token") ? tokenResponse() : accepted()));
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });

    const result = await port.transmit(RECEIPT, CONFIG);

    expect(result).toMatchObject({ ok: true, etaUuid: RECEIPT_UUID, submissionId: "SUBR-1" });
    const { identityUrl, apiBaseUrl } = resolveEtaEndpoints(CONFIG);
    const token = seen[0]!;
    expect(token.url).toBe(`${identityUrl}/connect/token`);
    expect(token.headers).toMatchObject({
      posserial: "POS-0001",
      pososversion: "windows",
      posmodelframework: "1",
      presharedkey: "psk-secret",
    });
    const form = new URLSearchParams(token.body);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("pos-cid");
    expect(form.get("client_secret")).toBe("pos-shh");
    // Not the company's InvoicingAPI credentials.
    expect(token.body).not.toContain("cid=cid");
    expect(token.body).not.toContain("shh&");

    const submit = seen[1]!;
    expect(submit.url).toBe(`${apiBaseUrl}/receiptsubmissions`);
    expect(submit.url).not.toContain("documentsubmissions");
    expect(submit.headers.authorization).toBe("Bearer tok");
    expect(submit.body!.startsWith('{"receipts":[{"header":')).toBe(true);
    expect(submit.body).toContain('"totalAmount":114.00000');
    expect(JSON.parse(submit.body!).signatures).toEqual([]);
  });

  it("never logs the device secret or the pre-shared key", async () => {
    const { http } = fakeServer((req) => (req.url.endsWith("/connect/token") ? tokenResponse() : accepted()));
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
    const result = await port.transmit(RECEIPT, CONFIG);
    const logged = JSON.stringify(result.log);
    expect(logged).not.toContain("pos-shh");
    expect(logged).not.toContain("psk-secret");
  });

  it("reuses the device's token until it expires rather than logging in per receipt", async () => {
    const { http, seen } = fakeServer((req) => (req.url.endsWith("/connect/token") ? tokenResponse() : accepted()));
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
    await port.transmit(RECEIPT, CONFIG);
    await port.transmit({ ...RECEIPT, id: "r2" }, CONFIG);
    expect(seen.filter((r) => r.url.endsWith("/connect/token"))).toHaveLength(1);
  });

  it("logs in again once when the authority answers 401 on a cached token", async () => {
    let submits = 0;
    const { http, seen } = fakeServer((req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse();
      submits += 1;
      return submits === 2 ? { status: 401, body: "" } : accepted();
    });
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
    await port.transmit(RECEIPT, CONFIG);
    const second = await port.transmit({ ...RECEIPT, id: "r2" }, CONFIG);
    expect(second.ok).toBe(true);
    expect(seen.filter((r) => r.url.endsWith("/connect/token"))).toHaveLength(2);
  });

  it("stays OFFLINE, opening no socket, when the device has no credentials on file", async () => {
    const { http, seen } = fakeServer(() => tokenResponse());
    const port = createEtaHttpTransmitPort({
      http,
      credentials,
      posCredentials: { forSerial: async () => null },
      now: nowStamp,
      sleep: noSleep,
    });
    await expect(port.transmit(RECEIPT, CONFIG)).rejects.toBeInstanceOf(EtaOfflineError);
    expect(seen).toHaveLength(0);
  });

  it("never sends a receipt down the invoice leg, even with company credentials on file", async () => {
    const { http, seen } = fakeServer(() => tokenResponse());
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });
    await expect(port.transmit(RECEIPT, CONFIG)).rejects.toBeInstanceOf(EtaOfflineError);
    expect(seen).toHaveLength(0);
  });

  it("reports the authority's rejection of the receipt with its details", async () => {
    const { http } = fakeServer((req) =>
      req.url.endsWith("/connect/token")
        ? tokenResponse()
        : {
            status: 202,
            body: JSON.stringify({
              submissionUUID: "SUBR-2",
              acceptedDocuments: [],
              rejectedDocuments: [
                {
                  receiptNumber: "INV-000099",
                  uuid: RECEIPT_UUID,
                  error: { message: "Invalid receipt", details: [{ propertyPath: "header.previousUUID", message: "chain broken" }] },
                },
              ],
            }),
          },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
    const result = await port.transmit(RECEIPT, CONFIG);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(["Invalid receipt", "header.previousUUID: chain broken"]);
  });

  it("keeps the receipt queued on 422 DuplicateSubmission — the SDK says retry after Retry-After, not that it was filed", async () => {
    const { http } = fakeServer((req) =>
      req.url.endsWith("/connect/token") ? tokenResponse() : { status: 422, body: JSON.stringify({ error: { code: "DuplicateSubmission" } }) },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
    await expect(port.transmit(RECEIPT, CONFIG)).rejects.toBeInstanceOf(EtaOfflineError);
  });

  it("reads a receipt's status from GET /receipts/{uuid}/details", async () => {
    const { http, seen } = fakeServer((req) =>
      req.url.endsWith("/connect/token")
        ? tokenResponse()
        : { status: 200, body: JSON.stringify({ receipt: { status: "Invalid", statusReason: "previousUUID mismatch" } }) },
    );
    const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
    const status = await port.fetchStatus!(RECEIPT, CONFIG);
    expect(status).toMatchObject({ state: "rejected", errors: ["previousUUID mismatch"] });
    const { apiBaseUrl } = resolveEtaEndpoints(CONFIG);
    expect(seen[1]!.url.startsWith(`${apiBaseUrl}/receipts/${RECEIPT_UUID}/details`)).toBe(true);
    expect(seen[1]!.headers.authorization).toBe("Bearer tok");
  });

  describe("transmitReceiptBatch — up to 500 receipts of ONE device in one call (D-B4)", () => {
    const RECEIPT_UUID_2 = "b".repeat(64);
    const RECEIPT_UUID_3 = "c".repeat(64);
    const receiptN = (n: number, uuid: string): EtaSubmission => ({
      ...RECEIPT,
      id: `r${n}`,
      internalId: `INV-0000${n}`,
      etaUuid: uuid,
      receiptSeq: n,
      payload: {
        ...(RECEIPT.payload as Record<string, unknown>),
        header: { dateTimeIssued: "2026-09-01T08:00:00Z", receiptNumber: `INV-0000${n}`, uuid, previousUUID: "" },
      },
    });
    const batch = [RECEIPT, receiptN(2, RECEIPT_UUID_2), receiptN(3, RECEIPT_UUID_3)];

    it("sends every receipt of the batch in ONE POST body and maps each outcome by uuid/receiptNumber, keeping the accepted half of a partial rejection", async () => {
      const { http, seen } = fakeServer((req) =>
        req.url.endsWith("/connect/token")
          ? tokenResponse()
          : {
              status: 202,
              body: JSON.stringify({
                submissionUUID: "SUBR-BATCH",
                acceptedDocuments: [
                  { uuid: RECEIPT_UUID, receiptNumber: "INV-000099" },
                  { uuid: RECEIPT_UUID_3, receiptNumber: "INV-00003" },
                ],
                rejectedDocuments: [{ uuid: RECEIPT_UUID_2, receiptNumber: "INV-00002", error: { message: "chain broken" } }],
              }),
            },
      );
      const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
      const result = await port.transmitReceiptBatch!(batch, CONFIG);

      const submit = seen[1]!;
      const sentBody = JSON.parse(submit.body!) as { receipts: unknown[] };
      expect(sentBody.receipts).toHaveLength(3);

      expect(result.submissionUUID).toBe("SUBR-BATCH");
      expect(result.outcomes).toEqual([
        { submissionId: "r1", ok: true, etaUuid: RECEIPT_UUID },
        { submissionId: "r2", ok: false, errors: ["chain broken"], errorCodes: [null] },
        { submissionId: "r3", ok: true, etaUuid: RECEIPT_UUID_3 },
      ]);
    });

    it("refuses a batch over the 500-receipt cap rather than sending it", async () => {
      const { http } = fakeServer(() => tokenResponse());
      const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
      const oversized = Array.from({ length: 501 }, (_, i) => receiptN(i, "d".repeat(64)));
      await expect(port.transmitReceiptBatch!(oversized, CONFIG)).rejects.toBeInstanceOf(RangeError);
    });

    it("a call-level rejection (not per-document) refuses every receipt of the batch with the same reason", async () => {
      const { http } = fakeServer((req) =>
        req.url.endsWith("/connect/token") ? tokenResponse() : { status: 400, body: JSON.stringify({ error: { message: "طلب غير صالح" } }) },
      );
      const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
      const result = await port.transmitReceiptBatch!(batch, CONFIG);
      expect(result.outcomes).toHaveLength(3);
      expect(result.outcomes.every((o) => o.ok === false && o.errors?.[0] === "طلب غير صالح")).toBe(true);
    });

    it("queues the whole batch on 422 DuplicateSubmission rather than resolving any one receipt", async () => {
      const { http } = fakeServer((req) =>
        req.url.endsWith("/connect/token") ? tokenResponse() : { status: 422, body: JSON.stringify({ error: { code: "DuplicateSubmission" } }) },
      );
      const port = createEtaHttpTransmitPort({ http, credentials, posCredentials, now: nowStamp, sleep: noSleep });
      await expect(port.transmitReceiptBatch!(batch, CONFIG)).rejects.toBeInstanceOf(EtaOfflineError);
    });
  });
});

describe("createEtaHttpTransmitPort — an unreachable authority keeps a receipt queued", () => {
  it("refuses OFFLINE rather than reporting an error when the network is down", async () => {
    const http: EtaHttpClient = async () => {
      throw new Error("ENOTFOUND id.preprod.eta.gov.eg");
    };
    const port = createEtaHttpTransmitPort({
      http,
      credentials,
      posCredentials: { forSerial: async () => ({ serial: "POS-0001", clientId: "c", clientSecret: "s", osVersion: null, modelFramework: null, presharedKey: null }) },
      now: nowStamp,
      sleep: noSleep,
    });
    const receipt: EtaSubmission = { ...SUBMISSION, documentType: "receipt", receiptSerial: "POS-0001", etaUuid: "f".repeat(64) };
    await expect(port.transmit(receipt, CONFIG)).rejects.toBeInstanceOf(EtaOfflineError);
  });
});

describe("a transmit port whose caller lost the connection's turn", () => {
  const lost = () => new ConnectionTurnLostError(10_000, { completed: { value: { status: 200, body: "{}" } } });

  it("stops at once and says so, rather than reporting a transport failure or sending the document again", async () => {
    let submissions = 0;
    const http = async (req: EtaHttpRequest): Promise<EtaHttpResponse> => {
      if (req.url.endsWith("/connect/token")) return tokenResponse();
      submissions += 1;
      throw lost();
    };
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    await expect(port.transmit(SUBMISSION, CONFIG)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    expect(submissions).toBe(1);
  });

  it("stops on a lost turn while asking for the token, the status, or the credentials check", async () => {
    const http = async (): Promise<EtaHttpResponse> => {
      throw lost();
    };
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep: noSleep });

    await expect(port.transmit(SUBMISSION, CONFIG)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    await expect(port.fetchStatus!({ ...SUBMISSION, etaUuid: "U-1" }, CONFIG)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    await expect(port.checkCredentials!(CONFIG)).rejects.toBeInstanceOf(ConnectionTurnLostError);
  });

  it("stops on a lost turn while waiting between two attempts", async () => {
    let calls = 0;
    const http = async (req: EtaHttpRequest): Promise<EtaHttpResponse> => {
      if (req.url.endsWith("/connect/token")) return tokenResponse();
      calls += 1;
      return { status: 503, body: "" };
    };
    const sleep = async (): Promise<void> => {
      throw lost();
    };
    const port = createEtaHttpTransmitPort({ http, credentials, now: nowStamp, sleep });

    await expect(port.transmit(SUBMISSION, CONFIG)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    expect(calls).toBe(1);
  });
});

describe("the transmit port's own source", () => {
  it("starts every catch around outside work by stopping on a lost turn", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./transmit.ts", import.meta.url), "utf8");
    const lines = source.split("\n");
    const unguarded = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /\}\s*catch\b/.test(line))
      .filter(({ index }) => !/JSON\.parse/.test(lines[index - 1] ?? ""))
      .filter(({ index }) => !/stopOnLostTurn\(/.test(lines[index + 1] ?? ""))
      .map(({ index }) => index + 1);
    expect(unguarded).toEqual([]);
  });
});

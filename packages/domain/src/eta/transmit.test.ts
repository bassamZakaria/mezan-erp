import { describe, expect, it } from "vitest";
import { DEFAULT_ETA_CONFIG, resolveEtaEndpoints, type EtaConfig } from "./config.js";
import { EtaOfflineError } from "./errors.js";
import { createEtaHttpTransmitPort, type EtaHttpClient, type EtaHttpRequest } from "./transmit.js";
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

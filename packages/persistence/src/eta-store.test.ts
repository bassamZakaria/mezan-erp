import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DEFAULT_ETA_CONFIG, type EtaSubmission } from "@mezan/domain";
import { createSqliteEtaStore, type SqliteEtaStoreHandle } from "./eta-store.js";
import { createAesGcmSecretBox } from "./secret-box.js";

let store: SqliteEtaStoreHandle;
afterEach(() => store?.close());

describe("SqliteEtaConfigRepository", () => {
  it("returns the default config before anything is saved", async () => {
    store = createSqliteEtaStore();
    const cfg = await store.config.get();
    expect(cfg.environment).toBe("preproduction");
    expect(cfg.hasClientSecret).toBe(false);
  });

  it("persists config and surfaces only hasClientSecret for the secret (never the secret)", async () => {
    store = createSqliteEtaStore();
    await store.config.save({ ...DEFAULT_ETA_CONFIG, activityCode: "4610", clientId: "cid" });
    await store.config.setClientSecret("super-secret");
    const cfg = await store.config.get();
    expect(cfg.activityCode).toBe("4610");
    expect(cfg.clientId).toBe("cid");
    expect(cfg.hasClientSecret).toBe(true);
    expect(JSON.stringify(cfg)).not.toContain("super-secret");
  });

  it("preserves the stored secret across a later config save", async () => {
    store = createSqliteEtaStore();
    await store.config.setClientSecret("s1");
    await store.config.save({ ...DEFAULT_ETA_CONFIG, activityCode: "999" });
    expect((await store.config.get()).hasClientSecret).toBe(true);
  });
});

describe("SqliteEtaSubmissionRepository", () => {
  const sub: EtaSubmission = {
    id: "s1", internalId: "INV-000014", documentType: "invoice", status: "ready", etaUuid: null,
    payload: { totalAmount: "114" }, errors: [], exclusionReason: null,
    createdAt: "2026-08-22T10:00:00.000Z", updatedAt: "2026-08-22T10:00:00.000Z", submittedAt: null,
    gatewaySubmissionId: null, signature: null, transmitLog: [],
  };

  it("round-trips a submission with JSON payload and lists by status", async () => {
    store = createSqliteEtaStore();
    await store.submissions.create(sub);
    const found = await store.submissions.findByInternalId("INV-000014");
    expect((found!.payload as { totalAmount: string }).totalAmount).toBe("114");
    await store.submissions.update({ ...sub, status: "submitted", submittedAt: "2026-08-22T11:00:00.000Z" });
    expect(await store.submissions.list("ready")).toHaveLength(0);
    expect(await store.submissions.list("submitted")).toHaveLength(1);
  });

  it("answers a receipt's status by its authority UUID through an index, and does not mistake an invoice for one", async () => {
    const raw = new Database(":memory:");
    store = createSqliteEtaStore(raw);
    await store.submissions.create({ ...sub, id: "r1", internalId: "RCP-1", documentType: "receipt", status: "submitted", etaUuid: "UUID-RECEIPT" });
    await store.submissions.create({ ...sub, id: "i1", internalId: "INV-1", status: "accepted", etaUuid: "UUID-INVOICE" });

    expect(await store.submissions.statusByEtaUuid("UUID-RECEIPT")).toBe("submitted");
    expect(await store.submissions.statusByEtaUuid("UUID-INVOICE")).toBeNull();
    expect(await store.submissions.statusByEtaUuid("UUID-NOBODY")).toBeNull();
    const plan = raw.prepare(`EXPLAIN QUERY PLAN SELECT status FROM eta_submission WHERE eta_uuid = ? AND document_type = 'receipt'`).all("x") as { detail: string }[];
    expect(plan.map((step) => step.detail).join(" ")).toContain("USING INDEX idx_eta_submission_uuid");
    raw.close();
  });

  // guards P-1 — the transmit evidence has to survive the round trip, or the
  // only record of what was filed with the authority is a console line.
  it("round-trips the transmit log, the gateway submission id and the signature", async () => {
    store = createSqliteEtaStore();
    await store.submissions.create(sub);
    await store.submissions.update({
      ...sub,
      status: "submitted",
      etaUuid: "uuid-1",
      gatewaySubmissionId: "sub-9",
      signature: "SIG",
      transmitLog: [
        {
          at: "2026-08-22T11:00:00.000Z",
          attempt: 1,
          method: "POST",
          url: "https://api.preprod.invoicing.eta.gov.eg/api/v1/documentsubmissions",
          requestBody: "{}",
          status: 200,
          responseBody: "{\"submissionId\":\"sub-9\"}",
          error: null,
        },
      ],
    });
    const found = await store.submissions.findById("s1");
    expect(found!.gatewaySubmissionId).toBe("sub-9");
    expect(found!.signature).toBe("SIG");
    expect(found!.transmitLog).toHaveLength(1);
    expect(found!.transmitLog[0]!.status).toBe(200);
  });

  // guards P-1 — the OAuth token request needs the plaintext secret and nothing else may read it.
  it("reads the sealed client secret back for the token request only", async () => {
    store = createSqliteEtaStore();
    expect(await store.config.getClientSecret()).toBeNull();
    await store.config.setClientSecret("super-secret");
    expect(await store.config.getClientSecret()).toBe("super-secret");
    expect(JSON.stringify(await store.config.get())).not.toContain("super-secret");
  });
});

describe("SqliteEtaReceiptChainRepository — one chain per device serial (D283)", () => {
  const receipt = (n: number, serial: string, uuid: string): EtaSubmission => ({
    id: `r-${serial}-${n}`, internalId: `RCP-${serial}-${n}`, documentType: "receipt", status: "ready", etaUuid: uuid,
    payload: { seller: { deviceSerialNumber: serial } }, errors: [], exclusionReason: null,
    createdAt: `2026-09-01T10:00:0${n}.000Z`, updatedAt: `2026-09-01T10:00:0${n}.000Z`, submittedAt: null,
    gatewaySubmissionId: null, signature: null, transmitLog: [], receiptSerial: serial, receiptSeq: n,
  });

  it("stores the receipt and advances the head in one step", async () => {
    store = createSqliteEtaStore();
    expect(await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: null, submission: receipt(1, "POS-A", "u1") })).toBe(true);
    expect(await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: "u1", submission: receipt(2, "POS-A", "u2") })).toBe(true);
    expect(await store.receiptChain.head("POS-A")).toMatchObject({ lastUuid: "u2", lastSeq: 2, lastReceiptNumber: "RCP-POS-A-2" });
    expect((await store.submissions.findByInternalId("RCP-POS-A-2"))?.receiptSeq).toBe(2);
  });

  it("refuses — and writes NOTHING — when the head moved since the receipt was built", async () => {
    store = createSqliteEtaStore();
    await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: null, submission: receipt(1, "POS-A", "u1") });
    await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: "u1", submission: receipt(2, "POS-A", "u2") });
    const stale = await store.receiptChain.append({
      serial: "POS-A",
      expectedPreviousUuid: "u1",
      submission: { ...receipt(2, "POS-A", "u2-fork"), id: "fork", internalId: "RCP-FORK" },
    });
    expect(stale).toBe(false);
    expect(await store.submissions.findByInternalId("RCP-FORK")).toBeNull();
    expect((await store.receiptChain.head("POS-A"))?.lastUuid).toBe("u2");
    // A second "first receipt" for a device that already has one is a fork too.
    expect(await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: null, submission: { ...receipt(1, "POS-A", "u-again"), id: "again", internalId: "RCP-AGAIN" } })).toBe(false);
  });

  it("keeps each serial's head independent", async () => {
    store = createSqliteEtaStore();
    await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: null, submission: receipt(1, "POS-A", "a1") });
    await store.receiptChain.append({ serial: "POS-B", expectedPreviousUuid: null, submission: receipt(1, "POS-B", "b1") });
    await store.receiptChain.append({ serial: "POS-A", expectedPreviousUuid: "a1", submission: receipt(2, "POS-A", "a2") });
    expect((await store.receiptChain.list()).map((h) => [h.serial, h.lastUuid, h.lastSeq])).toEqual([
      ["POS-A", "a2", 2],
      ["POS-B", "b1", 1],
    ]);
  });

  it("seeds each device's head from receipts already in a books file written before the table existed", async () => {
    const Database = (await import("better-sqlite3")).default;
    const sqlite = new Database(":memory:");
    const first = createSqliteEtaStore(sqlite);
    await first.submissions.create(receipt(1, "POS-A", "old-1"));
    await first.submissions.create(receipt(2, "POS-A", "old-2"));
    sqlite.exec("DELETE FROM eta_receipt_chain");
    store = createSqliteEtaStore(sqlite);
    expect(await store.receiptChain.head("POS-A")).toMatchObject({ lastUuid: "old-2", lastSeq: 2 });
    sqlite.close();
  });
});

describe("POS device credentials", () => {
  it("are read back by serial for the token request only, and never through the mapping list", async () => {
    store = createSqliteEtaStore();
    await store.branchCodes.save({
      branchId: "b1", etaBranchCode: "1", deviceSerialNumber: "POS-A", posClientId: "pos-cid",
      hasPosClientSecret: false, posOsVersion: "windows", posModelFramework: "1",
    });
    await store.branchCodes.setPosClientSecret("b1", "pos-secret");
    await store.branchCodes.setPosPresharedKey!("b1", "psk");
    expect(await store.posCredentialsForSerial("POS-A")).toEqual({
      serial: "POS-A", clientId: "pos-cid", clientSecret: "pos-secret", osVersion: "windows", modelFramework: "1", presharedKey: "psk",
    });
    expect(await store.posCredentialsForSerial("POS-Z")).toBeNull();
    const listed = JSON.stringify(await store.branchCodes.list());
    expect(listed).not.toContain("pos-secret");
    expect(listed).not.toContain("psk\"");
    expect(listed).toContain('"hasPosPresharedKey":true');
  });

  it("are sealed under the platform key when one is given, and rows written as base64 are sealed on open", async () => {
    const sqlite = new Database(":memory:");
    const legacy = createSqliteEtaStore(sqlite);
    await legacy.config.setClientSecret("cfg-secret");
    await legacy.branchCodes.save({
      branchId: "b1", etaBranchCode: "1", deviceSerialNumber: "POS-A", posClientId: "pos-cid",
      hasPosClientSecret: false, posOsVersion: "windows", posModelFramework: "1",
    });
    await legacy.branchCodes.setPosClientSecret("b1", "pos-secret");
    await legacy.branchCodes.setPosPresharedKey!("b1", "psk");
    expect((sqlite.prepare("SELECT pos_client_secret_enc AS v FROM eta_branch_code").get() as { v: string }).v).toBe(Buffer.from("pos-secret").toString("base64"));

    const box = createAesGcmSecretBox(Buffer.alloc(32, 7));
    store = createSqliteEtaStore(sqlite, box);
    const raw = sqlite.prepare("SELECT c.client_secret_enc AS c, b.pos_client_secret_enc AS s, b.pos_preshared_key_enc AS k FROM eta_config c, eta_branch_code b").get() as Record<string, string>;
    for (const value of Object.values(raw)) expect(value.startsWith("mzs1:")).toBe(true);
    expect(await store.config.getClientSecret()).toBe("cfg-secret");
    expect(await store.posCredentialsForSerial("POS-A")).toMatchObject({ clientSecret: "pos-secret", presharedKey: "psk" });

    const otherKey = createSqliteEtaStore(sqlite, createAesGcmSecretBox(Buffer.alloc(32, 9)));
    expect(await otherKey.config.getClientSecret()).toBeNull();
    expect(await otherKey.posCredentialsForSerial("POS-A")).toBeNull();
    sqlite.close();
  });
});

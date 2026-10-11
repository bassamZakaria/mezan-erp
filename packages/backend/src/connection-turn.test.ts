import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, type EtaCommandResult } from "@mezan/domain";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";

const handles: BackendHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.drain();
    handle.close();
  }
});

interface Answer {
  readonly status: number;
  readonly reason: string | null;
  readonly body: unknown;
}

async function open(options: Partial<CreateBackendOptions> = {}) {
  const handle = await createBackend({ dbPath: ":memory:", ...options });
  handles.push(handle);
  const token = handle.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const signedIn = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = signedIn): Promise<Answer> => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, reason: res.headers.get("x-busy-reason"), body: parsed };
  };
  const signIn = (index: number) =>
    call("POST", "/auth/login", { username: `nobody${index}@example.eg`, pin: "123456" }, { "content-type": "application/json" });
  let brands = 0;
  const addBrand = () => {
    brands += 1;
    return call("POST", "/item-brands", { id: `brand-${brands}`, code: `B${brands}`, name: `Brand ${brands}`, nameAr: `ماركة ${brands}` });
  };
  return { handle, call, signIn, addBrand };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("a tenant's connection under a sign-in flood", () => {
  it("answers an authenticated read and write while a hundred sign-ins naming different accounts are still being checked", async () => {
    const t = await open();
    await t.signIn(0);

    const flood = Array.from({ length: 100 }, (_, index) => t.signIn(index + 1));
    let stillChecking = flood.length;
    for (const attempt of flood) void attempt.then(() => (stillChecking -= 1));
    await nextTurn();

    const read = await t.call("GET", "/item-brands");
    const write = await t.addBrand();
    const checkingWhenTheWriteLanded = stillChecking;
    const health = await t.call("GET", "/health");
    const outcomes = await Promise.all(flood);

    expect(read).toMatchObject({ status: 200, reason: null });
    expect(write).toMatchObject({ status: 201, reason: null });
    expect(health.status).toBe(200);
    expect(checkingWhenTheWriteLanded).toBeGreaterThan(50);
    expect(outcomes.filter((answer) => answer.status === 503)).toEqual([]);
    expect(new Set(outcomes.map((answer) => answer.status))).toEqual(new Set([401]));
  });

  it("refuses no read and no write when a hundred requests of every kind arrive together", async () => {
    const t = await open();
    await t.signIn(0);

    const mixed = Array.from({ length: 100 }, (_, index) =>
      index % 3 === 0 ? t.signIn(index + 1) : index % 3 === 1 ? t.addBrand() : t.call("GET", "/item-brands"),
    );
    const answers = await Promise.all(mixed);

    expect(answers.filter((answer) => answer.status === 503)).toEqual([]);
    expect(answers.filter((answer) => answer.status === 201)).toHaveLength(33);
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(33);
  });
});

describe("a tenant's connection while the signing program is slow", () => {
  async function withQueuedInvoice(run: CreateBackendOptions["etaSigningRunner"]) {
    const t = await open({
      etaSigningRunner: run,
      etaHttpClient: async (request) => {
        if (request.url.endsWith("/connect/token")) return { status: 200, body: JSON.stringify({ access_token: "token", expires_in: 3600 }) };
        const sent = JSON.parse(request.body ?? "{}") as { documents?: { internalID?: string }[] };
        const accepted = (sent.documents ?? []).map((doc) => ({ uuid: "UUID-1", internalId: doc.internalID, longId: "LONG-1" }));
        return { status: 202, body: JSON.stringify({ submissionId: "SUB-1", acceptedDocuments: accepted, rejectedDocuments: [] }) };
      },
    });
    const ok = (answer: Answer, status: number) => expect(answer, JSON.stringify(answer.body)).toMatchObject({ status });
    ok(
      await t.call("PUT", "/eta/config", {
        autoSubmitOnConfirm: true,
        taxRegistrationNumber: "123456789",
        activityCode: "4690",
        address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع عباس العقاد", buildingNumber: "12", postalCode: null },
        clientId: "client",
        clientSecret: "secret",
        signingMethod: "eseal",
        signingCommand: "signer",
        signingCommandArgs: [],
      }),
      200,
    );
    ok(await t.call("POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" }), 201);
    ok(await t.call("PUT", "/eta/branch-codes/BR-MAIN", { etaBranchCode: "0" }), 200);
    ok(await t.call("PUT", "/eta/item-mappings/SVC-1", { etaCodeType: "EGS", etaItemCode: "EG-123456789-1" }), 200);
    ok(await t.call("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "EA" }), 200);
    ok(
      await t.call("POST", "/customers", {
        id: "CUST-B2B",
        code: "CUST-B2B",
        nameAr: "شركة الأمل",
        paymentTermsDays: 30,
        currency: "EGP",
        openingBalance: "0",
        active: true,
        creditLimit: "0",
        taxExempt: false,
        etaBuyerType: "auto",
        taxNumber: "987654321",
      }),
      201,
    );
    ok(
      await t.call("POST", "/sales-invoices", {
        id: "INV-B2B",
        date: "2026-08-22",
        dueDate: "2026-09-21",
        customerId: "CUST-B2B",
        customerNameAr: "شركة الأمل",
        warehouseId: "WH-MAIN",
        branchId: "BR-MAIN",
        arAccountId: "1105",
        taxAccountId: "2200",
        lines: [
          { lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" },
        ],
      }),
      201,
    );
    ok(await t.call("POST", "/sales-invoices/INV-B2B/confirm", {}), 200);
    await t.handle.drain();
    const queued = (await t.call("GET", "/eta/submissions")).body as { id: string; documentType: string; status: string }[];
    const invoice = queued.find((submission) => submission.documentType === "invoice");
    if (!invoice) throw new Error(`no e-invoice was queued: ${JSON.stringify(queued)}`);
    return { ...t, submissionId: invoice.id };
  }

  it("posts another user's write while a submission waits on the signer, and refuses a second sender for the same document", async () => {
    let sign!: (result: EtaCommandResult) => void;
    let asked = 0;
    const t = await withQueuedInvoice(
      () =>
        new Promise<EtaCommandResult>((resolve) => {
          asked += 1;
          sign = resolve;
        }),
    );

    const submitting = t.call("POST", `/eta/submissions/${t.submissionId}/submit`);
    for (let waited = 0; waited < 200 && asked === 0; waited += 1) await nextTurn();
    expect(asked, JSON.stringify(await Promise.race([submitting, nextTurn()]))).toBe(1);

    const write = await t.addBrand();
    const read = await t.call("GET", "/item-brands");
    const second = await t.call("POST", `/eta/submissions/${t.submissionId}/submit`);
    const excluded = await t.call("POST", `/eta/submissions/${t.submissionId}/exclude`, { reason: "أُدخل بالخطأ" });

    expect(write).toMatchObject({ status: 201, reason: null });
    expect(read.status).toBe(200);
    expect(second).toMatchObject({ status: 409, body: { error: "ETA_SUBMISSION_IN_PROGRESS" } });
    expect(excluded).toMatchObject({ status: 409, body: { error: "ETA_SUBMISSION_IN_PROGRESS" } });
    expect(asked).toBe(1);

    sign({ code: 0, stdout: "CADES-SIGNATURE", stderr: "" });
    expect(await submitting).toMatchObject({ status: 200, body: { status: "submitted" } });
  });

  it("parks the document for another try when the signer fails, leaving it sendable", async () => {
    const t = await withQueuedInvoice(async () => ({ code: -1, stdout: "", stderr: "لم ينتهِ برنامج التوقيع خلال 60 ثانية فأُوقف." }));

    const parked = await t.call("POST", `/eta/submissions/${t.submissionId}/submit`);

    expect(parked, JSON.stringify(parked.body)).toMatchObject({ status: 200, body: { status: "pending_signature" } });
    expect((await t.addBrand()).status).toBe(201);
  });
});

describe("how much of a request the server will hold", () => {
  const padded = (bytes: number) => ({ id: "brand-big", code: "BIG", name: "Big", nameAr: "كبير", notes: "x".repeat(bytes) });

  it("refuses an anonymous body over 64 KiB before anything reads it, in Arabic", async () => {
    const t = await open();

    const refused = await t.call("POST", "/auth/login", { username: "nobody@example.eg", pin: "123456", padding: "x".repeat(70 * 1024) }, { "content-type": "application/json" });

    expect(refused).toMatchObject({ status: 413, body: { error: "PAYLOAD_TOO_LARGE", message: expect.stringContaining("أكبر من المسموح") } });
  });

  it("refuses an oversized body sent with no declared length just the same", async () => {
    const t = await open();
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 8) controller.close();
        else controller.enqueue(chunk);
        sent += 1;
      },
    });

    const res = await t.handle.app.fetch(
      new Request("http://local/auth/login", { method: "POST", body, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit),
    );

    expect(res.status).toBe(413);
  });

  it("gives a signed-in caller room for a document and not for a file on a route that takes none", async () => {
    const t = await open();

    expect((await t.call("POST", "/item-brands", padded(1024 * 1024))).status).not.toBe(413);
    expect((await t.call("POST", "/item-brands", padded(3 * 1024 * 1024))).status).toBe(413);
  });

  it("gives a signed-in caller room for a file on a route that takes files, and an anonymous one none", async () => {
    const t = await open();
    const file = { padding: "x".repeat(6 * 1024 * 1024) };

    expect((await t.call("POST", "/attachments", file)).status).not.toBe(413);
    expect((await t.call("POST", "/attachments", file, { "content-type": "application/json" })).status).toBe(413);
  });
});

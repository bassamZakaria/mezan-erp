import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, type EtaCommandResult } from "@mezan/domain";
import { IDEMPOTENT_CREATES } from "@mezan/api";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";
import { raced } from "./test/raced.js";

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
  readonly replayed: string | null;
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
    return { status: res.status, reason: res.headers.get("x-busy-reason"), replayed: res.headers.get("idempotent-replay"), body: parsed };
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
const SIGN_INS_ONE_ADDRESS_MAY_HOLD = 6;
/** A 503 from the connection's queue, as opposed to the sign-in queue saying it has no place. */
const databaseBusy = (answer: { status: number; body: unknown }): boolean =>
  answer.status === 503 && (answer.body as { error?: string } | null)?.error !== "SIGN_IN_BUSY";

describe("a tenant's connection under a sign-in flood", () => {
  it("answers an authenticated read and write while a sign-in flood is being checked, and refuses at once the sign-ins it has no place for", async () => {
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
    expect(checkingWhenTheWriteLanded).toBeGreaterThan(0);
    expect(outcomes.filter(databaseBusy)).toEqual([]);
    expect(new Set(outcomes.map((answer) => answer.status))).toEqual(new Set([401, 503]));
    expect(outcomes.filter((answer) => answer.status === 401)).toHaveLength(SIGN_INS_ONE_ADDRESS_MAY_HOLD);
    expect(outcomes.find((answer) => answer.status === 503)?.body).toMatchObject({ error: "SIGN_IN_BUSY", retryAfterSeconds: 2 });
  });

  it("refuses no read and no write when a hundred requests of every kind arrive together", async () => {
    const t = await open();
    await t.signIn(0);

    const mixed = Array.from({ length: 100 }, (_, index) =>
      index % 3 === 0 ? t.signIn(index + 1) : index % 3 === 1 ? t.addBrand() : t.call("GET", "/item-brands"),
    );
    const answers = await Promise.all(mixed);

    expect(answers.filter(databaseBusy)).toEqual([]);
    expect(answers.filter((answer) => answer.status === 201)).toHaveLength(33);
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(33);
  });
});

describe("a tenant's connection while the signing program is slow", () => {
  async function withQueuedInvoice(run: CreateBackendOptions["etaSigningRunner"]) {
    const filed: string[] = [];
    const t = await open({
      etaSigningRunner: run,
      etaHttpClient: async (request) => {
        if (request.url.endsWith("/connect/token")) return { status: 200, body: JSON.stringify({ access_token: "token", expires_in: 3600 }) };
        const sent = JSON.parse(request.body ?? "{}") as { documents?: { internalID?: string }[] };
        for (const doc of sent.documents ?? []) filed.push(doc.internalID ?? "");
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
    return { ...t, submissionId: invoice.id, filed };
  }

  it("files the document once when three senders press submit together", async () => {
    let asked = 0;
    const t = await withQueuedInvoice(async () => {
      asked += 1;
      await nextTurn();
      return { code: 0, stdout: "CADES-SIGNATURE", stderr: "" };
    });

    await raced(
      () => t.call("POST", `/eta/submissions/${t.submissionId}/submit`),
      (answers) => expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409, 409]),
    );

    expect(asked).toBe(1);
    expect(t.filed).toHaveLength(1);
    expect((await t.call("GET", `/eta/submissions/${t.submissionId}`)).body).toMatchObject({ status: "submitted" });
  });

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

describe("a create sent again because its answer never arrived", () => {
  const customer = {
    id: "CUST-1",
    code: "CUST-1",
    nameAr: "عميل نقدي",
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "0",
    active: true,
    creditLimit: "0",
    taxExempt: false,
    etaBuyerType: "auto",
  };
  const invoice = (id: string, unitPrice = "100") => ({
    id,
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "CUST-1",
    customerNameAr: "عميل نقدي",
    warehouseId: "WH-MAIN",
    branchId: "BR-MAIN",
    arAccountId: "1105",
    taxAccountId: "2200",
    lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice, taxRatePercent: 0, revenueAccountId: "4100" }],
  });
  const collection = (id: string, amount = "250.00") => ({
    id,
    date: "2026-08-22",
    customerId: "CUST-1",
    branchId: "BR-MAIN",
    treasuryAccountId: "ta-main",
    amount,
    paymentMethod: "cash",
    allocations: [],
  });

  async function shop() {
    const t = await open();
    const made = async (answer: Promise<Answer>) => {
      const got = await answer;
      expect(got.status, JSON.stringify(got.body)).toBe(201);
    };
    await made(t.call("POST", "/customers", customer));
    await made(t.call("POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" }));
    await made(
      t.call("POST", "/treasury-accounts", { id: "ta-main", code: "TA-MAIN", name: "الخزينة الرئيسية", branchId: "BR-MAIN", glAccountId: "1310" }),
    );
    const listed = async (path: string) => {
      const body = (await t.call("GET", path)).body as { items?: unknown[] } | unknown[];
      return Array.isArray(body) ? body : (body.items ?? []);
    };
    return { ...t, listed };
  }

  it("creates one sales invoice and answers the resend with it", async () => {
    const t = await shop();

    const first = await t.call("POST", "/sales-invoices", invoice("11111111-aaaa-4bbb-8ccc-000000000001"));
    const resent = await t.call("POST", "/sales-invoices", invoice("11111111-aaaa-4bbb-8ccc-000000000001"));

    expect(first.status).toBe(201);
    expect(resent).toMatchObject({ status: first.status, replayed: "true", body: first.body });
    expect(await t.listed("/sales-invoices")).toHaveLength(1);
  });

  it("takes a customer's money once when the collection is sent twice, and posts one journal entry", async () => {
    const t = await shop();
    const entriesBefore = (await t.listed("/gl/journal-entries")).length;

    const first = await t.call("POST", "/vouchers/collections", collection("22222222-aaaa-4bbb-8ccc-000000000002"));
    const resent = await t.call("POST", "/vouchers/collections", collection("22222222-aaaa-4bbb-8ccc-000000000002"));

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(resent).toMatchObject({ status: first.status, replayed: "true", body: first.body });
    expect(await t.listed("/vouchers")).toHaveLength(1);
    expect((await t.listed("/gl/journal-entries")).length).toBe(entriesBefore + 1);
  });

  it("creates one voucher when both sends are in flight together", async () => {
    const t = await shop();

    const [a, b] = await Promise.all([
      t.call("POST", "/vouchers/collections", collection("33333333-aaaa-4bbb-8ccc-000000000003")),
      t.call("POST", "/vouchers/collections", collection("33333333-aaaa-4bbb-8ccc-000000000003")),
    ]);

    expect(a.status).toBe(201);
    expect([a.replayed, b.replayed].sort()).toEqual([null, "true"].sort());
    const [made, replayed] = a.replayed === null ? [a, b] : [b, a];
    expect(replayed.body).toMatchObject(made.body as object);
    expect(await t.listed("/vouchers")).toHaveLength(1);
  });

  it("refuses the same id with different contents, in Arabic, and records nothing more", async () => {
    const t = await shop();
    await t.call("POST", "/vouchers/collections", collection("44444444-aaaa-4bbb-8ccc-000000000004"));

    const changed = await t.call("POST", "/vouchers/collections", collection("44444444-aaaa-4bbb-8ccc-000000000004", "999.00"));

    expect(changed).toMatchObject({ status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: expect.stringContaining("ببيانات مختلفة") } });
    expect(await t.listed("/vouchers")).toHaveLength(1);
  });

  it("does not hand one user's recorded answer to another signed-in user who sends the same id", async () => {
    const t = await shop();
    const id = "55555555-aaaa-4bbb-8ccc-000000000005";
    const first = await t.call("POST", "/sales-invoices", invoice(id));
    const colleague = t.handle.sessions.issue({ userId: "user-b", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const asColleague = { authorization: `Bearer ${colleague}`, "content-type": "application/json" };

    const sameBody = await t.call("POST", "/sales-invoices", invoice(id), asColleague);
    const otherBody = await t.call("POST", "/sales-invoices", invoice(id, "999"), asColleague);
    const anonymous = await t.call("POST", "/sales-invoices", invoice(id), { "content-type": "application/json" });

    expect(first.status).toBe(201);
    expect(sameBody).toMatchObject({ status: 409, replayed: null, body: { error: "DUPLICATE_SALES_INVOICE" } });
    expect(otherBody).toMatchObject({ status: 409, replayed: null, body: { error: "DUPLICATE_SALES_INVOICE" } });
    expect(anonymous.status).toBe(401);
    expect(await t.listed("/sales-invoices")).toHaveLength(1);
  });

  it("answers the same create with its keys in another order as the resend it is", async () => {
    const t = await shop();
    const body = invoice("77777777-aaaa-4bbb-8ccc-000000000007");
    const first = await t.call("POST", "/sales-invoices", body);

    const reordered = Object.fromEntries(Object.entries(body).reverse().map(([key, value]) => [key, key === "lines" ? body.lines.map((line) => Object.fromEntries(Object.entries(line).reverse())) : value]));
    const resent = await t.call("POST", "/sales-invoices", reordered);

    expect(first.status).toBe(201);
    expect(resent).toMatchObject({ status: 201, replayed: "true", body: { id: body.id } });
    expect(await t.listed("/sales-invoices")).toHaveLength(1);
  });

  it("answers a resend with the document as it stands now, not as it was first created", async () => {
    const t = await shop();
    const body = invoice("88888888-aaaa-4bbb-8ccc-000000000008");
    const first = await t.call("POST", "/sales-invoices", body);
    expect((await t.call("POST", `/sales-invoices/${body.id}/confirm`, {})).status).toBe(200);

    const resent = await t.call("POST", "/sales-invoices", body);

    expect(first.body).toMatchObject({ status: "draft", docNo: null });
    expect(resent).toMatchObject({ status: 201, replayed: "true", body: { id: body.id, status: "confirmed", docNo: expect.stringMatching(/^INV-/) } });
  });

  it("answers a resent collection with the voucher as it stands now", async () => {
    const t = await shop();
    const body = collection("99999999-aaaa-4bbb-8ccc-000000000009");
    const first = await t.call("POST", "/vouchers/collections", body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await t.call("POST", `/vouchers/${body.id}/reverse`, { date: "2026-08-23" })).status).toBe(201);

    const resent = await t.call("POST", "/vouchers/collections", body);

    expect(resent).toMatchObject({ status: 201, replayed: "true", body: { held: false, voucher: { id: body.id, status: "reversed" } } });
    expect(await t.listed("/vouchers")).toHaveLength(2);
  });

  it("posts one journal entry when a manual entry is sent twice", async () => {
    const t = await shop();
    const entry = {
      id: "aaaaaaaa-aaaa-4bbb-8ccc-00000000000a",
      date: "2026-08-22",
      memo: "قيد تسوية",
      lines: [
        { accountId: "2170", debit: "100.00", credit: "0" },
        { accountId: "2190", debit: "0", credit: "100.00" },
      ],
    };
    const before = (await t.listed("/gl/journal-entries")).length;

    const first = await t.call("POST", "/gl/journal-entries", entry);
    const resent = await t.call("POST", "/gl/journal-entries", entry);

    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(resent).toMatchObject({ status: 201, replayed: "true", body: { id: entry.id } });
    expect((await t.listed("/gl/journal-entries")).length).toBe(before + 1);
  });

  it("reads back every create it answers again through a route that exists", async () => {
    const t = await shop();

    for (const create of IDEMPOTENT_CREATES) {
      const read = await t.call("GET", create.read("no-such-document"));
      expect(read.status, create.path).toBe(404);
      expect(typeof read.body, `${create.path} is read back from ${create.read("…")}, which no route serves`).toBe("object");
    }
  });

  it("records nothing for a create that was refused, so the corrected resend goes through", async () => {
    const t = await shop();
    const refused = await t.call("POST", "/sales-invoices", { ...invoice("66666666-aaaa-4bbb-8ccc-000000000006"), customerId: "NOBODY" });
    expect(refused.status).toBeGreaterThanOrEqual(400);

    expect((await t.call("POST", "/sales-invoices", invoice("66666666-aaaa-4bbb-8ccc-000000000006"))).status).toBe(201);
  });
});

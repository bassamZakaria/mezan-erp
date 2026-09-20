import { afterEach, describe, expect, it } from "vitest";
import { Money, NextNumberService, type Account } from "@mezan/domain";
import { InMemoryAccountRepository } from "../../domain/src/accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../../domain/src/fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import {
  InMemoryLedgerRepository,
  InMemorySequenceStore,
} from "../../domain/src/gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryProjectRepository } from "../../domain/src/projects/test-helpers/in-memory-project-repository.js";
import { InMemoryTreasuryAccountRepository } from "../../domain/src/treasury-accounts/test-helpers/in-memory-treasury-account-repository.js";
import { createSqliteGuaranteeStore, type SqliteGuaranteeStoreHandle } from "@mezan/persistence";
import { createContractingGuaranteesRoutes } from "./contracting-guarantees-routes.js";
import { insecureHeaderAuthContextResolver } from "./permission-gate.js";

// The register's OWN codes. It used to read and write under the treasury
// voucher permissions, which put the cashier at the counter in charge of the
// company's performance bonds.
const VIEW = "contracting.guarantee.view";
const WRITE = "contracting.guarantee.manage";
const RELEASE = "contracting.guarantee.release";
const TODAY = "2026-09-13";

const handles: SqliteGuaranteeStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function account(id: string, type: Account["type"], naturalBalance: Account["naturalBalance"]): Account {
  return { id, code: id, nameAr: id, nameEn: null, type, naturalBalance, parentId: null, isHeader: false, status: "active" };
}

async function newApp(contracts?: { exists(id: string): Promise<boolean> }) {
  const guarantees = createSqliteGuaranteeStore();
  handles.push(guarantees);
  const accounts = new InMemoryAccountRepository();
  const periods = new InMemoryFiscalPeriodRepository();
  const ledger = new InMemoryLedgerRepository();
  const treasuryAccounts = new InMemoryTreasuryAccountRepository();
  const projects = new InMemoryProjectRepository();

  await accounts.create(account("9100", "memorandum", "debit"));
  await accounts.create(account("9200", "memorandum", "credit"));
  await accounts.create(account("1340", "asset", "debit"));
  await accounts.create(account("1310", "asset", "debit"));
  await accounts.create(account("5930", "expense", "debit"));
  await periods.create({ id: "fp-2026-09", year: 2026, periodNumber: 9, startDate: "2026-09-01", endDate: "2026-09-30", status: "open" });
  await treasuryAccounts.create({
    id: "TR-BANK",
    code: "BANK-001",
    name: "البنك الأهلي",
    nameEn: null,
    type: "bank",
    currency: "EGP",
    bankAccountNumber: null,
    branchId: "b1",
    glAccountId: "1310",
    openingBalance: Money.zero(),
    openingBalanceDate: null,
    guaranteeFacilityLimit: Money.fromMajor("5000000"),
    status: "active",
  });

  const app = createContractingGuaranteesRoutes(
    {
      guarantees,
      treasuryAccounts,
      treasuryAccountsList: treasuryAccounts,
      accounts,
      projects,
      projectsList: projects,
      gl: { ledger, accounts, periods, numbering: new NextNumberService(new InMemorySequenceStore()), projects },
      today: () => TODAY,
      ...(contracts ? { contracts } : {}),
    },
    insecureHeaderAuthContextResolver,
  );
  return { app, ledger };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const DRAFT = {
  id: "LG-1",
  kind: "bid" as const,
  tenderRef: "TND-021",
  beneficiaryNameAr: "الشركة القابضة",
  bankTreasuryAccountId: "TR-BANK",
  faceValue: "184500",
  cashMarginPercent: "20",
  issueDate: "2026-09-01",
  expiryDate: "2026-09-25",
};

describe("guarantees router — permission gate", () => {
  it("refuses a read with no permission at all", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe(VIEW);
  });

  it("refuses a write to a caller who may only look", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/", { method: "POST", permissions: VIEW, body: JSON.stringify(DRAFT) }));
    expect(res.status).toBe(403);
  });

  it("lets the register's own manage permission through", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(DRAFT) }));
    expect(res.status).toBe(201);
  });
});

describe("guarantees router — contracts.exists port", () => {
  it("422s a guarantee naming an unknown contractId when the port is supplied", async () => {
    const { app } = await newApp({ exists: async () => false });
    const res = await app.fetch(
      req("/", { method: "POST", permissions: WRITE, body: JSON.stringify({ ...DRAFT, contractId: "CTR-0099" }) }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { reasons: string[] };
    expect(body.reasons.join(" ")).toContain("CTR-0099");
  });

  it("accepts a guarantee naming a contractId the port confirms exists", async () => {
    const { app } = await newApp({ exists: async (id) => id === "CTR-0001" });
    const res = await app.fetch(
      req("/", { method: "POST", permissions: WRITE, body: JSON.stringify({ ...DRAFT, contractId: "CTR-0001" }) }),
    );
    expect(res.status).toBe(201);
  });
});

describe("guarantees router — the register end to end", () => {
  it("issues, derives the expiry pill, and reports the facility left", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(DRAFT) }));
    const issued = (await (await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }))).json()) as {
      docNo: string;
      status: string;
      derivedStatus: string;
      daysToExpiry: number;
      cashMarginAmount: string;
    };
    expect(issued.docNo).toBe("LG-000001");
    expect(issued.status).toBe("active");
    expect(issued.daysToExpiry).toBe(12);
    expect(issued.cashMarginAmount).toBe("36900.000000");

    const summary = (await (await app.fetch(req("/summary", { permissions: VIEW }))).json()) as {
      totalOutstanding: string;
      restrictedCash: string;
      totalAvailable: string;
      expiringWithin30Days: number;
      byBank: { available: string | null }[];
    };
    expect(summary.totalOutstanding).toBe("184500.000000");
    expect(summary.restrictedCash).toBe("36900.000000");
    expect(summary.totalAvailable).toBe("4815500.000000");
    expect(summary.expiringWithin30Days).toBe(1);
    expect(summary.byBank[0]?.available).toBe("4815500.000000");

    const expiring = (await (await app.fetch(req("/expiring?days=30", { permissions: VIEW }))).json()) as { docNo: string }[];
    expect(expiring.map((g) => g.docNo)).toEqual(["LG-000001"]);
  });

  it("reads «منتهي» from the expiry date without touching the stored status", async () => {
    const { app } = await newApp();
    await app.fetch(
      req("/", { method: "POST", permissions: WRITE, body: JSON.stringify({ ...DRAFT, expiryDate: "2026-09-10" }) }),
    );
    await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }));
    const one = (await (await app.fetch(req("/LG-000001", { permissions: VIEW }))).json()) as {
      status: string;
      derivedStatus: string;
    };
    expect(one.status).toBe("active");
    expect(one.derivedStatus).toBe("expired");

    const filtered = (await (await app.fetch(req("/?status=expired", { permissions: VIEW }))).json()) as unknown[];
    expect(filtered).toHaveLength(1);
  });
});

describe("guarantees router — refusals arrive as 4xx in Arabic, never a 500", () => {
  it("refuses a letter attached to neither a project nor a tender", async () => {
    const { app } = await newApp();
    const { tenderRef, ...noTender } = DRAFT;
    const res = await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(noTender) }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("INVALID_GUARANTEE");
    expect(body.message).toContain("مشروع");
  });

  it("refuses a second issue with 409", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(DRAFT) }));
    await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }));
    const res = await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_GUARANTEE_TRANSITION");
  });

  it("refuses a call whose charge account is not in the chart of accounts", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(DRAFT) }));
    await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }));
    const res = await app.fetch(
      req("/LG-1/call", {
        method: "POST",
        permissions: RELEASE,
        body: JSON.stringify({ date: "2026-09-12", chargeAccountId: "9999" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("GUARANTEE_CHARGE_ACCOUNT_NOT_FOUND");
  });

  it("refuses a reduction bigger than what is left with 422", async () => {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(DRAFT) }));
    await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }));
    const res = await app.fetch(
      req("/LG-1/reduce", {
        method: "POST",
        permissions: WRITE,
        body: JSON.stringify({ date: "2026-09-12", amount: "999999", reason: "استرداد" }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("GUARANTEE_AMOUNT_EXCEEDS_VALUE");
  });

  it("answers 404 for a letter number that does not exist", async () => {
    const { app } = await newApp();
    const res = await app.fetch(req("/LG-999999", { permissions: VIEW }));
    expect(res.status).toBe(404);
  });
});

describe("guarantees router — giving the letter back is its own right", () => {
  async function issued() {
    const { app } = await newApp();
    await app.fetch(req("/", { method: "POST", permissions: WRITE, body: JSON.stringify(DRAFT) }));
    await app.fetch(req("/LG-1/issue", { method: "POST", permissions: WRITE, body: "{}" }));
    return app;
  }

  it("refuses a release to someone who may only issue and reduce", async () => {
    const app = await issued();
    const res = await app.fetch(
      req("/LG-1/release", { method: "POST", permissions: WRITE, body: JSON.stringify({ date: "2026-09-12" }) }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission: string }).permission).toBe(RELEASE);
  });

  it("stamps the acting user on the release and on every reduction", async () => {
    const app = await issued();
    await app.fetch(
      req("/LG-1/reduce", {
        method: "POST",
        permissions: WRITE,
        headers: { "x-user-id": "u-contracts" },
        body: JSON.stringify({ date: "2026-09-05", amount: "1000", reason: "استرداد جزئي" }),
      }),
    );
    const res = await app.fetch(
      req("/LG-1/release", {
        method: "POST",
        permissions: RELEASE,
        headers: { "x-user-id": "u-finance" },
        body: JSON.stringify({ date: "2026-09-12" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { closedBy: string; reductions: { userId: string }[] };
    expect(body.closedBy).toBe("u-finance");
    expect(body.reductions[0]?.userId).toBe("u-contracts");
  });

  it("refuses a release dated before the letter was issued", async () => {
    const app = await issued();
    const res = await app.fetch(
      req("/LG-1/release", { method: "POST", permissions: RELEASE, body: JSON.stringify({ date: "2026-08-01" }) }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("INVALID_GUARANTEE");
  });

  it("refuses a release dated in the future", async () => {
    const app = await issued();
    const res = await app.fetch(
      req("/LG-1/release", { method: "POST", permissions: RELEASE, body: JSON.stringify({ date: "2027-01-01" }) }),
    );
    expect(res.status).toBe(422);
  });
});

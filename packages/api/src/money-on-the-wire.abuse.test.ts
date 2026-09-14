import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteUnitOfWork,
  createSqliteLedgerStore,
  createSqliteAccountRepository,
  createSqliteFiscalPeriodRepository,
} from "@mezan/persistence";
import { createApp } from "./app.js";

const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

const POSTABLE = { nameEn: null, parentId: null, isHeader: false, status: "active" as const };

async function newApp() {
  const uow = createSqliteUnitOfWork();
  const ledger = createSqliteLedgerStore();
  const accounts = createSqliteAccountRepository();
  const periods = createSqliteFiscalPeriodRepository();
  handles.push(uow, ledger, accounts, periods);

  await accounts.create({ id: "1300-1", code: "1300-1", nameAr: "النقدية", type: "asset", naturalBalance: "debit", ...POSTABLE });
  await accounts.create({ id: "4000", code: "4000", nameAr: "الإيرادات", type: "revenue", naturalBalance: "credit", ...POSTABLE });
  await periods.create({
    id: "fp-2026-01",
    year: 2026,
    periodNumber: 1,
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    status: "open",
  });

  const app = createApp(uow, { gl: { ledger, accounts, periods, numbering: ledger.numbering } });
  return { app, ledger };
}

function post(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json", "x-permissions": "accounting.journal.post" }),
    body: JSON.stringify(body),
  });
}

/**
 * Money crosses the wire as a decimal STRING, because in the domain it is a
 * bigint at scale 1e-6 and a float would lose the piastre. Around seventy of
 * those fields were declared in `@mezan/contracts` as a bare `z.string()` with
 * no decimal check, so the only thing between a malformed literal and
 * `Money.fromMajor` — which throws a `RangeError` — was the route's own error
 * handling, and there wasn't any: a malformed REQUEST was answered 500, as
 * though the server had faulted (D126).
 *
 * `moneyString` in `@mezan/contracts` now states `fromMajor`'s rules once and
 * every money field uses it. Nothing was ever persisted through the old hole,
 * so this was always a robustness and support-cost defect rather than a
 * correctness one — which is exactly why it survived: the books stayed right
 * while the support queue filled with "it says server error".
 */
const MALFORMED = [
  "1e3",
  "0x10",
  "Infinity",
  "NaN",
  "1,50",
  "١٢٣٤",
  "1.2.3",
  "--1",
  "",
  "1.0000001",
  " 100 ",
  "+100",
];

function entry(debit: string, id = `JE-MONEY-${Math.random().toString(36).slice(2, 10)}`) {
  return {
    id,
    date: "2026-01-01",
    memo: "قيد بمبلغ غير صالح",
    lines: [
      { accountId: "1300-1", debit, credit: "0" },
      { accountId: "4000", debit: "0", credit: "100.00" },
    ],
  };
}

describe("a malformed money literal on the wire (D126)", () => {
  it("answers 400 for every malformed amount — a bad request reads as a bad request", async () => {
    const { app } = await newApp();
    const statuses: Record<string, number> = {};
    for (const literal of MALFORMED) {
      const res = await app.fetch(post("/gl/journal-entries", entry(literal)));
      statuses[literal] = res.status;
    }
    expect(statuses).toEqual(Object.fromEntries(MALFORMED.map((l) => [l, 400])));
  });

  it("names the offending field, so the client knows which amount to fix", async () => {
    const { app } = await newApp();
    const res = await app.fetch(post("/gl/journal-entries", entry("1e3")));
    const body = (await res.json()) as { error: string; details?: { fieldErrors?: Record<string, unknown> } };
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(body.details)).toMatch(/lines/);
  });

  it("writes nothing for any of them", async () => {
    const { app, ledger } = await newApp();
    for (const literal of MALFORMED) {
      await app.fetch(post("/gl/journal-entries", entry(literal, `JE-NOPE-${MALFORMED.indexOf(literal)}`)));
    }
    for (let i = 0; i < MALFORMED.length; i += 1) {
      expect(await ledger.findById(`JE-NOPE-${i}`)).toBeNull();
    }
  });

  it("accepts the same entry once the amount is well formed, so the tests above are not refusing everything", async () => {
    const { app } = await newApp();
    const res = await app.fetch(post("/gl/journal-entries", entry("100.00", "JE-MONEY-OK")));
    expect(res.status).toBe(201);
  });

  it("refuses a padded literal rather than trimming it quietly", async () => {
    // `Money.fromMajor` trims before it validates, so " 100.00 " used to be
    // accepted silently. A padded amount is a client bug worth hearing about.
    const { app } = await newApp();
    const res = await app.fetch(post("/gl/journal-entries", entry(" 100.00 ", "JE-MONEY-PADDED")));
    expect(res.status).toBe(400);
  });

  it("keeps the full six decimals of a micro-unit amount rather than rounding it away", async () => {
    const { app, ledger } = await newApp();
    const res = await app.fetch(
      post("/gl/journal-entries", {
        id: "JE-MONEY-MICRO",
        date: "2026-01-01",
        memo: "ستة أرقام عشرية",
        lines: [
          { accountId: "1300-1", debit: "0.000001", credit: "0" },
          { accountId: "4000", debit: "0", credit: "0.000001" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const stored = await ledger.findById("JE-MONEY-MICRO");
    expect(stored?.lines[0]?.debit.toString()).toBe("0.000001");
  });

  it("refuses a seventh decimal place instead of throwing on it", async () => {
    const { app } = await newApp();
    const res = await app.fetch(post("/gl/journal-entries", entry("0.0000001", "JE-MONEY-SEVEN")));
    expect(res.status).toBe(400);
  });
});

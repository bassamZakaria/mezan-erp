import { afterEach, describe, expect, it } from "vitest";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { createApp } from "./app.js";

const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const uow = createSqliteUnitOfWork();
  handles.push(uow);
  return { app: createApp(uow, {}), uow };
}

function post(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: new Headers({ "content-type": "application/json" }),
    body: JSON.stringify(body),
  });
}

/**
 * Money crosses the wire as a decimal STRING, because in the domain it is a
 * bigint at scale 1e-6 and a float would lose the piastre. Roughly sixty of
 * those fields are declared in `@mezan/contracts` as a bare `z.string()`
 * with no decimal check, so the only thing between a malformed literal and
 * `Money.fromMajor` — which throws a RangeError — is the route's own error
 * handling. See D126.
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
  it("LIMITATION (D126): every malformed amount is answered 500, not 400 — a bad request reads as a server fault", async () => {
    // `journalLineSchema.debit` is `z.string()`, so Zod passes each of these
    // straight through and `Money.fromMajor` throws a RangeError the route
    // never catches. The caller cannot tell "your amount is malformed" from
    // "the server is broken", and each attempt writes a stack trace to the
    // log. The fix is a decimal-string schema in @mezan/contracts; when it
    // lands, this expectation becomes 400 and the test stays.
    const { app } = newApp();
    const statuses: Record<string, number> = {};

    for (const literal of MALFORMED) {
      const res = await app.fetch(post("/journal-entries", entry(literal)));
      statuses[literal] = res.status;
    }

    expect(statuses).toEqual({
      "1e3": 500,
      "0x10": 500,
      Infinity: 500,
      NaN: 500,
      "1,50": 500,
      "١٢٣٤": 500,
      "1.2.3": 500,
      "--1": 500,
      "": 500,
      "1.0000001": 500,
    });
  });

  it("writes nothing for any of them — the failure is loud, but at least it is not partial", async () => {
    const { app, uow } = newApp();
    const written: string[] = [];

    for (const literal of MALFORMED) {
      const body = entry(literal);
      await app.fetch(post("/journal-entries", body));
      if (await uow.journal.findById(body.id)) written.push(literal);
    }

    expect(written).toEqual([]);
  });

  it("accepts the same entry once the amount is well formed, so the tests above are not refusing everything", async () => {
    const { app, uow } = newApp();
    const body = entry("100.00", "JE-MONEY-OK");
    const res = await app.fetch(post("/journal-entries", body));

    expect(res.status).toBe(201);
    const stored = await uow.journal.findById("JE-MONEY-OK");
    expect(stored?.lines[0]?.debit.toString()).toBe("100.000000");
  });

  it("silently accepts a padded literal, because Money.fromMajor trims before it validates", async () => {
    // Not a defect on its own — it is stated here so that tightening the
    // parser later is a deliberate, visible change rather than a surprise
    // rejection of data some integration is already sending.
    const { app, uow } = newApp();
    const body = entry(" 100.00 ", "JE-MONEY-PADDED");
    const res = await app.fetch(post("/journal-entries", body));

    expect(res.status).toBe(201);
    expect((await uow.journal.findById("JE-MONEY-PADDED"))?.lines[0]?.debit.toString()).toBe("100.000000");
  });

  it("keeps the full six decimals of a micro-unit amount rather than rounding it away", async () => {
    const { app, uow } = newApp();
    const res = await app.fetch(
      post("/journal-entries", {
        id: "JE-MONEY-MICRO",
        date: "2026-01-01",
        memo: "قيد بوحدات دقيقة",
        lines: [
          { accountId: "1300-1", debit: "0.000001", credit: "0" },
          { accountId: "4000", debit: "0", credit: "0.000001" },
        ],
      }),
    );

    expect(res.status).toBe(201);
    const stored = await uow.journal.findById("JE-MONEY-MICRO");
    expect(stored?.lines[0]?.debit.toString()).toBe("0.000001");
    expect(stored?.lines[1]?.credit.toString()).toBe("0.000001");
  });
});

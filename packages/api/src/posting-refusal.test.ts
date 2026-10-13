import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DocumentNotFoundError, NoFiscalPeriodForDateError, PeriodNotOpenForPostingError, StockPlanDateRequiredError, VatPeriodAlreadyFiledError } from "@mezan/domain";
import { handleDocumentError } from "./document-error-handling.js";
import { postingRefusalResponse } from "./posting-refusal.js";
import { reversalRefusalResponse } from "./document-reversal.js";

const SHARED_ANSWER = /postingRefusalResponse\(|reversalRefusalResponse\(/;

const here = path.dirname(fileURLToPath(import.meta.url));

function routeFiles(): { name: string; source: string }[] {
  return readdirSync(here)
    .filter((name) => name.endsWith("-routes.ts"))
    .map((name) => ({ name, source: readFileSync(path.join(here, name), "utf8") }));
}

async function answer(handler: (c: Parameters<typeof postingRefusalResponse>[0], err: unknown) => Response | null, error: Error) {
  const app = new Hono();
  app.post("/x", (c) => handler(c, error) ?? c.json({ error: "UNMAPPED" }, 500));
  const res = await app.fetch(new Request("http://local/x", { method: "POST" }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("a posting dated into a shut or missing period", () => {
  const closed = new PeriodNotOpenForPostingError({ id: "fp-2026-06", year: 2026, periodNumber: 6 }, "closed");
  const missing = new NoFiscalPeriodForDateError("2031-01-01");

  it("is answered 422 with the month named in Arabic and in English", async () => {
    expect(await answer(postingRefusalResponse, closed)).toEqual({
      status: 422,
      body: {
        error: "PERIOD_NOT_OPEN_FOR_POSTING",
        message: "الفترة المحاسبية «يونيو 2026» مغلقة ولا تسمح بالترحيل.",
        messageEn: "Fiscal period June 2026 is closed and does not accept postings.",
        periodId: "fp-2026-06",
        status: "closed",
      },
    });
    const none = await answer(postingRefusalResponse, missing);
    expect(none.status).toBe(422);
    expect(none.body).toMatchObject({ error: "NO_FISCAL_PERIOD_FOR_DATE", message: missing.message, messageEn: 'No fiscal period covers the date "2031-01-01".' });
  });

  it("is answered the same way by the handler every framework document shares — returns, landed costs, instalment plans", async () => {
    expect((await answer(handleDocumentError, closed)).body).toMatchObject({ error: "PERIOD_NOT_OPEN_FOR_POSTING", messageEn: closed.messageEn });
    expect((await answer(handleDocumentError, missing)).body).toMatchObject({ error: "NO_FISCAL_PERIOD_FOR_DATE", messageEn: missing.messageEn });
    expect((await answer(handleDocumentError, new DocumentNotFoundError("SALES_RETURN", "x"))).status).toBe(404);
  });

  it("the reversal answer a reverse route uses gives the same period refusal, so a handler built on it is not silent", async () => {
    expect(await answer(reversalRefusalResponse, closed)).toEqual(await answer(postingRefusalResponse, closed));
    expect(await answer(reversalRefusalResponse, missing)).toEqual(await answer(postingRefusalResponse, missing));
  });

  it("every route file's own error handler gives the shared answer, so a stock-only confirm names the month in both languages too", () => {
    const silent = routeFiles()
      .filter(({ source }) => /^function handle\w*Error\(c: Context, err: unknown\)/m.test(source) && !SHARED_ANSWER.test(source))
      .map(({ name }) => name);
    expect(silent).toEqual([]);
  });

  it("no route file maps the period refusal by hand without the shared answer", () => {
    const byHand = routeFiles()
      .filter(({ source }) => source.includes("instanceof PeriodNotOpenForPostingError") && !SHARED_ANSWER.test(source))
      .map(({ name }) => name);
    expect(byHand).toEqual([]);
  });

  it("a posting dated into a month whose VAT return is filed is a 422 in both languages, not a 500", async () => {
    const filed = new VatPeriodAlreadyFiledError("VAT-2026-06", "2026-06-15");
    expect(await answer(postingRefusalResponse, filed)).toEqual({
      status: 422,
      body: {
        error: "VAT_PERIOD_ALREADY_FILED",
        message: "لا يمكن الترحيل بتاريخ 2026-06-15: إقرار ضريبة القيمة المضافة عن هذه الفترة (VAT-2026-06) قد قُدّم بالفعل. عدّل الإقرار أولاً إن كان لا بد من التغيير.",
        messageEn: "Nothing can be posted on 2026-06-15: the VAT return for this period (VAT-2026-06) has already been filed. Amend the return first if the change is unavoidable.",
        filingId: "VAT-2026-06",
        date: "2026-06-15",
      },
    });
  });

  it("every refusal the posting gate can raise has the shared answer", async () => {
    const samples: Record<string, Error> = {
      PeriodNotOpenForPostingError: closed,
      NoFiscalPeriodForDateError: missing,
      VatPeriodAlreadyFiledError: new VatPeriodAlreadyFiledError("VAT-1", "2026-06-15"),
      StockPlanDateRequiredError: new StockPlanDateRequiredError("SALES_INVOICE", "x"),
    };
    const domain = path.join(here, "../../domain/src");
    const gate = (file: string, fn: string): string[] => {
      const source = readFileSync(path.join(domain, file), "utf8");
      const start = source.indexOf(`export ${fn}`);
      expect(start, `${fn} in ${file}`).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf("\n}\n", start));
      return [...body.matchAll(/throw new (\w+)\(/g)].map((m) => m[1]!);
    };
    const raised = [
      ...gate("gl/post.ts", "async function assertPeriodOpen"),
      ...gate("gl/post.ts", "async function assertVatNotFiled"),
      ...gate("fiscal-periods/transitions.ts", "function assertOpenForPosting"),
      ...gate("inventory/document-hooks.ts", "function stockPlanOccurredAt"),
    ];
    expect(new Set(raised)).toEqual(new Set(Object.keys(samples)));
    for (const name of raised) {
      const { status, body } = await answer(postingRefusalResponse, samples[name]!);
      expect(`${name} ${status}`).toBe(`${name} 422`);
      expect(String(body.message)).toMatch(/[\u0600-\u06FF]/);
      expect(String(body.messageEn)).toMatch(/[a-z]/);
    }
  });
});

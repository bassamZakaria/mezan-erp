import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DocumentNotFoundError, NoFiscalPeriodForDateError, PeriodNotOpenForPostingError } from "@mezan/domain";
import { handleDocumentError } from "./document-error-handling.js";
import { postingRefusalResponse } from "./posting-refusal.js";

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

  it("no route file maps the period refusal by hand without the shared answer", () => {
    const byHand = routeFiles()
      .filter(({ source }) => source.includes("instanceof PeriodNotOpenForPostingError") && !source.includes("postingRefusalResponse("))
      .map(({ name }) => name);
    expect(byHand).toEqual([]);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { NoFiscalPeriodForDateError, PeriodNotOpenForPostingError, StockPlanDateRequiredError } from "@mezan/domain";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { createApp } from "./app.js";

const handles: { close(): void }[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function appThatThrows(error: Error) {
  const uow = createSqliteUnitOfWork();
  handles.push(uow);
  const app = createApp(uow, {});
  app.post("/__unmapped-posting-route", () => {
    throw error;
  });
  return app;
}

async function postInto(error: Error) {
  const res = await appThatThrows(error).fetch(new Request("http://local/__unmapped-posting-route", { method: "POST" }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("createApp — the last net", () => {
  it("answers a closed-period refusal as 422 with the period's own message, not 500", async () => {
    const error = new PeriodNotOpenForPostingError("fp-2026-10", "closed");
    const { status, body } = await postInto(error);
    expect(status).toBe(422);
    expect(body).toEqual({ error: "PERIOD_NOT_OPEN_FOR_POSTING", message: error.message, messageEn: error.messageEn, periodId: "fp-2026-10", status: "closed" });
    expect(error.messageEn).toContain("closed");
  });

  it("answers a date with no fiscal period as 422 with its own message, not 500", async () => {
    const error = new NoFiscalPeriodForDateError("2031-01-01");
    const { status, body } = await postInto(error);
    expect(status).toBe(422);
    expect(body).toEqual({ error: "NO_FISCAL_PERIOD_FOR_DATE", message: error.message, messageEn: 'No fiscal period covers the date "2031-01-01".', date: "2031-01-01" });
  });

  it("answers a stock plan that reached the ledger without its document's date as 422 in both languages, not 500", async () => {
    const error = new StockPlanDateRequiredError("SALES_RETURN", "SR-1");
    const { status, body } = await postInto(error);
    expect(status).toBe(422);
    expect(body).toEqual({ error: "STOCK_PLAN_DATE_REQUIRED", message: error.message, messageEn: error.messageEn });
  });

  it("still answers an error nobody recognises as 500 «خطأ داخلي»", async () => {
    const { status, body } = await postInto(new Error("boom"));
    expect(status).toBe(500);
    expect(body).toEqual({ error: "INTERNAL", message: "خطأ داخلي", messageEn: "Internal error.", requestId: expect.any(String) });
  });
});

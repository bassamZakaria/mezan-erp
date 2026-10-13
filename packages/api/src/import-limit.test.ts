import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { IMPORT_ROW_LIMIT, importLimitNotice, importTooLargeMessage, linesOfCsvImport as sharedLinesOfCsv } from "@mezan/contracts";
import { importRowLimit, linesOfCsvImport } from "./import-limit.js";

function rig() {
  const app = new Hono();
  let ran = 0;
  const done = (c: { json: (body: unknown) => Response }) => {
    ran += 1;
    return c.json({ ok: true });
  };
  app.post("/rows", importRowLimit(), done);
  app.post("/csv", importRowLimit(linesOfCsvImport), done);
  app.get("/rows", importRowLimit(), done);
  const post = (path: string, body: unknown) =>
    app.fetch(new Request(`http://x${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { app, post, ran: () => ran };
}

const csvOf = (lines: number) => ["badge,date,time", ...Array.from({ length: lines - 1 }, (_, i) => `B${i},2026-08-22,08:00`)].join("\n");

describe("importRowLimit", () => {
  it("lets a file at the limit through and refuses one row more, in Arabic, before the handler runs", async () => {
    const t = rig();

    const atTheLimit = await t.post("/rows", { rows: Array.from({ length: IMPORT_ROW_LIMIT }, () => ({})) });
    const over = await t.post("/rows", { rows: Array.from({ length: IMPORT_ROW_LIMIT + 1 }, () => ({})) });

    expect(atTheLimit.status).toBe(200);
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({
      error: "IMPORT_TOO_LARGE", rows: IMPORT_ROW_LIMIT + 1, limit: IMPORT_ROW_LIMIT, message: expect.stringContaining("قسّم الملف"),
    });
    expect(t.ran()).toBe(1);
  });

  it("counts the lines of a device file, blank ones aside", async () => {
    const t = rig();

    const atTheLimit = await t.post("/csv", { csv: `${csvOf(IMPORT_ROW_LIMIT)}\n\n` });
    const over = await t.post("/csv", { csv: csvOf(IMPORT_ROW_LIMIT + 1) });

    expect([atTheLimit.status, over.status]).toEqual([200, 413]);
  });

  it("leaves a body it cannot count, and a read, alone", async () => {
    const t = rig();

    expect((await t.post("/rows", { rows: "not a list" })).status).toBe(200);
    expect((await t.app.fetch(new Request("http://x/rows"))).status).toBe(200);
  });

  it("refuses in the very sentence a client shows before it uploads, so the two can never drift apart", async () => {
    const t = rig();
    const over = (await (await t.post("/rows", { rows: Array.from({ length: IMPORT_ROW_LIMIT + 1 }, () => ({})) })).json()) as { message: string; messageEn: string };

    expect(over.message).toBe(importTooLargeMessage(IMPORT_ROW_LIMIT + 1).ar);
    expect(over.messageEn).toBe(importTooLargeMessage(IMPORT_ROW_LIMIT + 1).en);
    expect(over.message).toContain(String(IMPORT_ROW_LIMIT));
    expect(importLimitNotice().ar).toContain(String(IMPORT_ROW_LIMIT));
    expect(importLimitNotice().ar).toContain("قسّم");
    expect(importLimitNotice(7).ar).toContain("7");
  });

  it("counts a CSV's lines on the client exactly as the server does", () => {
    expect(sharedLinesOfCsv(`${csvOf(12)}\n\n  \n`)).toBe(12);
    expect(sharedLinesOfCsv("")).toBe(0);
  });
});

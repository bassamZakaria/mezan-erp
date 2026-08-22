import { Hono } from "hono";
import { z } from "zod";
import {
  Money,
  postJournalEntry,
  UnbalancedEntryError,
  InvalidJournalEntryError,
  type JournalEntry,
  type UnitOfWork,
} from "@mezan/domain";

const lineSchema = z.object({
  accountId: z.string().min(1),
  // Money crosses the wire as an exact decimal string, never a float.
  debit: z.string(),
  credit: z.string(),
});

const createEntrySchema = z.object({
  id: z.string().min(1),
  date: z.string().min(1),
  memo: z.string(),
  lines: z.array(lineSchema).min(2),
});

/** Wire representation of an entry — money as decimal strings, byte-stable. */
function serialize(entry: JournalEntry) {
  return {
    id: entry.id,
    date: entry.date,
    memo: entry.memo,
    status: entry.status,
    lines: entry.lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit.toString(),
      credit: l.credit.toString(),
    })),
  };
}

/**
 * The ONE Hono app. A Hono app is a `(Request) => Promise<Response>` function,
 * so this exact instance is mounted two ways with no code difference:
 *   - over HTTP by apps/server (cloud shape), and
 *   - in-process via `app.fetch(new Request(...))` by apps/desktop-spike
 *     (Electron main-process shape).
 * Routes carry no business logic — they validate, call the domain, serialize.
 */
export function createApp(uow: UnitOfWork) {
  const app = new Hono();

  app.post("/journal-entries", async (c) => {
    const parsed = createEntrySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json(
        { error: "VALIDATION_ERROR", details: parsed.error.flatten() },
        400,
      );
    }

    try {
      const entry = await postJournalEntry(
        {
          id: parsed.data.id,
          date: parsed.data.date,
          memo: parsed.data.memo,
          lines: parsed.data.lines.map((l) => ({
            accountId: l.accountId,
            debit: Money.fromMajor(l.debit),
            credit: Money.fromMajor(l.credit),
          })),
        },
        uow,
      );
      return c.json(serialize(entry), 201);
    } catch (err) {
      if (err instanceof UnbalancedEntryError) {
        return c.json(
          {
            error: err.code,
            message: err.message,
            totalDebit: err.totalDebit.toString(),
            totalCredit: err.totalCredit.toString(),
          },
          422,
        );
      }
      if (err instanceof InvalidJournalEntryError) {
        return c.json({ error: err.code, message: err.message }, 400);
      }
      throw err;
    }
  });

  app.get("/journal-entries/:id", async (c) => {
    const entry = await uow.journal.findById(c.req.param("id"));
    if (!entry) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(entry));
  });

  return app;
}

export type App = ReturnType<typeof createApp>;

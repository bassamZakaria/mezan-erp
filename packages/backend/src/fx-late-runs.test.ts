import { afterEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO } from "./test-helpers/seeded-world.js";
import { FX_CONTROL, FX_INVOICE_ID, FxSide, major, openFxBooks, type FxBooks } from "./test-helpers/fx-books.js";

enum Step {
  AugustRun = "the August run",
  SeptemberRun = "the September run",
  Collection = "USD 400 dated 2 October",
}

const SCALE = 1_000_000n;
const SIDES = [FxSide.Receivable, FxSide.Payable] as const;
const CHRONOLOGICAL = [Step.AugustRun, Step.SeptemberRun, Step.Collection] as const;

let books: FxBooks;

afterEach(() => books?.world.close());

const mirrored = (side: FxSide, scaled: bigint) => major(side === FxSide.Receivable ? scaled : -scaled);

async function pay(side: FxSide, base: string, date: string, invoiceId = FX_INVOICE_ID[side]): Promise<void> {
  await books.ok("POST", `${side === FxSide.Receivable ? "/sales-invoices" : "/purchases/invoices"}/${invoiceId}/payments`, { amount: base, treasuryAccountId: "ta-cash", date }, 200);
}

function shareRows(): { item: string; amount: string }[] {
  const rows = books.world.sqlite.prepare("SELECT item_id, amount FROM fx_revaluation_share ORDER BY rowid").safeIntegers().all() as { item_id: string; amount: bigint }[];
  return rows.map((row) => ({ item: row.item_id, amount: major(row.amount) }));
}

async function residueRows(): Promise<unknown[]> {
  return ((await books.world.request("GET", "/revaluation/residue")).body.rows as unknown[]) ?? [];
}

async function take(side: FxSide, step: Step): Promise<void> {
  if (step === Step.AugustRun) await books.ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false });
  if (step === Step.SeptemberRun) await books.ok("POST", "/revaluation/post", { date: "2026-09-30", currencies: ["USD"], autoReverse: false });
  if (step === Step.Collection) await pay(side, "19720", "2026-10-02");
}

async function opened(side: FxSide): Promise<void> {
  books = await openFxBooks();
  await books.invoice(side);
  await books.rate("fx-aug", "48.45", "2026-08-31");
  await books.rate("fx-sep", "48.95", "2026-09-30");
  await books.rate("fx-oct", "49.30", "2026-10-02");
}

describe("a run posted after a settlement gives up its own share of it, whatever else the item already carries", () => {
  const orders = SIDES.flatMap((side) =>
    [CHRONOLOGICAL, [Step.AugustRun, Step.Collection, Step.SeptemberRun], [Step.Collection, Step.AugustRun, Step.SeptemberRun]].map((steps) => ({ side, steps, order: steps.join(", then ") })),
  );

  it.each(orders)("$side, $order: the USD 600 left is carried at 29,370.00 and the collection realised 140", async ({ side, steps }) => {
    await opened(side);

    for (const step of steps) await take(side, step);

    expect(books.fx(side)).toEqual({ control: mirrored(side, 29_370n * SCALE), unrealised: mirrored(side, 950n * SCALE), realised: mirrored(side, 140n * SCALE) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);

    await pay(side, "29580", "2026-10-02");

    expect(books.fx(side)).toEqual({ control: major(0n), unrealised: mirrored(side, 950n * SCALE), realised: mirrored(side, 350n * SCALE) });
    expect(await residueRows()).toEqual([]);
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: a settlement dated before the run is not released again — the run restates only what was still open", async (side) => {
    await opened(side);
    await books.rate("fx-settle", "48.70", "2026-09-10");
    await pay(side, "19480", "2026-09-10");

    await take(side, Step.SeptemberRun);

    expect(shareRows()).toEqual([{ item: FX_INVOICE_ID[side], amount: major(570n * SCALE) }]);
    expect(books.fx(side)).toEqual({ control: mirrored(side, 29_370n * SCALE), unrealised: mirrored(side, 570n * SCALE), realised: mirrored(side, 280n * SCALE) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("a run posted after an invoice was relieved of more than it had left restates what was open on its own day", () => {
  it.each(SIDES)("%s: USD 500 settled and six of ten units returned on 10 September, then the August run — both invoices take 450", async (side) => {
    books = await openFxBooks();
    await books.invoice(side);
    await books.invoice(side, "inv-b");
    await books.rate("fx-settle", "48.70", "2026-09-10");
    await pay(side, "24350", "2026-09-10");
    await books.returnUnits(side, "ret-6", "6");

    await books.revalue("48.45");

    const byItem = (a: { item: string; amount: string }, b: { item: string; amount: string }) => `${a.item} ${a.amount}`.localeCompare(`${b.item} ${b.amount}`);
    expect(shareRows().sort(byItem)).toEqual(
      [
        { item: FX_INVOICE_ID[side], amount: major(450n * SCALE) },
        { item: "inv-b", amount: major(450n * SCALE) },
        { item: FX_INVOICE_ID[side], amount: major(-225n * SCALE) },
        { item: FX_INVOICE_ID[side], amount: major(-225n * SCALE) },
      ].sort(byItem),
    );
    expect(major(books.world.balance(FX_CONTROL[side]))).toBe(mirrored(side, 43_650n * SCALE));
    expect(books.fx(side)).toMatchObject({ unrealised: mirrored(side, 900n * SCALE), realised: mirrored(side, -100n * SCALE) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});

describe("runs that do not reverse themselves come off latest first, and nothing is slipped in under one that stands", () => {
  async function runNumber(entryId: string): Promise<string> {
    const runs = (await books.world.request("GET", "/revaluation/runs")).body.runs as { entryId: string; entryNo: string }[];
    return String(runs.find((run) => run.entryId === entryId)?.entryNo);
  }

  async function expectHeldBy(refused: { status: number; body: Record<string, unknown> }, laterRunNo: string): Promise<void> {
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 FX_REVALUATION_LATER_RUN_STANDS");
    expect(String(refused.body.message)).toContain(laterRunNo);
    expect(String(refused.body.message)).toMatch(/[؀-ۿ]/);
    expect(refused.body.laterRun).toBe(laterRunNo);
  }

  it.each(SIDES)("%s: reversing August while September stands is refused in Arabic naming September; September first, then August, leaves the booked 48,000", async (side) => {
    await opened(side);
    const august = String((await books.ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false })).entryId);
    const september = String((await books.ok("POST", "/revaluation/post", { date: "2026-09-30", currencies: ["USD"], autoReverse: false })).entryId);
    const held = books.fx(side);
    const entries = books.world.count("journal_entry");

    const refused = await books.world.request("POST", `/revaluation/runs/${august}/reverse`, { memo: "سبب العكس", date: "2026-10-01" });

    await expectHeldBy(refused, await runNumber(september));
    expect(books.fx(side)).toEqual(held);
    expect(held.control).toBe(mirrored(side, 48_950n * SCALE));
    expect(books.world.count("journal_entry")).toBe(entries);

    await books.ok("POST", `/revaluation/runs/${september}/reverse`, { memo: "سبب العكس", date: "2026-10-01" });
    await books.ok("POST", `/revaluation/runs/${august}/reverse`, { memo: "سبب العكس", date: "2026-10-01" });
    expect(books.fx(side)).toEqual({ control: mirrored(side, 48_000n * SCALE), unrealised: major(0n), realised: major(0n) });
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: a self-reversing August run under a standing September run is accepted — it is gone again on 1 September and September's figures do not move", async (side) => {
    await opened(side);
    await take(side, Step.SeptemberRun);
    const held = books.fx(side);

    await books.ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: true });

    expect(books.fx(side)).toEqual(held);
    expect(major(books.world.balance(FX_CONTROL[side], "2026-08-31"))).toBe(mirrored(side, 48_450n * SCALE));
    expect(major(books.world.balance(FX_CONTROL[side], "2026-09-01"))).toBe(mirrored(side, 48_000n * SCALE));
    expect(await books.world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it.each(SIDES)("%s: a self-reversing run dated the day before a standing run is refused, because its reversal would land on that run's own day", async (side) => {
    await opened(side);
    const september = String((await books.ok("POST", "/revaluation/post", { date: "2026-09-30", currencies: ["USD"], autoReverse: false })).entryId);
    const held = books.fx(side);
    const entries = books.world.count("journal_entry");

    const refused = await books.world.request("POST", "/revaluation/post", { date: "2026-09-29", currencies: ["USD"], autoReverse: true });

    await expectHeldBy(refused, await runNumber(september));
    expect(books.fx(side)).toEqual(held);
    expect(books.world.count("journal_entry")).toBe(entries);
  });
});

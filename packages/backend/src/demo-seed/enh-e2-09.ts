import type { App } from "@mezan/api";
import type { SeedFragment } from "./fragments.js";
import { step } from "./shared.js";

const PROMISE_DAYS_AHEAD = 10;

interface WorklistRow {
  readonly customerId: string;
  readonly overdue: string;
  readonly pendingPromise: unknown;
  readonly items: readonly { readonly documentId: string | null }[];
}

interface Worklist {
  readonly asOfDate: string;
  readonly rows: readonly WorklistRow[];
}

function dayAfter(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

async function run(app: App): Promise<void> {
  const worklist = (await step(app, "GET", "/collections/worklist")) as Worklist;
  const withPromise = worklist.rows.find((row) => row.pendingPromise === null && row.items.some((item) => item.documentId !== null));
  const withNote = worklist.rows.find((row) => row.customerId !== withPromise?.customerId);
  if (withNote) {
    await step(app, "POST", `/collections/customers/${encodeURIComponent(withNote.customerId)}/notes`, {
      kind: "call",
      text: "تم الاتصال بالعميل، وأفاد بأن السداد سيتم بعد صرف مستحقاته من جهة أخرى.",
    });
  }
  if (withPromise) {
    await step(app, "POST", "/collections/promises", {
      customerId: withPromise.customerId,
      promisedDate: dayAfter(worklist.asOfDate, PROMISE_DAYS_AHEAD),
      amount: withPromise.overdue,
      note: "وعد شفهي من مسؤول الحسابات بالسداد بتحويل بنكي.",
    });
  }
  await step(app, "POST", "/collections/dunning-run", {});
}

export const seed: SeedFragment = {
  roleGrants: {
    FINANCE_MANAGER: ["sales.collections.view", "sales.collections.edit", "sales.collections.run", "sales.collections.send", "sales.collections.manage"],
    ACCOUNTANT: ["sales.collections.view", "sales.collections.edit", "sales.collections.run", "sales.collections.send"],
    BRANCH_MANAGER: ["sales.collections.view", "sales.collections.edit"],
    SALES_REP: ["sales.collections.view"],
    AUDITOR: ["sales.collections.view"],
  },
  run,
};

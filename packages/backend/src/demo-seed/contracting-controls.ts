import type { App } from "@mezan/api";
import { CORE, SeedPerson, seedActorHeaders, seededUserId, step } from "./shared.js";

/**
 * تقارير الاستثناءات الستة، الإفراج عن المحتجزات وتقويم المحتجزات — slice 5B
 * of المقاولات (design §06), seeded through the real routes.
 *
 * The profile exists to make the CONTROLS demonstrable, so four of the six
 * reports find something and two find nothing — and the two that find nothing
 * are the two slice 2 already refuses, which is the point of running them.
 */

const TOWER_CONTRACT = "CTR-DEMO-1";
const FITOUT_CONTRACT = "CTR-DEMO-3";

const RETENTION_VIEW = "contracting.certificate.view";
const RETENTION_RELEASE = "contracting.retention.release";

/**
 * Three DIFFERENT identities, because the release enforces creator ≠ releaser
 * on the userId and an early release needs a second approver who is neither.
 * Seeding all three from one admin would leave the rule untested in the one
 * place a person can see it.
 */
function retentionActor(person: SeedPerson): Record<string, string> {
  return seedActorHeaders(seededUserId(person), [RETENTION_VIEW, RETENTION_RELEASE], null);
}

async function stepAs(
  app: App,
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await app.fetch(
    new Request(`http://demo-seed${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    throw new Error(`[demo-seed] ${method} ${path} failed with ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? undefined : await res.json();
}

interface BoqLineRow {
  id: string;
  code: string;
}

async function boqLineIds(app: App, contractId: string): Promise<Map<string, string>> {
  const res = (await step(app, "GET", `/contracting/contracts/${contractId}/boq`)) as { lines: BoqLineRow[] };
  return new Map(res.lines.map((l) => [l.code, l.id]));
}

export async function seedContractingControls(app: App): Promise<void> {
  // The single non-stock line every generated release invoice names.
  await step(app, "POST", "/items", {
    id: "SRV-CONTRACTING-RETENTION",
    code: "SRV-RET-01",
    nameAr: "إفراج عن محتجزات ضمانية",
    nameEn: "Retention released",
    type: "service",
    baseUnitCode: "PCS",
    taxRatePercent: 0,
    trackInventory: false,
    salePrice: "0",
    costPrice: "0",
    revenueAccountId: "1150",
    cogsAccountId: "5100",
    inventoryAccountId: "1200",
  });

  // --- التسليم الابتدائي والنهائي: recorded when they happen, not at signature ---
  await step(app, "POST", `/contracting/retention/contracts/${TOWER_CONTRACT}/handover`, {
    provisionalHandoverDate: "2027-03-31",
  });
  // A COMPLETED contract still has to be able to record its handover — the
  // event the retention calendar hangs on happens after the work is finished.
  await step(app, "POST", `/contracting/retention/contracts/${FITOUT_CONTRACT}/handover`, {
    provisionalHandoverDate: "2026-09-15",
  });

  // --- الكمية النظرية: 7 شيكارة أسمنت لكل م٣ خرسانة عادية ---
  const boq = await boqLineIds(app, TOWER_CONTRACT);
  const plainConcrete = boq.get("2");
  if (plainConcrete) {
    await step(app, "PUT", `/contracting/reports/theoretical-quantities/${TOWER_CONTRACT}`, {
      lines: [{ boqLineId: plainConcrete, theoreticalQtyPerUnit: "7", theoreticalItemId: CORE.items[0] }],
    });
  }

  /**
   * أمر تغيير معتمد قبل التنفيذ — seeded so «أوامر تغيير معتمدة بعد التنفيذ» is
   * exercised and still finds nothing: approved 2026-08-20, against a
   * certificate executed 2026-08-31. There is no path left that produces a late
   * one, because slice 2 refuses a certificate whose quantity depends on a
   * variation approved after its execution date — which is exactly what the
   * report exists to prove.
   */
  const reinforcedConcrete = boq.get("3");
  if (reinforcedConcrete) {
    await step(app, "POST", "/contracting/variation-orders", {
      id: "VO-DEMO-4",
      contractId: TOWER_CONTRACT,
      date: "2026-08-12",
      titleAr: "زيادة كميات الخرسانة المسلحة",
      reason: "زيادة سماكة اللبشة بعد مراجعة التصميم الإنشائي.",
      requestedBy: "consultant",
      lines: [{ kind: "change", boqLineId: reinforcedConcrete, qtyDelta: "200" }],
    });
    await step(app, "POST", "/contracting/variation-orders/VO-DEMO-4/approve", { approvedAt: "2026-08-20" });
  }

  /**
   * إفراج مبكر عن المحتجزات. The design's own example is a release on the
   * finished fit-out, but no certificate ever withheld retention on that
   * project, so releasing there would be refused — correctly. It is seeded
   * against برج الأمل instead, where 53,269.90 really is held: dated
   * 2026-09-01 against a provisional handover of 2027-03-31, it is early,
   * flagged, and lands in report 6.
   */
  await stepAs(app, retentionActor(SeedPerson.ContractingFinance), "POST", "/contracting/retention/releases", {
    id: "RET-DEMO-1",
    contractId: TOWER_CONTRACT,
    kind: "provisional",
    date: "2026-09-01",
    amount: "5000.00",
    notes: "إفراج جزئي مبكر بموافقة الإدارة المالية — قبل التسليم الابتدائي.",
  });
  await stepAs(
    app,
    retentionActor(SeedPerson.TreasuryCashier),
    "POST",
    "/contracting/retention/releases/RET-DEMO-1/release",
    { approvedBy: seededUserId(SeedPerson.FinanceManager) },
  );
}

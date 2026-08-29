import type { Ctx } from "./harness.js";

/**
 * الفاتورة الإلكترونية (ETA) — the registration surfaces and the producer that
 * feeds the submission queue.
 *
 * The queue's producer was D5: `EtaService.enqueue` had no caller, so a tenant
 * could configure e-invoicing fully, confirm invoices all day and submit none.
 * `seams.ts` x29 guards the switch ON. This file guards the other half — that
 * the switch is genuinely READ, so turning it off stops the queue — plus the
 * readiness meter and the three mapping surfaces the meter counts.
 *
 * Ids are prefixed `SCN-E-`. It restores auto-submit ON before it finishes, so
 * the suites that run after it see the tenant the seed built.
 */

const BRANCH = "BR-MAIN";
const WH = "WH-MAIN";
const AR = "1105";
const OUTPUT_TAX = "2200";
const REVENUE = "4100";
const CUSTOMER = "CUST-DEMO-1";
const TODAY = "2026-08-24";
const VAT = 14;

export async function run(ctx: Ctx): Promise<void> {
  const { req, n, check, scenario, rows } = ctx;

  async function serviceInvoice(id: string, unitPrice: string) {
    const created = await req("POST", "/sales-invoices", {
      id,
      date: TODAY,
      dueDate: "2026-09-23",
      customerId: CUSTOMER,
      customerNameAr: "عميل",
      warehouseId: WH,
      branchId: BRANCH,
      arAccountId: AR,
      taxAccountId: OUTPUT_TAX,
      lines: [
        {
          lineId: `${id}-L1`,
          itemId: "ITEM-DEMO-1",
          itemNameAr: "خدمة اختبار",
          isStock: false,
          qty: "1",
          unitPrice,
          taxRatePercent: VAT,
          revenueAccountId: REVENUE,
        },
      ],
    });
    const confirmed = await req("POST", `/sales-invoices/${id}/confirm`, {});
    return { created, confirmed };
  }

  const readinessOf = async () => (await req("GET", "/eta/config")).body?.readiness;
  const itemOf = (readiness: any, key: string) => readiness?.items?.find((i: any) => i.key === key);

  // ---------------------------------------------------------------------------
  // e1 — the readiness meter counts what is still unregistered
  // ---------------------------------------------------------------------------
  await scenario("e1 · the readiness meter names every prerequisite and counts the records still missing a code", async () => {
    const readiness = await readinessOf();
    const keys = (readiness?.items ?? []).map((i: any) => i.key);
    for (const key of ["taxRegistrationNumber", "activityCode", "address", "branchCodes", "itemCodes", "unitMappings", "taxSubTypes"]) {
      check(`the checklist carries ${key}`, keys.includes(key), keys.join(","));
    }
    const items = itemOf(readiness, "itemCodes");
    const mappings = await req("GET", "/eta/item-mappings?unmapped=1");
    check(
      "the unmapped-items count on the meter equals the unmapped filter's own count",
      n(items?.missing) === n(mappings.body?.total),
      `meter ${items?.missing} vs filter ${mappings.body?.total}`,
    );
    check("a complete prerequisite reports zero missing", itemOf(readiness, "taxRegistrationNumber")?.missing === 0, JSON.stringify(itemOf(readiness, "taxRegistrationNumber")));
    check("the percentage is the share of complete prerequisites", n(readiness?.percent) === Math.round((readiness.items.filter((i: any) => i.complete).length / readiness.items.length) * 100), String(readiness?.percent));
  });

  // ---------------------------------------------------------------------------
  // e2 — item mapping
  // ---------------------------------------------------------------------------
  await scenario("e2 · mapping an item's authority code removes it from the unmapped filter and from the readiness count", async () => {
    const before = await req("GET", "/eta/item-mappings?unmapped=1");
    const target = rows(before.body)[0];
    check("the seeded tenant has at least one unmapped item to register", !!target, JSON.stringify(before.body).slice(0, 200));
    if (!target) return;

    const saved = await req("PUT", `/eta/item-mappings/${target.itemId}`, {
      etaCodeType: "EGS",
      etaItemCode: "EG-SCN-E-0001",
      gpcCode: "10000001",
    });
    check("the mapping saves", saved.status === 200, JSON.stringify(saved.body).slice(0, 200));
    check("and comes back with the registered code", saved.body?.etaItemCode === "EG-SCN-E-0001", JSON.stringify(saved.body).slice(0, 200));

    const after = await req("GET", "/eta/item-mappings?unmapped=1");
    check(
      "the unmapped filter is one row shorter",
      n(after.body?.total) === n(before.body?.total) - 1,
      `${before.body?.total} → ${after.body?.total}`,
    );
    check(
      "and the readiness meter agrees",
      n(itemOf(await readinessOf(), "itemCodes")?.missing) === n(after.body?.total),
      `meter ${itemOf(await readinessOf(), "itemCodes")?.missing} vs filter ${after.body?.total}`,
    );

    const search = await req("GET", `/eta/item-mappings?q=${encodeURIComponent(target.code)}`);
    check("searching by item code finds it", rows(search.body).some((r: any) => r.itemId === target.itemId), JSON.stringify(search.body).slice(0, 200));

    const missing = await req("PUT", "/eta/item-mappings/NOT-AN-ITEM", { etaItemCode: "X" });
    check("an unknown item is refused rather than invented", missing.status === 404, `status ${missing.status}`);
  });

  // ---------------------------------------------------------------------------
  // e3 — unit mapping and its suggestions
  // ---------------------------------------------------------------------------
  await scenario("e3 · apply-suggestions maps every unit the authority's list recognises and names the ones it cannot", async () => {
    const before = rows((await req("GET", "/eta/unit-mappings")).body);
    check("the tenant's units are listed", before.length > 0, JSON.stringify(before).slice(0, 200));
    const suggestible = before.filter((u: any) => u.etaUnitCode === null && u.suggestion !== null).length;

    const applied = await req("POST", "/eta/unit-mappings/apply-suggestions", {});
    check("the action succeeds", applied.status === 200, JSON.stringify(applied.body).slice(0, 200));
    check(
      "it maps exactly the units that had a suggestion",
      rows(applied.body?.applied).length === suggestible,
      `applied ${rows(applied.body?.applied).length} vs suggestible ${suggestible}`,
    );

    const after = rows((await req("GET", "/eta/unit-mappings")).body);
    const stillUnmapped = after.filter((u: any) => u.etaUnitCode === null);
    check(
      "every unit left unmapped is one with no suggestion, and it is reported by name",
      stillUnmapped.every((u: any) => u.suggestion === null && (applied.body?.unresolved ?? []).includes(u.unitCode)),
      JSON.stringify({ stillUnmapped: stillUnmapped.map((u: any) => u.unitCode), unresolved: applied.body?.unresolved }),
    );
    const pcs = after.find((u: any) => u.unitCode === "PCS");
    check("قطعة is mapped to the authority's EA", pcs?.etaUnitCode === "EA", JSON.stringify(pcs));

    const bogus = await req("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "NOT-A-CODE" });
    check("a code the authority does not publish is refused", bogus.status === 400, `status ${bogus.status}`);
    const remapped = await req("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "BX" });
    check("and a real one is accepted", remapped.status === 200 && remapped.body?.etaUnitCode === "BX", JSON.stringify(remapped.body).slice(0, 200));
    await req("PUT", "/eta/unit-mappings/PCS", { etaUnitCode: "EA" });
  });

  // ---------------------------------------------------------------------------
  // e4 — branch codes
  // ---------------------------------------------------------------------------
  await scenario("e4 · a branch's code with the authority is stored against the branch and closes its readiness chip", async () => {
    const listed = rows((await req("GET", "/eta/branch-codes")).body);
    check("every active branch is listed for registration", listed.length > 0, JSON.stringify(listed).slice(0, 200));

    const saved = await req("PUT", `/eta/branch-codes/${BRANCH}`, { etaBranchCode: "7" });
    check("the code saves", saved.status === 200 && saved.body?.etaBranchCode === "7", JSON.stringify(saved.body).slice(0, 200));
    const reread = rows((await req("GET", "/eta/branch-codes")).body).find((b: any) => b.branchId === BRANCH);
    check("and survives a re-read", reread?.etaBranchCode === "7", JSON.stringify(reread));
    const unregistered = rows((await req("GET", "/eta/branch-codes")).body).filter((b: any) => b.etaBranchCode === null).length;
    check(
      "the readiness chip counts exactly the branches still without a code",
      n(itemOf(await readinessOf(), "branchCodes")?.missing) === unregistered,
      `meter ${itemOf(await readinessOf(), "branchCodes")?.missing} vs unregistered ${unregistered}`,
    );

    const missing = await req("PUT", "/eta/branch-codes/NOT-A-BRANCH", { etaBranchCode: "9" });
    check("an unknown branch is refused", missing.status === 404, `status ${missing.status}`);
    await req("PUT", `/eta/branch-codes/${BRANCH}`, { etaBranchCode: "1" });
  });

  // ---------------------------------------------------------------------------
  // e5 — credentials never come back, and the connection test says what it knows
  // ---------------------------------------------------------------------------
  await scenario("e5 · the client secret is stored and never returned, and the connection test reports honestly", async () => {
    const saved = await req("PUT", "/eta/config", { clientId: "SCN-E-CLIENT", clientSecret: "scn-e-secret-value" });
    check("the credentials save", saved.status === 200, JSON.stringify(saved.body).slice(0, 200));
    const body = JSON.stringify((await req("GET", "/eta/config")).body);
    check("the secret is never in the response", !body.includes("scn-e-secret-value"), body.slice(0, 200));
    check("only the fact that one is on file is", JSON.parse(body).config?.hasClientSecret === true, body.slice(0, 200));

    const test = await req("POST", "/eta/test-connection", {});
    check(
      "with credentials on file the test reports the transmit leg is offline, not a fake success",
      test.status === 200 && test.body?.ok === false && test.body?.reason === "offline",
      JSON.stringify(test.body),
    );
  });

  // ---------------------------------------------------------------------------
  // e6 — the auto-submit switch is genuinely read (the other half of D5)
  // ---------------------------------------------------------------------------
  await scenario("e6 · turning الإرسال التلقائي off stops the queue, and turning it back on resumes it", async () => {
    const off = await req("PUT", "/eta/config", { autoSubmitOnConfirm: false });
    check("the switch turns off", off.status === 200 && off.body?.config?.autoSubmitOnConfirm === false, JSON.stringify(off.body?.config).slice(0, 200));

    const before = rows((await req("GET", "/eta/submissions")).body).length;
    const quiet = await serviceInvoice("SCN-E-INV-OFF", "500");
    check("a real invoice is confirmed with the switch off", quiet.confirmed.status === 200, JSON.stringify(quiet.confirmed.body).slice(0, 200));
    const afterOff = rows((await req("GET", "/eta/submissions")).body).length;
    check(
      "and the queue does NOT grow — the setting is read, not merely stored (docs/archive/defect-register.md F33 / D5)",
      afterOff === before,
      `before=${before} after=${afterOff}`,
    );

    await req("PUT", "/eta/config", { autoSubmitOnConfirm: true });
    const loud = await serviceInvoice("SCN-E-INV-ON", "500");
    check("a second invoice is confirmed with the switch on", loud.confirmed.status === 200, JSON.stringify(loud.confirmed.body).slice(0, 200));
    const afterOn = rows((await req("GET", "/eta/submissions")).body).length;
    check(
      "and that one does reach the queue",
      afterOn === afterOff + 1,
      `before=${afterOff} after=${afterOn}`,
    );

    const queued = rows((await req("GET", "/eta/submissions")).body).find((s: any) => s.internalId === "SCN-E-INV-ON" || s.internalId?.startsWith("INV-"));
    check("the queued document is جاهز, awaiting submission", queued?.status === "ready", JSON.stringify(queued));
  });
}

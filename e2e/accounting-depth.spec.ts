import { test, expect, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { clickSidebarItem } from "./support/nav";

/**
 * Accounting-depth screens (apps/web/src/screens/{CostCenterPnL,
 * ExchangeRates,FxRevaluation,Reconciliation,Eta}Screen.tsx). These no
 * longer run over a self-contained sandbox store (the old
 * `apps/web/src/store/accounting-depth-store.ts` this spec used to describe
 * no longer exists in the codebase) — every one of them is now wired to the
 * REAL shared backend, same as the rest of the app. The demo seed
 * (MEZAN_SEED_DEMO=1) is NOT the empty tenant the old fixture assumed:
 *   - Exchange Rates gets full real CRUD coverage (add/approve/filter) since
 *     that needs no other fixture — unaffected by the seed either way.
 *   - Cost Center P&L's default month-to-date window carries a real,
 *     un-tagged posting ("غير مخصص" — no cost centre — packages/backend/src/
 *     demo-seed/treasury.ts dates several documents relative to whenever the
 *     seed actually runs, via `today()`/`addDays()`, so this always falls in
 *     the current month).
 *   - FX Revaluation genuinely has no OPEN foreign-currency exposure at
 *     month-end even with a USD supplier seeded (confirmed against
 *     `POST /revaluation/preview`) — its empty result is real, but the
 *     empty-state copy itself moved (`fx.noOpenForeignCurrencyBalances` /
 *     `fx.emptyBody`, not the "لا توجد أرصدة مفتوحة." string, which now
 *     labels a DIFFERENT, always-visible "open balances by party" table
 *     further down the same screen).
 *   - Balance Reconciliation's control accounts all still tie to the GL
 *     (`allMatched: true`), but the seed's sales/purchase-return and
 *     landed-cost postings (fixed, non-relative dates in demo-seed/
 *     platform.ts and demo-seed/purchasing.ts) post straight to a control
 *     account without a sub-ledger reference, so "القيود غير المرتبطة" is a
 *     real, stable 11 — not the 0 a fresh tenant would show.
 *   - ETA e-Invoicing is now a setup/configuration screen (a readiness
 *     meter over "عام"/"بيانات الربط"/"ربط الأصناف"/"ربط الوحدات"/
 *     "الإرسالات" tabs). The demo seed already fills in tax registration,
 *     activity code, address, branch codes and API credentials (67%
 *     ready) — the readiness-raising test below maps the seeded item UNITS
 *     instead, which the seed deliberately leaves incomplete.
 */

function row(page: Page, text: string, exact = true) {
  return page.locator("table tbody tr").filter({ has: page.getByText(text, { exact }) });
}

test.describe("Cost Center P&L", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أرباح مراكز التكلفة");
    await expect(page.getByRole("heading", { name: "أرباح مراكز التكلفة" })).toBeVisible();
  });

  test("shows the seeded month-to-date postings, including the un-tagged بلا مركز تكلفة row", async ({ page }) => {
    await expect(page.getByText("إجمالي الإيرادات")).toBeVisible();
    // The demo seed dates several documents relative to whenever it runs, so
    // an un-tagged posting always lands in the current month-to-date window
    // — not the empty tenant the old fixture assumed.
    await expect(page.getByText("لا توجد حركات في هذه الفترة")).toHaveCount(0);
    await expect(row(page, "غير مخصص")).toBeVisible();
  });
});

test.describe("Exchange Rates", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "أسعار الصرف");
    await expect(page.getByRole("heading", { name: "أسعار الصرف" })).toBeVisible();
  });

  test("adding a rate appears as pending, then approving it moves it to the معتمد filter", async ({ page }) => {
    await page.getByRole("button", { name: "إضافة سعر صرف" }).first().click();
    await page.getByRole("combobox", { name: "العملة الأجنبية" }).click();
    await page.getByRole("option", { name: /GBP/ }).click();
    await page.getByLabel("سعر الصرف").fill("65.1234");
    await page.getByLabel("تاريخ السريان").fill("2026-08-01");
    await page.getByRole("button", { name: "حفظ", exact: true }).click();

    const gbpRow = row(page, "GBP / EGP");
    await expect(gbpRow).toBeVisible();
    await expect(gbpRow.getByText("بانتظار الاعتماد")).toBeVisible();

    // "اعتماد" is behind the row's actions menu, not a direct row button.
    await gbpRow.getByRole("button", { name: "إجراءات GBP" }).click();
    await page.getByRole("menuitem", { name: "اعتماد" }).click();
    await expect(row(page, "GBP / EGP").getByText("معتمد", { exact: true })).toBeVisible();
    // RowMenu (packages/ui/src/primitives/RowMenu.tsx) renders nothing when
    // its item list is empty rather than a menu with no items — once
    // approved, ExchangeRatesScreen's rowAction offers no more actions, so
    // the trigger button itself disappears rather than opening an empty menu.
    await expect(row(page, "GBP / EGP").getByRole("button", { name: "إجراءات GBP" })).toHaveCount(0);

    // The status filter is a radiogroup of Chips, not DocumentList's tabs.
    await page.getByRole("radio", { name: "معتمد", exact: true }).click();
    await expect(row(page, "GBP / EGP")).toBeVisible();

    await page.getByRole("radio", { name: "بانتظار الاعتماد" }).click();
    await expect(row(page, "GBP / EGP")).toHaveCount(0);
  });
});

test.describe("FX Revaluation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "إعادة تقييم العملات الأجنبية");
    await expect(page.getByRole("heading", { name: "إعادة تقييم العملات الأجنبية" })).toBeVisible();
  });

  test("previewing with no foreign-currency exposure shows a genuine empty result, not a crash", async ({ page }) => {
    await expect(page.getByText('اضغط "معاينة" لعرض الأرصدة المفتوحة وحساب فروق العملة.')).toBeVisible();

    await page.getByRole("button", { name: "معاينة" }).click();

    // "لا توجد أرصدة مفتوحة." now labels a DIFFERENT, always-visible "open
    // balances by party" table further down the screen — the preview
    // RESULT's own empty state is this EmptyState title/description pair.
    await expect(page.getByText("لا توجد أرصدة عملات أجنبية مفتوحة")).toBeVisible();
    await expect(
      page.getByText("لا توجد أرصدة بعملة أجنبية مفتوحة في هذا التاريخ — إعادة التقييم تحتاج رصيداً قائماً بعملة غير العملة الأساسية."),
    ).toBeVisible();
  });
});

test.describe("Balance Reconciliation", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "مطابقة الأرصدة");
    await expect(page.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeVisible();
  });

  test("shows every control account matched, and the seed's own unlinked postings", async ({ page }) => {
    await expect(page.getByText("جميع الأرصدة متطابقة")).toBeVisible();

    for (const label of [
      "تقييم المخزون مقابل دفتر الأستاذ",
      "ذمم العملاء مقابل دفتر الأستاذ",
      "ذمم الموردين مقابل دفتر الأستاذ",
    ]) {
      await expect(row(page, label).getByText("متطابق", { exact: true })).toBeVisible();
    }

    // Every control account still ties to the GL, but the seed's own
    // sales/purchase-return and landed-cost postings (fixed 2026-08 dates —
    // demo-seed/platform.ts, demo-seed/purchasing.ts) post straight to a
    // control account with no sub-ledger reference: a real, stable 11 lines
    // across 6 entries (SRET-DEMO-1/2, PRET-DEMO-1, SRT-DEMO-1, PRT-DEMO-1,
    // LC-DEMO-1) — not the 0 a fresh tenant would show.
    await expect(page.getByText("القيود غير المرتبطة (11)")).toBeVisible();
  });
});

test.describe("ETA e-Invoicing setup", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDemoUser(page);
    await clickSidebarItem(page, "الفاتورة الإلكترونية");
    await expect(page.getByRole("heading", { name: "الفاتورة الإلكترونية" })).toBeVisible();
  });

  test("shows the readiness meter and the four setup tabs, starting well under 100% ready", async ({ page }) => {
    await expect(page.getByText(/الجاهزية: \d+%/)).toBeVisible();
    const readinessText = await page.getByText(/الجاهزية: \d+%/).innerText();
    const readiness = Number(readinessText.match(/(\d+)%/)?.[1] ?? "100");
    // A fresh tenant hasn't filled in tax registration, branch codes, unit
    // mappings, etc. yet — readiness is real, not decorative.
    expect(readiness).toBeLessThan(100);

    const tablist = page.getByRole("tablist");
    for (const tab of ["عام", "بيانات الربط", "ربط الأصناف", "ربط الوحدات", "الإرسالات"]) {
      await expect(tablist.getByRole("tab", { name: tab })).toBeVisible();
    }
  });

  test("mapping the seeded item units raises the readiness percentage", async ({ page }) => {
    // The demo seed already fills tax registration, activity code, address,
    // branch codes and API credentials (67% ready — 6 of 9 items), so
    // filling "رقم التسجيل الضريبي *" again changes nothing: it's already
    // `complete: true` (GET /eta/config). "ربط الوحدات" (unit mapping) is one
    // of the 3 items the seed deliberately leaves incomplete (8 of 8 seeded
    // units unmapped), so it's what this test drives to completion instead.
    const before = Number((await page.getByText(/الجاهزية: \d+%/).innerText()).match(/(\d+)%/)?.[1] ?? "0");

    const tablist = page.getByRole("tablist");
    await tablist.getByRole("tab", { name: "ربط الوحدات" }).click();

    // "تطبيق الاقتراحات" maps every unit it has a confident suggestion for in
    // one call — 7 of the 8 seeded units (packages/backend/src/seed.ts's
    // SEED_ITEM_UNITS), leaving only "خدمة" (Service, code SVC) unresolved.
    const applied = page.waitForResponse((r) => r.url().includes("/eta/unit-mappings/apply-suggestions"));
    await page.getByRole("button", { name: "تطبيق الاقتراحات" }).click();
    await applied;
    await expect(page.getByText(/الاقتراحات المُطبَّقة: 7/)).toBeVisible();

    // Map the one unit with no suggestion by hand — "يوم" (Day) is a
    // reasonable authority code for a service unit — so "ربط الوحدات"
    // reaches 0 missing and flips to complete.
    const svcRow = page.locator("table tbody tr").filter({ has: page.getByText("خدمة", { exact: true }) });
    await svcRow.getByRole("combobox", { name: /كود الوحدة لدى المصلحة/ }).click();
    await page.getByRole("option", { name: /^DAY —/ }).click();
    const svcSaved = page.waitForResponse((r) => r.url().includes("/eta/unit-mappings/SVC") && r.request().method() === "PUT");
    await svcRow.getByRole("button", { name: "حفظ", exact: true }).click();
    await svcSaved;

    // The readiness query refetches asynchronously after the mutation
    // settles — poll for the percentage to actually change rather than
    // reading it the instant the save response lands.
    await expect(page.getByText(/الجاهزية: \d+%/)).not.toHaveText(`الجاهزية: ${before}%`);
    const after = Number((await page.getByText(/الجاهزية: \d+%/).innerText()).match(/(\d+)%/)?.[1] ?? "0");
    expect(after).toBeGreaterThan(before);

    // Persists across a reload — it's real tenant config, not local draft state.
    await page.reload();
    await expect(page.getByText(/الجاهزية: \d+%/)).toHaveText(`الجاهزية: ${after}%`);
  });
});

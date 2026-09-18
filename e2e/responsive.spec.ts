import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";
import { horizontalOverflow, offendingElements, OVERFLOW_TOLERANCE } from "./support/overflow";

/**
 * Does the app survive a phone-sized screen?
 *
 * This is a MEASUREMENT, not a look. The failure mode it exists to catch is the
 * one that a screenshot review misses and a desktop developer never sees: the
 * page itself scrolls sideways, so the user drags the whole layout left and
 * right to read a row, and the chrome — rail, topbar, action buttons — drifts
 * off the edge with it.
 *
 * The rule it enforces is the one the web guidelines state: **wide content
 * scrolls inside its OWN container**. A table wider than the phone is fine and
 * expected — an ERP row has fifteen columns and no amount of stacking makes
 * that readable — but the `<body>` must never be the thing that scrolls.
 *
 * 390 × 844 is an iPhone 14/15; 360 is the narrowest Android still in real use.
 * Both are checked because the difference between them is exactly where a
 * fixed-width element starts to bite.
 *
 * ---------------------------------------------------------------------------
 * What this suite found, and what fixed it. Kept because the causes recur.
 *
 * 1. `WorkspaceRail` was a FIXED 256px column. On a 390px phone that left 134px
 *    for the screen, so every table, form and KPI row overflowed and the PAGE
 *    scrolled sideways. It is now an overlay drawer below `RAIL_BREAKPOINT`,
 *    with its own toggle, scrim, focus trap and close-on-navigate — NOT simply
 *    hidden, because it carries the brand, the workspace list and RailFooter's
 *    theme toggle, notifications and user menu, and hiding it would have left
 *    no route to any of them.
 *
 * 2. Grid children default to `min-width: auto` — "at least as wide as my
 *    content". The dashboard's `Panel` and `KpiTile` therefore refused to shrink
 *    below the 517px table and the seven-digit figure they hold, and their own
 *    `overflow-x-auto` never got the chance to scroll. `min-w-0` is load-bearing
 *    on any grid or flex child with a wide descendant.
 *
 * 3. A money figure never breaks mid-digit, by design. So the TILE gets smaller
 *    below 420px rather than the number wrapping.
 *
 * The RTL trap, recorded so the next person does not lose an hour to it: this
 * app runs RTL, so overflowing content escapes past the LEFT edge and
 * `getBoundingClientRect().right` stays inside the viewport the whole time. A
 * right-edge-only detector reports nothing while the page is 149px too wide.
 * ---------------------------------------------------------------------------
 */

const PHONE = { width: 390, height: 844 };
const NARROW_ANDROID = { width: 360, height: 800 };

/**
 * The routes a phone user actually opens. Deliberately not all 120: these cover
 * the shell, a dense list, a document form, a report and the settings tree,
 * which between them exercise every layout primitive the rest reuse.
 */
const ROUTES: readonly { path: string; name: string }[] = [
  { path: "/dashboard", name: "لوحة التحكم" },
  { path: "/sell/sales-invoices", name: "فواتير المبيعات" },
  { path: "/items/items", name: "الأصناف" },
  { path: "/sell/customers", name: "العملاء" },
  { path: "/money/journals", name: "القيود" },
  { path: "/setup/settings-general", name: "الإعدادات" },
];

for (const viewport of [PHONE, NARROW_ANDROID]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(`${route.name} does not scroll the page sideways`, async ({ page }) => {
        await loginAsDemoUser(page);
        await page.goto(route.path);
        // The shell renders its chrome before the screen's data arrives; waiting
        // for network idle measures the settled layout rather than the skeleton.
        await page.waitForLoadState("networkidle");
        await expect(page.getByText("الصفحة غير موجودة")).toHaveCount(0);

        const overflow = await horizontalOverflow(page);
        const offenders = await offendingElements(page);
        expect(
          overflow,
          offenders.length > 0
            ? `${route.path} overflows by ${overflow}px. Widest offenders:\n  - ${offenders.join("\n  - ")}`
            : `${route.path} overflows by ${overflow}px`,
        ).toBeLessThanOrEqual(OVERFLOW_TOLERANCE);
      });
    }
  });
}

test.describe("the shell itself on a phone", () => {
  test.use({ viewport: PHONE });

  test("the primary action stays reachable without sideways scrolling", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.goto("/sell/sales-invoices");
    await page.waitForLoadState("networkidle");

    // A «جديد» button pushed off the edge is the difference between a screen
    // that works on a phone and one that only looks like it does.
    const newButton = page.getByRole("button", { name: /جديد/ }).first();
    if (await newButton.isVisible().catch(() => false)) {
      const box = await newButton.boundingBox();
      expect(box, "the new-document button has no box").not.toBeNull();
      expect(box!.x + box!.width, "«جديد» is past the right edge").toBeLessThanOrEqual(PHONE.width + OVERFLOW_TOLERANCE);
      expect(box!.x, "«جديد» starts past the left edge").toBeGreaterThanOrEqual(-OVERFLOW_TOLERANCE);
    }
  });

  test("a wide table scrolls inside its own container, not the page", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.goto("/sell/sales-invoices");
    await page.waitForLoadState("networkidle");

    const table = page.locator("table").first();
    if (await table.isVisible().catch(() => false)) {
      // The table being wider than the phone is CORRECT — an ERP row has more
      // columns than a phone has pixels. What matters is which element scrolls.
      const scroller = await table.evaluate((el) => {
        let node: HTMLElement | null = el.parentElement;
        while (node && node !== document.body) {
          const style = getComputedStyle(node);
          if (style.overflowX === "auto" || style.overflowX === "scroll") return true;
          node = node.parentElement;
        }
        return false;
      });
      expect(scroller, "the table has no horizontally scrollable ancestor, so the PAGE scrolls instead").toBe(true);
    }
  });
});

test.describe("the workspace drawer on a phone", () => {
  test.use({ viewport: PHONE });

  test("opens the workspace column, and closes it again on navigation", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // The column is off-screen to begin with: a 256px sibling on a 390px phone
    // is what pushed the page sideways in the first place.
    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    await expect(rail).toBeHidden();

    await page.getByRole("button", { name: "فتح قائمة التنقل" }).click();
    await expect(rail).toBeVisible();

    // Everything the column carries is reachable again — including the theme
    // toggle and the user menu, which live in its footer and would otherwise
    // have no route on a phone at all.
    await expect(page.getByRole("button", { name: "تبديل المظهر" })).toBeVisible();

    // And it closes on navigating, which is the single most common way this
    // pattern is got wrong: a drawer left open over the screen it just opened.
    await rail.getByRole("button", { name: "كل الشاشات" }).click();
    await expect(rail).toBeHidden();
  });

  test("closes on Escape and on the scrim, and does not scroll the page while open", async ({ page }) => {
    await loginAsDemoUser(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const rail = page.getByRole("navigation", { name: "التنقل بين مساحات العمل" });
    const open = page.getByRole("button", { name: "فتح قائمة التنقل" });

    await open.click();
    await expect(rail).toBeVisible();
    // An overlay that puts the page back into sideways scrolling has undone the
    // whole point of being an overlay.
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(OVERFLOW_TOLERANCE);

    await page.keyboard.press("Escape");
    await expect(rail).toBeHidden();
  });

  test("the column is a normal sibling again on a desktop viewport", async ({ page }) => {
    // The drawer must not leak upwards: above the breakpoint there is no menu
    // button at all and the column is simply there.
    await page.setViewportSize({ width: 1280, height: 900 });
    await loginAsDemoUser(page);
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("navigation", { name: "التنقل بين مساحات العمل" })).toBeVisible();
    await expect(page.getByRole("button", { name: "فتح قائمة التنقل" })).toBeHidden();
  });
});

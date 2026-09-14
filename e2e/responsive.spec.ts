import { expect, test, type Page } from "@playwright/test";
import { loginAsDemoUser } from "./support/auth";

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
 * THESE ROUTE CHECKS CURRENTLY FAIL, ON PURPOSE. They are the measurement of an
 * OPEN defect, not a regression guard over a fixed one, and they are kept out
 * of the default `pnpm test:e2e` config for exactly that reason — run them with
 * `pnpm test:responsive`.
 *
 * What they found, and it is one cause rather than six:
 *
 *   `WorkspaceRail` is a FIXED 256px column (`metrics.ts` → `RAIL_WIDTH`). On a
 *   390px phone that leaves 134px for the screen itself, so every table, form
 *   and KPI row is wider than its container and the PAGE scrolls sideways —
 *   the user drags the whole layout left and right to read one row, and the
 *   chrome goes with it.
 *
 * The fix is NOT to hide the rail: it holds the brand, the workspace list AND
 * `RailFooter` (theme toggle, notifications, user menu), so hiding it removes
 * the only route to all of them. It has to become an overlay drawer below a
 * breakpoint, with a toggle that is visible only at that size, a scrim, focus
 * handling and close-on-navigate. That is real UI work and is deliberately not
 * smuggled into a test file.
 *
 * The RTL trap that cost an hour, recorded so the next person does not repeat
 * it: this app runs RTL, so overflowing content escapes past the LEFT edge and
 * `getBoundingClientRect().right` stays inside the viewport the whole time. A
 * detector that checks the right edge reports nothing while the page is 149px
 * too wide.
 * ---------------------------------------------------------------------------
 */

const PHONE = { width: 390, height: 844 };
const NARROW_ANDROID = { width: 360, height: 800 };

/** A few pixels of slack: sub-pixel rounding on a scaled layout is not a defect. */
const OVERFLOW_TOLERANCE = 2;

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

/**
 * Every element sticking out past the viewport's right edge, named well enough
 * to fix — a bare "the page is 40px too wide" sends the next person hunting.
 */
async function offendingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const hits: { label: string; past: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const past = Math.round(rect.right - limit);
      if (past <= 2) continue;
      // An element inside a container that scrolls horizontally is NOT an
      // offender — that is the pattern we want. Only report something whose
      // overflow reaches the page.
      let scrolls = false;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") {
          scrolls = true;
          break;
        }
      }
      if (scrolls) continue;
      const id = el.id ? `#${el.id}` : "";
      const cls =
        typeof el.className === "string"
          ? `.${el.className.split(/\s+/).filter(Boolean).slice(0, 4).join(".")}`
          : "";
      hits.push({ label: `${el.tagName.toLowerCase()}${id}${cls}`, past });
    }
    return hits
      .sort((a, b) => b.past - a.past)
      .slice(0, 6)
      .map((h) => `${h.label} → ${h.past}px past the edge`);
  });
}

/**
 * The routes a phone user actually opens. Deliberately not all 120: these cover
 * the shell, a dense list, a document form, a report and the settings tree,
 * which between them exercise every layout primitive the rest reuse.
 */
const ROUTES: readonly { path: string; name: string }[] = [
  { path: "/dashboard", name: "لوحة التحكم" },
  { path: "/sales/invoices", name: "فواتير المبيعات" },
  { path: "/inventory/items", name: "الأصناف" },
  { path: "/sales/customers", name: "العملاء" },
  { path: "/accounting/journal", name: "القيود" },
  { path: "/settings/general", name: "الإعدادات" },
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
    await page.goto("/sales/invoices");
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
    await page.goto("/sales/invoices");
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

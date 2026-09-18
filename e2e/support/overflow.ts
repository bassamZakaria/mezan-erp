import type { Page } from "@playwright/test";

/** A few pixels of slack: sub-pixel rounding on a scaled layout is not a defect. */
export const OVERFLOW_TOLERANCE = 2;

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

/**
 * Every element sticking out past the viewport's right edge, named well enough
 * to fix — a bare "the page is 40px too wide" sends the next person hunting.
 */
export async function offendingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const hits: { el: HTMLElement; label: string; past: number }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // BOTH edges. The app runs RTL, so overflowing content escapes past the
      // LEFT edge and `rect.right` stays inside the viewport the whole time — a
      // right-edge-only detector reports nothing while the page is 149px wide.
      const past = Math.round(Math.max(rect.right - limit, -rect.left));
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
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      hits.push({ el, label: `${el.tagName.toLowerCase()}${id}${cls}${text ? ` «${text}»` : ""}`, past });
    }
    // Innermost offenders only: every ancestor of a wide element is "wide" too,
    // and naming #root six times says nothing about which child to fix.
    return hits
      .filter((h) => !hits.some((other) => other !== h && h.el.contains(other.el)))
      .sort((a, b) => b.past - a.past)
      .slice(0, 6)
      .map((h) => `${h.label} → ${h.past}px past the edge`);
  });
}

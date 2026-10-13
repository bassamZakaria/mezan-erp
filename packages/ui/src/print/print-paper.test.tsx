// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "../shell/AppShell";
import type { NavGroup, ShellUser } from "../shell/types";
import { PrintView } from "./PrintView";
import { DEFAULT_PRINT_TEMPLATE_CONFIG } from "./types";
import { createSampleInvoiceDocument } from "./sample-invoice";

const here = dirname(fileURLToPath(import.meta.url));
const printRules = (): string => {
  const css = readFileSync(resolve(here, "../tokens/print.css"), "utf8");
  const start = css.indexOf("@media print");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start).replace(/\s+/g, " ");
};

const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };
const groups: NavGroup[] = [
  { key: "sell", label: "البيع والتحصيل", items: [{ key: "sales-hub", label: "لوحة المبيعات" }], sections: [{ key: "daily", label: "الشغل اليومي", items: [{ key: "quotes", label: "عروض الأسعار" }] }] },
];

describe("paper carries the document, never the app around it", () => {
  it("the stylesheet removes everything marked screen-only and lets the shell's boxes flow onto the page", () => {
    const rules = printRules();
    expect(rules).toContain(".mz-screen-only { display: none !important; }");
    expect(rules).toMatch(/\.mz-print-flow \{[^}]*display: block !important;[^}]*min-height: 0 !important;[^}]*padding: 0 !important;[^}]*overflow: visible !important;/);
  });

  it("the printed page takes the paper's own width and height instead of a fixed sheet inside the margins", () => {
    const rules = printRules();
    expect(rules).toMatch(/\.mz-print-page \{[^}]*width: auto !important;[^}]*min-height: 0 !important;[^}]*padding: 0 !important;[^}]*overflow: visible !important;/);
    expect(rules).toMatch(/\.mz-print-page table \{[^}]*width: 100% !important;/);
    expect(rules).toMatch(/\.mz-print-keep \{[^}]*break-inside: avoid;/);
  });

  it("the stylesheet is part of the one entry every edition imports", () => {
    expect(readFileSync(resolve(here, "../tokens/styles.css"), "utf8")).toContain('@import "./print.css";');
  });

  it("every piece of the shell's chrome is screen-only, and the boxes around the screen flow", () => {
    const { container } = render(
      <AppShell user={user} workspaceGroups={groups} activeWorkspaceKey="sell" activeNavKey="quotes">
        <div data-testid="screen">محتوى الصفحة</div>
      </AppShell>,
    );
    const main = screen.getByRole("main");
    for (const landmark of screen.getAllByRole("navigation")) expect(landmark.closest(".mz-screen-only")).not.toBeNull();
    expect(container.querySelector(`a[href="#${main.id}"]`)).toHaveClass("mz-screen-only");
    expect(main).toHaveClass("mz-print-flow");
    for (let box = main.parentElement; box && box !== container; box = box.parentElement) expect(box).toHaveClass("mz-print-flow");
    const chrome = [...container.querySelectorAll("button, a")].filter((control) => !main.contains(control));
    expect(chrome.length).toBeGreaterThan(3);
    for (const control of chrome) expect(control.closest(".mz-screen-only")).not.toBeNull();
  });

  it("the document's totals and its QR block are kept whole rather than split across sheets", () => {
    const doc = { ...createSampleInvoiceDocument(), etaUuid: "ETA-UUID-1", etaQrValue: "https://example.invalid/receipts/ETA-UUID-1" };
    const { container } = render(<PrintView config={DEFAULT_PRINT_TEMPLATE_CONFIG} document={doc} />);
    expect(container.querySelector(".mz-print-root .mz-print-page")).not.toBeNull();
    const qr = container.querySelector<SVGElement>('svg[role="img"]');
    expect(qr?.closest(".mz-print-keep")).not.toBeNull();
    expect([qr?.style.width, qr?.style.height]).toEqual(["26mm", "26mm"]);
    expect(qr?.getAttribute("class")).not.toMatch(/\b[hw]-full\b/);
    expect(screen.getByText("1,159.95").closest(".mz-print-keep")).not.toBeNull();
  });
});

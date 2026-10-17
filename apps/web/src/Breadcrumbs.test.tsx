// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { Breadcrumbs, NAMED_SUB_PAGE_SEGMENTS } from "./Breadcrumbs";
import { SubPageNamesProvider, useNameSubPage } from "./navigation";
import { renderWithProviders, testAdminSession, TestNavigation } from "./data/test-support";

describe("Breadcrumbs — the last crumb names where you are", () => {
  it("a bank statement being reconciled is named as that, not by the statement's internal id", () => {
    renderWithProviders(
      <TestNavigation initialSegments={["3f0c7b1a-52de-4a8e-9d1b-7a6f0c2e4b19"]}>
        <Breadcrumbs screen="bank-reconciliation" />
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.getByText("تسوية كشف بنك")).toBeInTheDocument();
    expect(screen.queryByText(/3f0c7b1a/)).not.toBeInTheDocument();
  });

  it("a document addressed by its number still shows that number", () => {
    renderWithProviders(
      <TestNavigation initialSegments={["PI-000004"]}>
        <Breadcrumbs screen="purchase-invoices" />
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.getByText("PI-000004")).toBeInTheDocument();
  });

  function Named({ segment, label }: { segment: string; label: string | null }) {
    useNameSubPage(segment, label);
    return null;
  }

  it("a voucher addressed by its internal id is named by the number its screen gives it, and never by the id", () => {
    renderWithProviders(
      <TestNavigation initialSegments={["3f0c7b1a-52de-4a8e-9d1b-7a6f0c2e4b19"]}>
        <SubPageNamesProvider>
          <Breadcrumbs screen="treasury-vouchers" />
          <Named segment="3f0c7b1a-52de-4a8e-9d1b-7a6f0c2e4b19" label="CV-000012" />
        </SubPageNamesProvider>
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.getByText("CV-000012")).toBeInTheDocument();
    expect(screen.queryByText(/3f0c7b1a/)).not.toBeInTheDocument();
  });

  it("until its screen has named it, an id-addressed page shows no id at all", () => {
    renderWithProviders(
      <TestNavigation initialSegments={["3f0c7b1a-52de-4a8e-9d1b-7a6f0c2e4b19"]}>
        <SubPageNamesProvider>
          <Breadcrumbs screen="treasury-vouchers" />
        </SubPageNamesProvider>
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.queryByText(/3f0c7b1a/)).not.toBeInTheDocument();
  });

  it.each(["sales-returns", "purchase-returns", "landed-costs"] as const)("a reversing document of «%s», addressed by its internal id, never shows that id", (screenKey) => {
    renderWithProviders(
      <TestNavigation initialSegments={["SRT-DEMO-1:void"]}>
        <SubPageNamesProvider>
          <Breadcrumbs screen={screenKey} />
        </SubPageNamesProvider>
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    expect(screen.queryByText(/:void/)).not.toBeInTheDocument();
  });

  it.each(["due", "history", "depreciation"])("the recurring journals tab «%s» is named in Arabic, not by its URL segment", (segment) => {
    renderWithProviders(
      <TestNavigation initialSegments={[segment]}>
        <Breadcrumbs screen="recurring-journals" />
      </TestNavigation>,
      { initialSession: testAdminSession },
    );
    const current = screen.getByText((_text, element) => element?.getAttribute("aria-current") === "page");
    expect(current.textContent).toMatch(/[\u0600-\u06FF]/);
    expect(current.textContent).not.toBe(segment);
  });
});

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry) ? [path] : [];
  });
}

function enumSourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return enumSourcesUnder(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe("no screen can put an internal id or a raw URL segment in the breadcrumb", () => {
  const SCREENS_DIR = join(process.cwd(), "apps/web/src/screens");
  const NAMED_BY_THE_SCREEN_ITSELF = ["BankReconciliationScreen.tsx"];
  const sources = sourcesUnder(SCREENS_DIR).map((path) => ({ path: path.slice(SCREENS_DIR.length + 1), text: readFileSync(path, "utf8") }));
  const ENUM_MEMBER_VALUES = new Map<string, string>(
    enumSourcesUnder(SCREENS_DIR).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/export enum (\w+) \{([^}]*)\}/g)].flatMap((decl) =>
        [...(decl[2] as string).matchAll(/(\w+)\s*=\s*"([^"]+)"/g)].map((member) => [`${decl[1] ?? ""}.${member[1] ?? ""}`, member[2] ?? ""] as [string, string]),
      ),
    ),
  );

  it("every tab a screen addresses in the URL has an Arabic name in the breadcrumb's table", () => {
    const unnamed: string[] = [];
    for (const { path, text } of sources) {
      if (!text.includes("<ScreenTabs")) continue;
      const keys = [...text.matchAll(/key:\s*(?:"([a-z-]+)"|([A-Z]\w*\.\w+)),\s*label:\s*t\([^)]*\),\s*render:/g)].map(
        (match) => (match[1] ?? ENUM_MEMBER_VALUES.get(match[2] as string) ?? (match[2] as string)) as string,
      );
      expect(keys.length, path).toBeGreaterThan(1);
      for (const key of keys.slice(1)) if (!NAMED_SUB_PAGE_SEGMENTS.has(key)) unnamed.push(`${path} → ${key}`);
    }
    expect(unnamed).toEqual([]);
  });

  it("every screen that opens a sub-page by an internal id names it for the breadcrumb", () => {
    const opensById = /subPage\.open\(\s*(?:[A-Za-z]+\??\.)*(?:id|selectedId)\s*[,)]|=>\s*\(?id\s*\?\s*subPage\.open\(id\)/;
    const offenders = sources.filter(({ text }) => opensById.test(text) && !text.includes("useNameSubPage(")).map(({ path }) => path);
    const named = sources.filter(({ text }) => text.includes("useNameSubPage(")).map(({ path }) => path);
    expect(offenders.filter((path) => !NAMED_BY_THE_SCREEN_ITSELF.includes(path))).toEqual([]);
    expect(named.length).toBeGreaterThanOrEqual(5);
  });
});

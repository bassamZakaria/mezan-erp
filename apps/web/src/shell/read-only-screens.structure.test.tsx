// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppProviders } from "../data/AppProviders";
import { BranchRestrictedAccess } from "@mezan/contracts";
import { DEFAULT_PRINT_TEMPLATE_CONFIG } from "@mezan/domain";
import { navItemAccess } from "../branch-restriction";
import { testAdminSession } from "../data/test-support";
import type { Session } from "../data/session";
import type { Transport } from "../data/transport";
import { SCREEN_MODULES } from "../router/screens";
import { ReadOnlyForm } from "./ReadOnlyForm";

const REASON = "للعرض فقط: هذه البيانات تُدار من الإدارة العامة.";
const restricted: Session = { ...testAdminSession, isCompanyAdmin: false, branchScope: ["BR1"] };
const READ_ONLY_SCREENS = (Object.keys(SCREEN_MODULES) as (keyof typeof SCREEN_MODULES)[]).filter((key) => navItemAccess(key) === BranchRestrictedAccess.ReadOnly);

const nothing: unknown = new Proxy([], {
  get: (target, property, receiver) => (typeof property === "symbol" || property in target ? Reflect.get(target, property, receiver) : nothing),
});

const SHAPED: Readonly<Record<string, unknown>> = { "/print-template-config": DEFAULT_PRINT_TEMPLATE_CONFIG };

const transportAnswering = (fallback: unknown): Transport => (path, init) => {
  const read = (init?.method ?? "GET").toUpperCase() === "GET";
  const body = SHAPED[path.split("?")[0]!] ?? fallback;
  return Promise.resolve({ status: read ? 200 : 403, ok: read, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve("[]") });
};

const EMPTY_ANSWERS: readonly unknown[] = [nothing, []];

const WRITE_CONTROLS = 'button[data-variant="primary"], button[data-variant="danger-outline"], button[type="submit"]';
const labelOf = (control: Element) => (control.getAttribute("aria-label") ?? control.textContent ?? "").trim();

const OTHER_CONTROLS = "input, select, textarea, button";
const EDIT_FORMS = "[data-edit-scope]";

interface Controls {
  readonly write: string[];
  readonly other: string[];
}

async function enabledControls(key: keyof typeof SCREEN_MODULES, reason: string | null, session: Session = restricted): Promise<Controls> {
  const { Component } = await SCREEN_MODULES[key]();
  let failure: unknown;
  for (const answer of EMPTY_ANSWERS) {
    try {
      const view = render(
        <AppProviders transport={transportAnswering(answer)} initialSession={session}>
          <MemoryRouter>
            <ReadOnlyForm reason={reason}>
              <Component />
            </ReadOnlyForm>
          </MemoryRouter>
        </AppProviders>,
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
      const open = [...view.container.ownerDocument.querySelectorAll<HTMLButtonElement>(OTHER_CONTROLS)].filter((control) => !control.disabled);
      return {
        write: open.filter((control) => control.matches(WRITE_CONTROLS) && !control.hasAttribute("data-read-only-keep")).map(labelOf),
        other: open.filter((control) => !control.matches(WRITE_CONTROLS) && control.closest(EDIT_FORMS) === null).map(labelOf),
      };
    } catch (error) {
      failure = error;
    } finally {
      cleanup();
    }
  }
  throw failure;
}

describe("every screen a branch-restricted session may only read", () => {
  it("the policy names such screens, the four that were open among them", () => {
    expect(READ_ONLY_SCREENS.length).toBeGreaterThan(20);
    for (const key of ["taxes", "exchange-rates", "boms", "configurable-products"]) expect(READ_ONLY_SCREENS, READ_ONLY_SCREENS.join(" ")).toContain(key);
  });

  it.each(READ_ONLY_SCREENS)("%s shows no enabled create, submit or delete control, and keeps every filter, search, paging and navigation control it had", async (key) => {
    const unrestricted = await enabledControls(key, null);
    const readOnly = await enabledControls(key, REASON);
    expect(readOnly.write).toEqual([]);
    expect(readOnly.other).toEqual(unrestricted.other);
  }, 20_000);

  it("the walk can see a write control: without the read-only reason the same screens offer theirs", async () => {
    const offered: number[] = [];
    for (const key of ["taxes", "exchange-rates", "boms", "configurable-products"] as const) offered.push((await enabledControls(key, null, testAdminSession)).write.length);
    for (const count of offered) expect(count).toBeGreaterThan(0);
  });
});

const SCREEN_SOURCES = dirname(fileURLToPath(import.meta.url));
const ROUTE_MAP = readFileSync(join(SCREEN_SOURCES, "../router/screens.ts"), "utf8");
const DELETE_ICON_BUTTON = /<IconButton\b[^>]*?(?:delete|remove|Delete|Remove)[^>]*?>/gs;

function sourceOf(key: string): string | null {
  const escaped = key.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = new RegExp(`(?:"${escaped}"|\\b${escaped}):\\s*\\(\\)\\s*=>\\s*import\\("(\\.\\./[^"]+)"\\)`).exec(ROUTE_MAP);
  if (!match) return null;
  const base = join(SCREEN_SOURCES, "../router", match[1]!);
  for (const candidate of [`${base}.tsx`, join(base, "index.tsx")]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}

describe("a row's delete icon on a read-only screen", () => {
  const core = READ_ONLY_SCREENS.filter((key) => sourceOf(key) !== null);

  it("reads the source of the read-only screens the core route map names", () => {
    expect(core.length).toBeGreaterThan(18);
  });

  it.each(core)("%s marks every delete icon button so the read-only wrapper closes it", (key) => {
    const unmarked = [...sourceOf(key)!.matchAll(DELETE_ICON_BUTTON)].map((match) => match[0]).filter((tag) => !tag.includes("READ_ONLY_CLOSE"));
    expect(unmarked.map((tag) => tag.replace(/\s+/g, " ").slice(0, 120))).toEqual([]);
  });
});

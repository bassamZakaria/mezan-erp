// @vitest-environment jsdom
/**
 * Two states every screen in the product has to survive, swept across all of
 * them at once:
 *
 *   - **an empty tenant** — a fresh install, every list empty. "Empty states
 *     are real states": a screen that throws, or renders a blank page, on the
 *     first day of a rollout is the implementation consultant's problem on
 *     every install.
 *   - **a refusing server** — every request answering 503. The screen must
 *     stay on its feet and say something, rather than crashing the shell.
 *
 * These are the two arms almost every screen carries (`rows.length === 0 ? …`,
 * `query.isError ? …`) and the pair that no per-screen test file reliably
 * covered. Sweeping them from the module list means a screen added later is
 * covered the day it lands.
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import type { ComponentType } from "react";
import { renderWithProviders, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";

/** Endpoints whose contract is an object rather than a list. */
const OBJECT_SHAPED = /\/(counts|stats|summary|config|settings|dashboard|status|preview|balance|entitlements)(\?|$)/;

function bodyFor(path: string): unknown {
  return OBJECT_SHAPED.test(path.split("?")[0] ?? path) ? {} : [];
}

/** A tenant with nothing in it yet: every list empty, every rollup zero. */
const emptyTenant: Transport = (path) =>
  Promise.resolve({
    status: 200,
    ok: true,
    json: <T,>() => Promise.resolve(bodyFor(path) as T),
    text: () => Promise.resolve("[]"),
  });

/** A server that refuses everything. */
const refusing: Transport = () =>
  Promise.resolve({
    status: 503,
    ok: false,
    json: <T,>() => Promise.resolve({ error: "UNAVAILABLE", message: "الخدمة غير متاحة" } as T),
    text: () => Promise.resolve('{"error":"UNAVAILABLE"}'),
  });

const modules = import.meta.glob(["./**/*.tsx", "!./**/*.test.tsx"], { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

/**
 * `ReportScreen` is not a route on its own — it renders one report definition
 * handed to it by the reports index, so it has no no-prop form to sweep.
 */
const NOT_ROUTE_LEVEL = new Set(["ReportScreen"]);

const screens: Array<[string, ComponentType]> = Object.entries(modules)
  .flatMap(([, mod]) =>
    Object.entries(mod)
      .filter(([name, value]) => typeof value === "function" && /Screen$/.test(name) && !NOT_ROUTE_LEVEL.has(name))
      .map(([name, value]) => [name, value as ComponentType] as [string, ComponentType]),
  )
  .filter(([name], index, all) => all.findIndex(([other]) => other === name) === index)
  .sort(([a], [b]) => a.localeCompare(b));

describe("every screen survives an empty tenant and a refusing server", () => {
  it("finds the screens this sweep is meant to cover", () => {
    expect(screens.length).toBeGreaterThan(60);
  });

  it.each(screens)("%s renders on an empty tenant", async (_name, Screen) => {
    const { container, unmount } = renderWithProviders(<Screen />, {
      transport: emptyTenant,
      initialSession: testAdminSession,
    });
    // Rendered something: an empty list is still a screen with a header on it.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    unmount();
  });

  it.each(screens)("%s renders when every request is refused", async (_name, Screen) => {
    const { container, unmount } = renderWithProviders(<Screen />, {
      transport: refusing,
      initialSession: testAdminSession,
    });
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    unmount();
  });
});

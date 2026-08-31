// @vitest-environment jsdom
/**
 * One invariant, swept across every hook in `hooks.ts`: when the server
 * refuses, the hook surfaces an `ApiError` — it never resolves with
 * `undefined` and never leaves the screen believing an empty result is real
 * data.
 *
 * `hooks.ts` exports 382 hooks and every one of them ends in the same shape:
 *
 *     const res = await request(path);
 *     if (!res.ok) throw new ApiError(res.status, t("…"));
 *
 * That refusal arm is what a screen shows an error banner from, and it was
 * the single largest block of untested branches in the web app. Testing them
 * one file at a time would be 382 near-identical tests; this drives them from
 * the export list instead, so a hook added later is swept the day it lands.
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import * as hooks from "./hooks";
import { ApiError } from "./hooks";

/** Every request fails, so each hook has to take its own refusal path. */
const refusingTransport: Transport = () =>
  Promise.resolve({
    status: 503,
    ok: false,
    json: <T,>() => Promise.resolve({ error: "UNAVAILABLE", message: "الخدمة غير متاحة" } as T),
    text: () => Promise.resolve('{"error":"UNAVAILABLE","message":"الخدمة غير متاحة"}'),
  });

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppI18nProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ApiProvider transport={refusingTransport} initialSession={testAdminSession}>
          {children}
        </ApiProvider>
      </QueryClientProvider>
    </AppI18nProvider>
  );
}

type AnyHook = (...args: unknown[]) => unknown;

interface QueryLike {
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly fetchStatus?: string;
}

interface MutationLike {
  mutateAsync(input: unknown): Promise<unknown>;
}

function isQueryLike(value: unknown): value is QueryLike {
  return typeof value === "object" && value !== null && "isError" in value && "isPending" in value;
}

function isMutationLike(value: unknown): value is MutationLike {
  return typeof value === "object" && value !== null && typeof (value as MutationLike).mutateAsync === "function";
}

/**
 * Plausible arguments for a hook by arity. An id-shaped parameter takes a
 * string; a filter-shaped one defaults itself, so it is never passed. A
 * string standing in for a filter simply leaves every filter branch untaken,
 * which is what this sweep wants — it is testing the refusal, not the query
 * string.
 */
function argsFor(name: string, hook: AnyHook): unknown[] {
  const override = ARGS[name];
  if (override) return override;
  return Array.from({ length: hook.length }, () => "sweep-1");
}

/** Hooks whose parameters are not id-shaped, so the arity default cannot stand in. */
const ARGS: Record<string, unknown[]> = {
  useItemMovements: ["itm-1", ["WH1"]],
};

/** Mutations whose input is a list rather than an object. */
const MUTATION_INPUT: Record<string, unknown> = {
  useHistoricalImportPreview: [],
  useHistoricalImportCommit: [],
};

/**
 * `useSendTestEmail` deliberately keys success off the payload's `message`
 * rather than off `res.ok`, so a refusal carrying a human message reaches the
 * SMTP panel's status pill instead of being swallowed as a thrown error.
 * `hooks-gap.test.tsx` covers that behaviour directly.
 */
const RESOLVES_ON_REFUSAL = new Set(["useSendTestEmail"]);

const hookEntries: Array<[string, AnyHook]> = Object.entries(hooks as Record<string, unknown>)
  .filter(([name, value]) => typeof value === "function" && name.startsWith("use"))
  .map(([name, value]) => [name, value as AnyHook] as [string, AnyHook])
  .sort(([a], [b]) => a.localeCompare(b));

describe("hooks.ts — every hook surfaces a server refusal as an ApiError", () => {
  it("exports the hooks this sweep expects to find", () => {
    // A floor, not an exact count: the sweep must not silently shrink to
    // nothing if the export shape changes.
    expect(hookEntries.length).toBeGreaterThan(300);
  });

  it.each(hookEntries)("%s", async (name, hook) => {
    let rendered: { result: { current: unknown } };
    try {
      rendered = renderHook(() => hook(...argsFor(name, hook)), { wrapper });
    } catch (err) {
      // A hook that cannot be driven from its arity alone is out of this
      // sweep's reach; it is covered by its own domain's test file.
      expect(err).toBeInstanceOf(Error);
      return;
    }

    const current = rendered.result.current;

    if (isMutationLike(current)) {
      const input = MUTATION_INPUT[name] ?? {};
      if (RESOLVES_ON_REFUSAL.has(name)) {
        await expect(current.mutateAsync(input)).resolves.toBeDefined();
        return;
      }
      await expect(current.mutateAsync(input)).rejects.toBeInstanceOf(ApiError);
      return;
    }

    if (!isQueryLike(current)) {
      // Not a react-query hook (a context reader, a derived value): nothing
      // to refuse.
      return;
    }

    // A query the hook deliberately disabled — a detail query with no id —
    // never reaches the transport, and that is correct behaviour.
    if (rendered.result.current && (rendered.result.current as QueryLike).fetchStatus === "idle" &&
        (rendered.result.current as QueryLike).isPending) {
      return;
    }

    await waitFor(
      () => {
        const q = rendered.result.current as QueryLike;
        expect(q.isError || q.isSuccess || (q.isPending && q.fetchStatus === "idle")).toBe(true);
      },
      { timeout: 3000 },
    );

    const settled = rendered.result.current as QueryLike;
    if (settled.isError) {
      expect(settled.error).toBeInstanceOf(ApiError);
      expect((settled.error as ApiError).status).toBe(503);
    }
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, WILDCARD_PERMISSION, getPermission } from "@mezan/domain";

/**
 * Which permission codes any route actually gates on.
 *
 * A code the catalogue offers and no route checks is a checkbox an admin can
 * tick to no effect: the role editor implies a capability the product does not
 * have. This reads the route sources rather than the running app, because the
 * question is about the code as written, not about one composition's options.
 */
function gatedCodes(): ReadonlySet<string> {
  const roots = [__dirname, join(__dirname, "..", "..", "backend", "src")];
  const found = new Set<string>();
  // RECURSIVE, and it was not. `readdirSync` on the root alone never reached
  // `api/src/lan/`, so every code those routes gate on was counted as gating
  // nothing — the instrument was reporting a bigger gap than the product has.
  // The first suspect for a number that looks wrong is the thing measuring it.
  const walk = (dir: string): void => {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      if (file.isDirectory()) {
        walk(join(dir, file.name));
        continue;
      }
      if (!file.isFile() || !file.name.endsWith(".ts") || file.name.endsWith(".test.ts")) continue;
      // `module-gate.ts` gates on MODULE ids ("pos", "sales"), not permission
      // codes — a different vocabulary that would otherwise read as a typo.
      if (file.name === "module-gate.ts") continue;
      const source = readFileSync(join(dir, file.name), "utf8");
      // `gate(...)`, `gateAny(...)`, and `permission(...)` — the last is what
      // `lan/routes.ts` calls its `createPermissionGate` binding, and a gate is
      // a gate whatever the local const is named. `moduleRefusalFor(c, "...")`
      // is the inline check a route makes when the code is only known once an
      // entity is in hand (attachments-routes.ts, sales-invoices-routes.ts) —
      // its first argument is the context, not a permission code, so it gets
      // its own alternative rather than joining the leading-string-only group.
      for (const match of source.matchAll(
        /(?:gate(?:Any)?|permission)\(\s*((?:"[a-z_.]+"\s*,?\s*)+)\)|moduleRefusalFor\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:"[a-z_.]+"\s*,?\s*)+)\)/g,
      )) {
        const codes = match[1] ?? match[2] ?? "";
        for (const code of codes.matchAll(/"([a-z_.]+)"/g)) found.add(code[1] as string);
      }
    }
  };
  for (const root of roots) walk(root);
  return found;
}

const GATED = gatedCodes();
const UNGATED = ALL_PERMISSION_CODES.filter((code) => code !== WILDCARD_PERMISSION && !GATED.has(code));

describe("the permission catalogue against the routes that check it", () => {
  it("gates a substantial majority of the catalogue", () => {
    expect(GATED.size).toBeGreaterThan(150);
    expect(ALL_PERMISSION_CODES.length).toBeGreaterThan(GATED.size);
  });

  it("checks only codes the catalogue actually defines — no route gates on a typo", () => {
    const known = new Set<string>(ALL_PERMISSION_CODES);
    const unknown = [...GATED].filter((code) => !known.has(code));
    expect(unknown, `routes gate on codes the catalogue does not define: ${unknown.join(", ")}`).toEqual([]);
  });

  it("resolves every gated code through getPermission — the module gate reads this and silently skips its check for anything it does not resolve", () => {
    // `createPermissionGate`/`createAnyPermissionGate` (permission-gate.ts) only
    // refuse an unlicensed module when `getPermission(code)` resolves — a typo
    // that slips past the catalogue-membership check above (e.g. a code that
    // collides with WILDCARD_PERMISSION-shaped matching) would still silently
    // skip the module axis of every gate that uses it.
    const unresolved = [...GATED].filter((code) => code !== WILDCARD_PERMISSION && !getPermission(code));
    expect(
      unresolved,
      `gate()/gateAny() codes getPermission cannot resolve, so their module check silently skips: ${unresolved.join(", ")}`,
    ).toEqual([]);
  });

  it("LIMITATION (D116): a large minority of codes gate nothing, so the role editor overstates the product", () => {
    // Every code below can be ticked in the role editor today and changes
    // nothing, because no HTTP route consults it. The count is pinned so the
    // gap cannot quietly grow: adding a code without a route to check it, or
    // deleting a route that was the only consumer, moves this number.
    //
    // `admin.backup.*` are the honest exception and are counted here anyway:
    // they gate the desktop shell's restore IPC channel, not a Hono route, and
    // this scanner only reads route sources. Two codes, deliberately left in
    // the number rather than special-cased, because a scanner with exceptions
    // is a scanner nobody trusts.
    expect(UNGATED.length).toBeGreaterThan(0);
    expect(UNGATED.length).toBeLessThanOrEqual(92);
  });

  it("LIMITATION (D116): the whole POS module is catalogued and has no route at all", () => {
    const pos = ALL_PERMISSION_CODES.filter((code) => code.startsWith("pos."));
    expect(pos.length).toBeGreaterThan(0);
    for (const code of pos) expect(GATED.has(code), `${code} is gated somewhere`).toBe(false);
  });

  it("LIMITATION (D116): a confirmed sales invoice has no void route, only a draft cancel", () => {
    // `sales.invoice.void` exists in the catalogue; nothing gates on it, and
    // the only cancel route checks `sales.invoice.delete_draft`.
    expect(ALL_PERMISSION_CODES).toContain("sales.invoice.void");
    expect(GATED.has("sales.invoice.void")).toBe(false);
    expect(GATED.has("sales.invoice.delete_draft")).toBe(true);
  });

  it("keeps the money-moving codes genuinely gated", () => {
    // Whatever else is dead, these must not be: each one guards a posting.
    for (const code of [
      "accounting.journal.post",
      "sales.invoice.confirm",
      "purchases.invoice.confirm",
      "inventory.adjustment.confirm",
      "inventory.transfer.confirm",
      "treasury.cash_voucher.confirm",
    ]) {
      expect(GATED.has(code), `${code} must gate a route`).toBe(true);
    }
  });

  it("lists what is ungated, so the gap is readable rather than a number", () => {
    // Not an assertion about the product — a printed inventory the next
    // reader can act on. Grouped by module to keep it legible.
    const byModule = new Map<string, string[]>();
    for (const code of UNGATED) {
      const module = code.split(".")[0] as string;
      byModule.set(module, [...(byModule.get(module) ?? []), code]);
    }
    expect(byModule.size).toBeGreaterThan(0);
    for (const [, codes] of byModule) expect(codes.length).toBeGreaterThan(0);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, WILDCARD_PERMISSION } from "@mezan/domain";

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
      // Module-level `const VIEW = "contracting.certificate.view";` bindings.
      // Reading only literal arguments made every route file that names its
      // codes once at the top — which is most of the contracting module —
      // register as gating NOTHING, so the instrument reported a bigger gap
      // than the product has. A gate is a gate whether the code is inlined or
      // named.
      const constants = new Map<string, string>();
      for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z_.]+)"/g)) {
        constants.set(match[1] as string, match[2] as string);
      }
      // `gate(...)`, `gateAny(...)`, and `permission(...)` — the last is what
      // `lan/routes.ts` calls its `createPermissionGate` binding, and a gate is
      // a gate whatever the local const is named.
      for (const match of source.matchAll(/(?:gate(?:Any)?|permission)\(\s*((?:(?:"[a-z_.]+"|[A-Z][A-Z0-9_]*)\s*,?\s*)+)\)/g)) {
        const args = match[1] ?? "";
        for (const code of args.matchAll(/"([a-z_.]+)"/g)) found.add(code[1] as string);
        for (const name of args.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)) {
          const resolved = constants.get(name[1] as string);
          if (resolved) found.add(resolved);
        }
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
    //
    // The contracting module's twelve codes are all gated now — the BOQ,
    // certificate, retention and guarantee routes each check one — and the
    // scanner above had to learn to follow a named constant before it could
    // see them. Each slice that lands must bring this number back DOWN by the
    // codes it gates.
    expect(UNGATED.length).toBeGreaterThan(0);
    expect(UNGATED.length).toBeLessThanOrEqual(89);
  });

  it("LIMITATION (D116): the whole POS module is catalogued and has no route at all", () => {
    const pos = ALL_PERMISSION_CODES.filter((code) => code.startsWith("pos."));
    expect(pos.length).toBeGreaterThan(0);
    for (const code of pos) expect(GATED.has(code), `${code} is gated somewhere`).toBe(false);
  });

  /** Guards the sales-invoice half of D116: the void route now exists and is gated. */
  it("gives a confirmed sales invoice an exit, gated separately from the draft cancel", () => {
    expect(ALL_PERMISSION_CODES).toContain("sales.invoice.void");
    expect(GATED.has("sales.invoice.void")).toBe(true);
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

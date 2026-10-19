import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, WILDCARD_PERMISSION, getPermission } from "@mezan/domain";
import { ReversalPermission } from "@mezan/contracts";

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
  const sources: string[] = [];
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
      sources.push(readFileSync(join(dir, file.name), "utf8"));
    }
  };
  for (const root of roots) walk(root);
  const shared = new Map<string, string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\bexport\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z_.]+)"/g)) shared.set(match[1] as string, match[2] as string);
    for (const body of source.matchAll(/\benum\s+([A-Z][A-Za-z0-9]*)\s*\{([^}]*)\}/g)) {
      for (const member of (body[2] as string).matchAll(/\b([A-Z][A-Za-z0-9]*)\s*=\s*"([a-z_]+\.[a-z_.]+)"/g)) shared.set(`${body[1]}.${member[1]}`, member[2] as string);
    }
  }
  for (const source of sources) {
    {
      // Module-level `const VIEW = "contracting.certificate.view";` bindings.
      // Reading only literal arguments made every route file that names its
      // codes once at the top — which is most of the contracting module —
      // register as gating NOTHING, so the instrument reported a bigger gap
      // than the product has. A gate is a gate whether the code is inlined or
      // named.
      const constants = new Map<string, string>(shared);
      for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z_.]+)"/g)) {
        constants.set(match[1] as string, match[2] as string);
      }
      // `gate(...)`, `gateAny(...)`, and `permission(...)` — the last is what
      // `lan/routes.ts` calls its `createPermissionGate` binding, and a gate is
      // a gate whatever the local const is named. `moduleRefusalFor(c, "...")`
      // is the inline check a route makes when the code is only known once an
      // entity is in hand (attachments-routes.ts, sales-invoices-routes.ts) —
      // its first argument is the context, not a permission code, so it gets
      // its own alternative rather than joining the leading-argument group.
      for (const match of source.matchAll(
        /(?:gate(?:Any)?|permission)\(\s*((?:(?:"[a-z_.]+"|[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9]*)?)\s*,?\s*)+)\)|moduleRefusalFor\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:(?:"[a-z_.]+"|[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9]*)?)\s*,?\s*)+)\)/g,
      )) {
        const args = match[1] ?? match[2] ?? "";
        for (const code of args.matchAll(/"([a-z_.]+)"/g)) found.add(code[1] as string);
        for (const name of args.matchAll(/\b([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9]*)?)/g)) {
          const resolved = constants.get(name[1] as string);
          if (resolved) found.add(resolved);
        }
      }
      const reversal: Readonly<Record<string, string>> = ReversalPermission;
      for (const match of source.matchAll(/gate\(\s*ReversalPermission\.([A-Za-z]+)/g)) {
        const code = reversal[match[1] as string];
        if (code) found.add(code);
      }
    }
  }
  return found;
}

const GATED = gatedCodes();
const UNGATED = ALL_PERMISSION_CODES.filter((code) => code !== WILDCARD_PERMISSION && !GATED.has(code));

describe("the permission catalogue against the routes that check it", () => {
  it("gates a substantial majority of the catalogue", () => {
    expect(GATED.size).toBeGreaterThan(200);
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

  it("D116 closed: what this scanner cannot see is a short, named list, not a large minority", () => {
    // 89 → 13. DEC-14 deleted the 67 codes that named nothing at all, so what
    // is left here is not dead catalogue — every one is enforced by something
    // this scanner cannot read:
    //
    //   - inline `can()` inside a handler, where the code is only known once a
    //     body or an entity is in hand: `sales.invoice.view_cost`,
    //     `sales.price.override`, `sales.discount.approve` (the invoice discount
    //     ceiling), `purchases.receipt.edit_cost`, `hr.employee.view_salary`;
    //   - `attachments/entity-type.ts`, which resolves a permission from the
    //     entity an attachment hangs on: `purchases.order.edit` is that
    //     module's `manage` right;
    //   - a composite read assembled from routes that each gate themselves:
    //     `purchases.supplier360.view`, `crm.customer360.view`;
    //   - a ROLE-gated workflow step rather than a permission gate, which is
    //     what DEC-2 decided approval is: `workflow.approve`/`.reject`;
    //   - the desktop shell's restore IPC channel, which is not a Hono route at
    //     all: `admin.backup.view`, `admin.backup.restore`,
    //     `admin.tenant.settings.edit`;
    //   - a right that widens what every GL read returns rather than opening a
    //     route of its own, checked in `branch-view.ts`:
    //     `accounting.reports.view_unattributed` (D111).
    //   - the period lock's override, an inline `can()` beside the route's own
    //     gate: `accounting.period.override_close`; and the till's discount
    //     ceiling, the same shape: `pos.discount.approve`; and the price-floor
    //     approval, checked inline in the decide route once the request it
    //     decides is known: `sales.pricing_guard.approve` (D351).
    //
    // The count is pinned so the gap cannot quietly grow: adding a code without
    // anything to check it, or deleting the only consumer of one, moves this
    // number.
    expect([...UNGATED].sort()).toEqual([
      "accounting.period.override_close",
      "accounting.reports.view_unattributed",
      "admin.backup.restore",
      "admin.backup.view",
      "admin.tenant.settings.edit",
      "crm.customer360.view",
      "hr.employee.view_salary",
      "pos.discount.approve",
      "purchases.order.edit",
      "purchases.receipt.edit_cost",
      "purchases.supplier360.view",
      "sales.discount.approve",
      "sales.invoice.view_cost",
      "sales.pricing_guard.approve",
      "workflow.approve",
      "workflow.reject",
    ]);
  });

  it("every POS code the catalogue carries is checked by a POS route — the module came back with its gates", () => {
    // DEC-14 deleted all thirty-eight POS codes because none had a route.
    // DEC-23 brought the module back, and it may only carry codes the server
    // enforces: three gate routes outright, and `pos.discount.approve` is an
    // inline `can()` on the till's discount ceiling for the same reason
    // `sales.discount.approve` is one — the ceiling is only known once the
    // ticket is in hand (pos/settings-routes.ts, sales-invoices-routes.ts).
    for (const code of ["pos.terminal.view", "pos.terminal.manage", "pos.settings.edit"]) {
      expect(GATED.has(code), `${code} must gate a route`).toBe(true);
    }
    expect(ALL_PERMISSION_CODES).toContain("pos.discount.approve");
    // The invoice ceiling stayed under `sales` when the till one came back:
    // two ceilings, two codes.
    expect(ALL_PERMISSION_CODES).toContain("sales.discount.approve");
  });

  it("gates the per-voucher-type treasury codes DEC-14 kept, so they are controls and not labels", () => {
    for (const code of [
      "treasury.customer_refund.create",
      "treasury.customer_refund.confirm",
      "treasury.customer_refund.void",
      "treasury.transfer.create",
      "treasury.transfer.confirm",
      "treasury.transfer.void",
      "contracting.certificate.collect",
      "sales.return.view_own",
      "purchases.invoice.view_own",
    ]) {
      expect(GATED.has(code), `${code} must gate a route`).toBe(true);
    }
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

import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createCountModeRoutes } from "@mezan/api";
import {
  CountModeService,
  resolvePermissions,
  type PhysicalCount,
  type PhysicalCountCompletionGate,
  type PhysicalCountService,
  type Role,
} from "@mezan/domain";
import { createSqliteCountItemDirectory, createSqliteCountModeStore } from "@mezan/persistence";
import type { BackendArea, BackendModuleContext } from "../module-context.js";

export const COUNT_MODE_SCAN_PERMISSION = "inventory.count.scan";
const COUNT_MODE_PATH = "/inventory/count-mode";

interface CountModeBinding {
  counts?: PhysicalCountService;
  service?: CountModeService;
}

const bindings = new WeakMap<Database.Database, CountModeBinding>();

function bindingOf(sqlite: Database.Database): CountModeBinding {
  const existing = bindings.get(sqlite);
  if (existing) return existing;
  const created: CountModeBinding = {};
  bindings.set(sqlite, created);
  return created;
}

export function countModeCompletionGate(sqlite: Database.Database): PhysicalCountCompletionGate {
  return {
    assertCompletable: async (count: PhysicalCount) => {
      if (count.zoned) await bindingOf(sqlite).service?.assertCompletable(count);
    },
  };
}

export function registerCountModeCounts(sqlite: Database.Database, counts: PhysicalCountService): void {
  bindingOf(sqlite).counts = counts;
}

async function eligibleCounters(ctx: BackendModuleContext): Promise<{ userId: string; name: string }[]> {
  const roles = new Map<string, Role | null>();
  const out: { userId: string; name: string }[] = [];
  for (const user of await ctx.uow.users.list()) {
    if (user.status !== "active") continue;
    if (!user.isCompanyAdmin) {
      if (!user.roleId) continue;
      if (!roles.has(user.roleId)) roles.set(user.roleId, await ctx.uow.roles.findById(user.roleId));
      const role = roles.get(user.roleId);
      if (!role || !resolvePermissions(role.permissions).has(COUNT_MODE_SCAN_PERMISSION)) continue;
    }
    out.push({ userId: user.id, name: user.nameAr });
  }
  return out;
}

export const area: BackendArea = {
  mount(ctx) {
    const binding = bindingOf(ctx.sqlite);
    if (!binding.counts) return;
    const service = new CountModeService({
      counts: binding.counts,
      repo: createSqliteCountModeStore(ctx.sqlite),
      items: createSqliteCountItemDirectory(ctx.sqlite),
    });
    binding.service = service;
    ctx.app.route(
      COUNT_MODE_PATH,
      createCountModeRoutes(
        {
          service,
          items: ctx.stores.items,
          eligibleCounters: () => eligibleCounters(ctx),
          userNames: async (ids) => {
            const names = new Map<string, string>();
            for (const id of ids) {
              const user = await ctx.uow.users.findById(id);
              if (user) names.set(id, user.nameAr);
            }
            return names;
          },
          newId: () => randomUUID(),
          audit: ctx.audit,
        },
        ctx.resolveAuthContext,
      ),
    );
  },
};

import { Hono, type Context } from "hono";
import {
  SEQUENCE_DEFINITIONS,
  applySequenceOverride,
  formatSequenceNumber,
  recordSensitiveEvent,
  type AuditSink,
  type SequenceDefinition,
  type SequenceOverride,
} from "@mezan/domain";
import { sequenceOverrideSchema, resetSequenceCounterSchema, type SequenceListItemDTO } from "@mezan/contracts";
import { branchScopeOf, createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { atomically, type ConfigTransactor } from "./config-transactor.js";

/**
 * Read/config surface for the numbering engine (`/settings/sequences`,
 * docs/archive/catalog/09). The allocation engine itself (`NextNumberService`) is
 * untouched — these routes only read the compiled-in {@link SEQUENCE_DEFINITIONS}
 * plus any admin override, and peek at (never increment) the live counter.
 */

/** The counter-read/write surface these routes need — a narrow slice of `SqliteSequenceStoreHandle`. */
export interface SequenceCounterPort {
  peek(code: string, period: number | null, scope?: string | null): Promise<number>;
  setCounter(code: string, period: number | null, value: number, scope?: string | null): Promise<void>;
}

/** The override-read/write surface these routes need — a narrow slice of `SqliteSequenceConfigStoreHandle`. */
export interface SequenceConfigPort {
  getOverride(code: string): Promise<SequenceOverride | null>;
  getAllOverrides(): Promise<ReadonlyMap<string, SequenceOverride>>;
  upsertOverride(code: string, patch: SequenceOverride): Promise<void>;
}

export interface SequencesRoutesDeps {
  readonly counters: SequenceCounterPort;
  readonly config: SequenceConfigPort;
  readonly audit?: AuditSink;
  /** The boundary the audit row shares with the write it records — see {@link ConfigTransactor}. */
  readonly transactor?: ConfigTransactor;
  readonly definitions?: readonly SequenceDefinition[];
  readonly now?: () => Date;
}

function periodFor(def: SequenceDefinition, now: Date): number | null {
  return def.annualReset ? now.getUTCFullYear() : null;
}

function requestBranch(c: Context): string | null {
  const scope = branchScopeOf(c);
  const asked = c.req.query("branchId");
  if (asked) return !scope || scope.includes(asked) ? asked : null;
  return scope?.length === 1 ? scope[0]! : null;
}

function counterScope(def: SequenceDefinition, branchId: string | null): string | null {
  return def.branchScoped ? branchId : null;
}

async function toListItem(
  def: SequenceDefinition,
  override: SequenceOverride | undefined,
  deps: SequencesRoutesDeps,
  now: Date,
  branchId: string | null,
): Promise<SequenceListItemDTO> {
  const effective = applySequenceOverride(def, override ?? null);
  const period = periodFor(effective, now);
  const scope = counterScope(effective, branchId);
  const currentValue = await deps.counters.peek(effective.code, period, scope);
  return {
    code: effective.code,
    labelAr: effective.labelAr,
    prefix: effective.prefix,
    suffix: effective.suffix,
    padLength: effective.padLength,
    annualReset: effective.annualReset,
    branchScoped: effective.branchScoped ?? false,
    currentValue,
    nextNumber: formatSequenceNumber(effective, currentValue + 1, scope),
    isOverridden: override !== undefined,
  };
}

function findDefinition(deps: SequencesRoutesDeps, code: string): SequenceDefinition | undefined {
  const defs = deps.definitions ?? SEQUENCE_DEFINITIONS;
  return defs.find((d) => d.code === code);
}

function actorOf(c: Context): string {
  return getAuthContext(c)?.userId ?? "system";
}

export function createSequencesRoutes(
  deps: SequencesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const defs = deps.definitions ?? SEQUENCE_DEFINITIONS;

  app.get("/", gate("admin.sequences.view"), async (c) => {
    const now = deps.now?.() ?? new Date();
    const overrides = await deps.config.getAllOverrides();
    const items = await Promise.all(defs.map((def) => toListItem(def, overrides.get(def.code), deps, now, requestBranch(c))));
    return c.json(items);
  });

  app.get("/:code", gate("admin.sequences.view"), async (c) => {
    const code = c.req.param("code");
    const def = findDefinition(deps, code);
    if (!def) return c.json({ error: "NOT_FOUND" }, 404);
    const now = deps.now?.() ?? new Date();
    const override = await deps.config.getOverride(code);
    return c.json(await toListItem(def, override ?? undefined, deps, now, requestBranch(c)));
  });

  app.patch("/:code", gate("admin.sequences.edit"), async (c) => {
    const code = c.req.param("code");
    const def = findDefinition(deps, code);
    if (!def) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = sequenceOverrideSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    await atomically(deps.transactor, async () => {
      await deps.config.upsertOverride(code, parsed.data);
      if (deps.audit) {
        await recordSensitiveEvent(deps.audit, {
          module: "admin",
          entityType: "SEQUENCE",
          entityId: code,
          action: "SEQUENCE_CONFIG_UPDATED",
          actor: actorOf(c),
          severity: "WARNING",
          details: { code, patch: parsed.data },
        });
      }
    });

    const now = deps.now?.() ?? new Date();
    const override = await deps.config.getOverride(code);
    return c.json(await toListItem(def, override ?? undefined, deps, now, requestBranch(c)));
  });

  /**
   * Explicit, guarded counter adjustment. Never a plain "edit the number"
   * field: `confirm: true` is required, and any value below the current
   * counter is refused — going backward is exactly what would let two
   * documents share a number, breaking the no-gap/no-dupe guarantee
   * `NextNumberService` provides inside a posting transaction.
   */
  app.post("/:code/counter", gate("admin.sequences.reset"), async (c) => {
    const code = c.req.param("code");
    const def = findDefinition(deps, code);
    if (!def) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = resetSequenceCounterSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    const now = deps.now?.() ?? new Date();
    const override = await deps.config.getOverride(code);
    const effective = applySequenceOverride(def, override);
    const period = periodFor(effective, now);
    const scope = counterScope(effective, requestBranch(c));
    const current = await deps.counters.peek(effective.code, period, scope);
    if (parsed.data.value < current) {
      return c.json(
        {
          error: "COUNTER_ROLLBACK_REJECTED",
          message: "لا يمكن إنقاص العداد — قد يؤدي ذلك لتكرار رقم مستند سبق إصداره.",
          currentValue: current,
        },
        422,
      );
    }

    await atomically(deps.transactor, async () => {
      await deps.counters.setCounter(effective.code, period, parsed.data.value, scope);
      if (deps.audit) {
        await recordSensitiveEvent(deps.audit, {
          module: "admin",
          entityType: "SEQUENCE",
          entityId: code,
          action: "SEQUENCE_COUNTER_ADJUSTED",
          actor: actorOf(c),
          severity: "CRITICAL",
          details: { code, branchId: scope, from: current, to: parsed.data.value },
        });
      }
    });

    return c.json(await toListItem(def, override ?? undefined, deps, now, requestBranch(c)));
  });

  return app;
}

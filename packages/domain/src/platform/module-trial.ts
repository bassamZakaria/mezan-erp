import { isSubModule } from "../entitlements/sub-modules.js";
import { isKnownModule, moduleName } from "./module-catalog.js";
import { addDays } from "./subscription.js";
import { isoTimestamp } from "./validation.js";
import { InvalidSubscriptionError, ModuleTrialAlreadyUsedError, ModuleTrialUnavailableError } from "./errors.js";

export const MODULE_TRIAL_DAYS = 14;

export enum ModuleTrialState {
  Live = "live",
  Ended = "ended",
}

export interface ModuleTrial {
  readonly id: string;
  readonly tenantId: string;
  readonly module: string;
  readonly startedAt: string;
  readonly endsAt: string;
  readonly startedBy: string;
}

export interface ModuleTrialRepository {
  listByTenant(tenantId: string): Promise<ModuleTrial[]>;
  /** Inserts only when this tenant has never tried this module; the unique (tenant, module) key decides, not a prior read. */
  insertIfFirst(trial: ModuleTrial): Promise<boolean>;
}

export function moduleTrialState(trial: ModuleTrial, nowIso: string): ModuleTrialState {
  return nowIso < trial.endsAt ? ModuleTrialState.Live : ModuleTrialState.Ended;
}

export function liveTrialModules(trials: readonly ModuleTrial[], nowIso: string): string[] {
  return trials.filter((t) => moduleTrialState(t, nowIso) === ModuleTrialState.Live).map((t) => t.module);
}

export interface StartModuleTrialCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly module: string;
  readonly startedBy: string;
  readonly entitledModules: readonly string[];
  readonly now: string;
}

export async function startModuleTrial(cmd: StartModuleTrialCommand, repo: ModuleTrialRepository): Promise<ModuleTrial> {
  const now = isoTimestamp(cmd.now);
  if (!now) throw new InvalidSubscriptionError(["الطابع الزمني الحالي غير صالح (يجب أن يكون بصيغة ISO-8601)"]);
  if (!isKnownModule(cmd.module)) {
    throw new ModuleTrialUnavailableError(cmd.module, `الوحدة "${cmd.module}" غير معروفة`, `Unknown module "${cmd.module}"`);
  }
  if (isSubModule(cmd.module)) {
    throw new ModuleTrialUnavailableError(cmd.module, "التجربة متاحة للوحدة كاملة فقط", "A trial covers a whole module only");
  }
  const name = moduleName(cmd.module);
  const previous = (await repo.listByTenant(cmd.tenantId)).find((t) => t.module === cmd.module);
  if (previous) throw new ModuleTrialAlreadyUsedError(cmd.module, name.ar, name.en, previous.endsAt);
  if (cmd.entitledModules.includes(cmd.module)) {
    throw new ModuleTrialUnavailableError(
      cmd.module,
      `وحدة ${name.ar} مفعّلة بالفعل في باقتكم، فلا حاجة لتجربتها.`,
      `The ${name.en} module is already in your plan; there is nothing to try.`,
    );
  }
  const trial: ModuleTrial = {
    id: cmd.id,
    tenantId: cmd.tenantId,
    module: cmd.module,
    startedAt: now,
    endsAt: addDays(now, MODULE_TRIAL_DAYS),
    startedBy: cmd.startedBy,
  };
  if (!(await repo.insertIfFirst(trial))) {
    const winner = (await repo.listByTenant(cmd.tenantId)).find((t) => t.module === cmd.module);
    throw new ModuleTrialAlreadyUsedError(cmd.module, name.ar, name.en, winner?.endsAt ?? trial.endsAt);
  }
  return trial;
}

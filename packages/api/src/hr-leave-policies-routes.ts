import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  InvalidLeavePolicyError,
  LEAVE_POLICY_PRESETS,
  applyLeavePolicyPreset,
  isLeaveTypeCode,
  setLeavePolicy,
  type LeavePolicyRepository,
} from "@mezan/domain";
import { applyLeavePolicyPresetSchema, setLeavePolicySchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export interface HrLeavePoliciesRoutesDeps {
  readonly policies: LeavePolicyRepository;
  readonly idGen?: () => string;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof InvalidLeavePolicyError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Leave Policies routes (docs/catalog/06 §"سياسات الإجازات"), mounted under `/hr/leave-policies`. */
export function createHrLeavePoliciesRoutes(
  deps: HrLeavePoliciesRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const idGen = deps.idGen ?? randomUUID;

  app.get("/", gate("hr.leave_policy.view"), async (c) => {
    const asOfDate = c.req.query("asOfDate") ?? today();
    const effective = await deps.policies.listEffective(asOfDate);
    return c.json(effective);
  });

  app.get("/presets", gate("hr.leave_policy.view"), (c) => {
    return c.json(LEAVE_POLICY_PRESETS);
  });

  app.get("/:leaveTypeCode/versions", gate("hr.leave_policy.view"), async (c) => {
    const leaveTypeCode = c.req.param("leaveTypeCode");
    if (!isLeaveTypeCode(leaveTypeCode)) {
      return c.json({ error: "VALIDATION_ERROR", message: `Unknown leave type: "${leaveTypeCode}"` }, 400);
    }
    return c.json(await deps.policies.listVersions(leaveTypeCode));
  });

  app.post("/", gate("hr.leave_policy.edit"), async (c) => {
    const parsed = setLeavePolicySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const version = await setLeavePolicy({ id: idGen(), ...parsed.data }, { policies: deps.policies });
      return c.json(version, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/apply-preset", gate("hr.leave_policy.apply_preset"), async (c) => {
    const parsed = applyLeavePolicyPresetSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const versions = await applyLeavePolicyPreset(
        { source: parsed.data.source, idPrefix: idGen() },
        { policies: deps.policies },
      );
      return c.json(versions, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

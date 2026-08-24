import { Hono, type Context } from "hono";
import {
  createCostCenter,
  updateCostCenter,
  buildCostCenterTree,
  CircularParentCostCenterError,
  CostCenterNotFoundError,
  DuplicateCostCenterCodeError,
  InvalidParentCostCenterError,
  type CostCenter,
  type CostCenterRepository,
} from "@mezan/domain";
import { createCostCenterSchema, updateCostCenterSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";

function serialize(costCenter: CostCenter) {
  return {
    id: costCenter.id,
    code: costCenter.code,
    nameAr: costCenter.nameAr,
    nameEn: costCenter.nameEn,
    type: costCenter.type,
    departmentId: costCenter.departmentId,
    branchId: costCenter.branchId,
    parentId: costCenter.parentId,
    notes: costCenter.notes,
    status: costCenter.status,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof CostCenterNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateCostCenterCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidParentCostCenterError || err instanceof CircularParentCostCenterError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  throw err;
}

/**
 * Cost center routes (docs/catalog/04 "مراكز التكلفة"): list/tree, get one,
 * create, edit.
 *
 * PERMISSION NOTE: the permission catalog's accounting module (17 codes,
 * docs/catalog/09 §permission matrix line ~413) has no dedicated
 * `accounting.cost_center.*` entry — cost centers are dimensional master
 * data closely tied to the Chart of Accounts (they feed the "أرباح مراكز
 * التكلفة" report the same way accounts feed the trial balance), so this
 * router reuses `accounting.coa.view` / `.manage` rather than inventing an
 * undocumented permission code.
 */
export function createCostCentersRoutes(
  repo: CostCenterRepository,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.coa.view"), async (c) => {
    const costCenters = withinScope(await repo.list(), branchScopeOf(c), (cc) => cc.branchId);
    return c.json(costCenters.map(serialize));
  });

  app.get("/tree", gate("accounting.coa.view"), async (c) => {
    const costCenters = await repo.list();
    return c.json(buildCostCenterTree(costCenters));
  });

  app.get("/:id", gate("accounting.coa.view"), async (c) => {
    const costCenter = await repo.findById(c.req.param("id"));
    if (!costCenter) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(costCenter));
  });

  app.post("/", gate("accounting.coa.manage"), async (c) => {
    const parsed = createCostCenterSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const costCenter = await createCostCenter(parsed.data, repo);
      return c.json(serialize(costCenter), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("accounting.coa.manage"), async (c) => {
    const parsed = updateCostCenterSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const costCenter = await updateCostCenter(c.req.param("id"), parsed.data, repo);
      return c.json(serialize(costCenter));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

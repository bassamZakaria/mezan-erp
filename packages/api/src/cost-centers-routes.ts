import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import {
  createCostCenter,
  updateCostCenter,
  buildCostCenterTree,
  importableDepartments,
  createCostCentersFromDepartments,
  CircularParentCostCenterError,
  CostCenterNotFoundError,
  DuplicateCostCenterCodeError,
  InvalidParentCostCenterError,
  type CostCenter,
  type CostCenterRepository,
  type DepartmentRepository,
} from "@mezan/domain";
import {
  createCostCenterSchema,
  updateCostCenterSchema,
  createCostCentersFromDepartmentsSchema,
} from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver, branchScopeOf, withinScope } from "./permission-gate.js";

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
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 404 | 409 | 422) =>
    c.json({ error: e.code, message: e.message, ...(e.messageEn ? { messageEn: e.messageEn } : {}) }, status);
  if (err instanceof CostCenterNotFoundError) {
    return refuse(err, 404);
  }
  if (err instanceof DuplicateCostCenterCodeError) {
    return refuse(err, 409);
  }
  if (err instanceof InvalidParentCostCenterError || err instanceof CircularParentCostCenterError) {
    return refuse(err, 422);
  }
  throw err;
}

/**
 * Cost center routes (docs/archive/catalog/04 "مراكز التكلفة"): list/tree, get one,
 * create, edit.
 *
 * PERMISSION NOTE: the permission catalog's accounting module (17 codes,
 * docs/archive/catalog/09 §permission matrix line ~413) has no dedicated
 * `accounting.cost_center.*` entry — cost centers are dimensional master
 * data closely tied to the Chart of Accounts (they feed the "أرباح مراكز
 * التكلفة" report the same way accounts feed the trial balance), so this
 * router reuses `accounting.coa.view` / `.manage` rather than inventing an
 * undocumented permission code.
 */
export function createCostCentersRoutes(
  repo: CostCenterRepository,
  resolveAuthContext: AuthContextResolver,
  /**
   * HR departments, so مراكز التكلفة can be created from the org chart the
   * tenant already maintains (R6.7). Omit and both import routes report an
   * empty list rather than 404ing a control the screen would still render.
   */
  departments?: Pick<DepartmentRepository, "list">,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /**
   * The departments that have no cost centre yet. Listed BEFORE `/:id`, or
   * Hono matches this path as an id and answers 404.
   */
  app.get("/importable-departments", gate("accounting.coa.view"), async (c) => {
    if (!departments) return c.json([]);
    const [deps, costCenters] = await Promise.all([departments.list(), repo.list()]);
    return c.json(importableDepartments(deps, costCenters));
  });

  app.post("/from-departments", gate("accounting.coa.manage"), async (c) => {
    if (!departments) {
      return c.json({ error: "DEPARTMENTS_UNAVAILABLE", message: "الأقسام غير متاحة في هذا التركيب." }, 422);
    }
    const parsed = createCostCentersFromDepartmentsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const result = await createCostCentersFromDepartments(
        {
          departmentIds: parsed.data.departmentIds,
          parentId: parsed.data.parentId ?? null,
          idFor: () => randomUUID(),
        },
        { departments, costCenters: repo },
      );
      return c.json({ created: result.created.map(serialize), skipped: result.skipped }, 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.get("/", gate("accounting.coa.view"), async (c) => {
    const costCenters = withinScope(await repo.list(), branchScopeOf(c), (cc) => cc.branchId);
    return c.json(costCenters.map(serialize));
  });

  /**
   * Narrowed BEFORE the tree is built, not after: a cost centre whose parent
   * falls outside the scope re-roots rather than disappearing with it, so a
   * scoped caller still sees every centre that is theirs (D131).
   */
  app.get("/tree", gate("accounting.coa.view"), async (c) => {
    const costCenters = withinScope(await repo.list(), branchScopeOf(c), (cc) => cc.branchId);
    return c.json(buildCostCenterTree([...costCenters]));
  });

  app.get("/:id", gate("accounting.coa.view"), async (c) => {
    const costCenter = await repo.findById(c.req.param("id"));
    // Out of scope reads as absent, matching the list: the caller may not learn
    // that another branch's cost centre exists by guessing its id (D131).
    if (!costCenter || withinScope([costCenter], branchScopeOf(c), (cc) => cc.branchId).length === 0) {
      return c.json({ error: "NOT_FOUND" }, 404);
    }
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

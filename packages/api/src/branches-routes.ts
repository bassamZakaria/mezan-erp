import { Hono } from "hono";
import { createBranch, updateBranch, InvalidBranchError, type BranchRepository } from "@mezan/domain";
import { createBranchSchema, updateBranchSchema } from "@mezan/contracts";
import { branchGrantOf, createAuthenticatedGate, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { canSeeUnattributed } from "./branch-view.js";

/** Branch CRUD routes (docs/archive/catalog/09 §"إدارة الفروع"), gated by admin.branches.*. */
export function createBranchesRoutes(
  store: BranchRepository,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.branches.view"), async (c) => {
    return c.json(await store.findAll());
  });

  /**
   * The branches a picker may offer: the ones the SESSION was granted, and
   * nothing but their id and name. Any signed-in user may ask — a report or a
   * document that takes a branch needs the list, and `admin.branches.view`
   * would hand a branch manager every other branch's record. Inactive branches
   * stay in: a closed branch's figures are still its figures.
   *
   * Registered before `/:id`, which would otherwise read `lookup` as an id.
   */
  app.get("/lookup", createAuthenticatedGate(resolveAuthContext), async (c) => {
    const grant = branchGrantOf(c);
    const branches = (await store.findAll())
      .filter((branch) => !grant || grant.includes(branch.id))
      .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name, "ar"))
      .map((branch) => ({ id: branch.id, name: branch.name, isMain: branch.isMain, active: branch.active }));
    return c.json({ branches, restricted: grant !== undefined, unattributed: canSeeUnattributed(c) });
  });

  app.get("/:id", gate("admin.branches.view"), async (c) => {
    const branch = await store.findById(c.req.param("id"));
    if (!branch) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(branch);
  });

  app.post("/", gate("admin.branches.create"), async (c) => {
    const parsed = createBranchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await store.findById(parsed.data.id)) {
      return c.json({ error: "ALREADY_EXISTS" }, 409);
    }
    const limit = c.get("entitlements")?.limits?.branches;
    if (limit !== undefined && (await store.findAll()).length >= limit) {
      return c.json(
        { error: "BRANCH_LIMIT_REACHED", message: "وصلتم إلى الحد الأقصى للفروع في باقتكم" },
        409,
      );
    }
    try {
      const branch = createBranch(parsed.data);
      await store.save(branch);
      return c.json(branch, 201);
    } catch (err) {
      if (err instanceof InvalidBranchError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  app.put("/:id", gate("admin.branches.edit"), async (c) => {
    const id = c.req.param("id");
    const current = await store.findById(id);
    if (!current) return c.json({ error: "NOT_FOUND" }, 404);

    const parsed = updateBranchSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      const next = updateBranch(current, parsed.data);
      await store.save(next);
      return c.json(next);
    } catch (err) {
      if (err instanceof InvalidBranchError) {
        return c.json({ error: err.code, message: err.message }, 422);
      }
      throw err;
    }
  });

  return app;
}

import { Hono } from "hono";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfigRepository } from "@mezan/domain";
import { printTemplateConfigSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Print Template Config routes (docs/catalog/09 §"قوالب الطباعة"): a single
 * tenant-wide print-template settings object feeding the 9-tab designer UI.
 * `GET /` reads it (falling back to the catalog default so the UI always has
 * something to render) and `PUT /` validates and replaces it wholesale — same
 * shape as `createSettingsRoutes`, gated via the permissions engine.
 */
export interface PrintTemplateConfigRoutesDeps {
  readonly repo: PrintTemplateConfigRepository;
}

export function createPrintTemplateConfigRoutes(
  deps: PrintTemplateConfigRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    const existing = await deps.repo.get();
    return c.json(existing ?? DEFAULT_PRINT_TEMPLATE_CONFIG);
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const parsed = printTemplateConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }

    await deps.repo.save(parsed.data);
    return c.json(parsed.data);
  });

  return app;
}

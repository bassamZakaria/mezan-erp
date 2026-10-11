import { Hono } from "hono";
import {
  createDefaultSettings,
  DEFAULT_PRINT_TEMPLATE_CONFIG,
  PERMISSIONS,
  type PrintTemplateConfigRepository,
  type SettingsRepository,
} from "@mezan/domain";
import { printTemplateConfigSchema } from "@mezan/contracts";
import { createAnyPermissionGate, createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * Print Template Config routes (docs/archive/catalog/09 §"قوالب الطباعة"): a single
 * tenant-wide print-template settings object feeding the 9-tab designer UI.
 * `GET /` reads it (falling back to the catalog default so the UI always has
 * something to render) and `PUT /` validates and replaces it wholesale — same
 * shape as `createSettingsRoutes`, gated via the permissions engine.
 */
export interface PrintTemplateConfigRoutesDeps {
  readonly repo: PrintTemplateConfigRepository;
  readonly settings?: Pick<SettingsRepository, "get">;
}

const VIEW_ACTIONS: readonly string[] = ["view", "view_own", "view_all"];
const SETTINGS_MODULE_PREFIX = "admin.";

// SECURITY: the template and the letterhead are what a printed document
// carries, so whoever may VIEW a document may read them — and nobody else.
// Editing the template stays behind `admin.settings.edit`, and the letterhead
// is the six company fields every printed invoice already shows, never the
// tenant's settings.
export const DOCUMENT_VIEW_PERMISSIONS: readonly string[] = PERMISSIONS.map((permission) => permission.code).filter((code) => {
  const action = code.slice(code.lastIndexOf(".") + 1);
  return VIEW_ACTIONS.includes(action) && !code.startsWith(SETTINGS_MODULE_PREFIX);
});

export function createPrintTemplateConfigRoutes(
  deps: PrintTemplateConfigRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAnyDocumentView = createAnyPermissionGate(resolveAuthContext)(...DOCUMENT_VIEW_PERMISSIONS, "admin.settings.view");

  app.get("/", gateAnyDocumentView, async (c) => {
    const existing = await deps.repo.get();
    return c.json(existing ?? DEFAULT_PRINT_TEMPLATE_CONFIG);
  });

  app.get("/letterhead", gateAnyDocumentView, async (c) => {
    const settings = (await deps.settings?.get()) ?? createDefaultSettings();
    return c.json({
      companyName: settings.companyName,
      address: settings.address,
      phone: settings.phone,
      email: settings.email,
      taxRegistrationNumber: settings.taxRegistrationNumber,
      commercialRegistrationNumber: settings.commercialRegistrationNumber,
    });
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

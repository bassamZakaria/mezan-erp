import { Hono } from "hono";
import { DEFAULT_PRINT_TEMPLATE_CONFIG, type PrintTemplateConfig, type PrintTemplateConfigRepository } from "@mezan/domain";
import { LOGO_MAX_CHARS, printTemplateConfigSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * Print Template Config routes (docs/archive/catalog/09 §"قوالب الطباعة"): a single
 * tenant-wide print-template settings object feeding the 9-tab designer UI.
 * `GET /` reads it (falling back to the catalog default so the UI always has
 * something to render) and `PUT /` validates and replaces it wholesale — same
 * shape as `createSettingsRoutes`, gated via the permissions engine.
 */
const LOGO_FIELD = "logoUrl";

type Identity = { logoUrl?: unknown } | undefined;
type WithIdentity = { identity?: Identity; perDocumentOverrides?: Record<string, { identity?: Identity } | undefined> };

// A logo saved before the size limit existed is larger than any save may now
// send. Sent back UNCHANGED it is not a new upload, and refusing it would stop
// every later save of the template; only a logo that differs from the stored
// one is held to the limit.
function keepStoredOversizeLogos(
  body: unknown,
  stored: PrintTemplateConfig | null,
): { forValidation: unknown; restore: (config: PrintTemplateConfig) => PrintTemplateConfig } {
  if (stored === null || body === null || typeof body !== "object") return { forValidation: body, restore: (config) => config };
  const incoming = structuredClone(body) as WithIdentity;
  const restores: ((config: PrintTemplateConfig) => void)[] = [];
  const keep = (target: Identity, storedLogo: string | undefined, put: (config: PrintTemplateConfig, logo: string) => void): void => {
    if (!target || typeof target.logoUrl !== "string" || storedLogo === undefined) return;
    if (target.logoUrl.length <= LOGO_MAX_CHARS || target.logoUrl !== storedLogo) return;
    target.logoUrl = "";
    restores.push((config) => put(config, storedLogo));
  };
  keep(incoming.identity, stored.identity.logoUrl, (config, logo) => {
    (config.identity as { logoUrl?: string }).logoUrl = logo;
  });
  for (const [docType, override] of Object.entries(incoming.perDocumentOverrides ?? {})) {
    keep(override?.identity, stored.perDocumentOverrides[docType]?.identity?.logoUrl, (config, logo) => {
      const identity = config.perDocumentOverrides[docType]?.identity as { logoUrl?: string } | undefined;
      if (identity) identity.logoUrl = logo;
    });
  }
  return {
    forValidation: incoming,
    restore: (config) => {
      const restored = structuredClone(config);
      for (const put of restores) put(restored);
      return restored;
    },
  };
}

export interface PrintTemplateConfigRoutesDeps {
  readonly repo: PrintTemplateConfigRepository;
}

export function createPrintTemplateConfigRoutes(
  deps: PrintTemplateConfigRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    const existing = await deps.repo.get();
    return c.json(existing ?? DEFAULT_PRINT_TEMPLATE_CONFIG);
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const body: unknown = await c.req.json();
    const kept = keepStoredOversizeLogos(body, await deps.repo.get());
    const parsed = printTemplateConfigSchema.safeParse(kept.forValidation);
    if (!parsed.success) {
      const logoTooLarge = parsed.error.issues.some((issue) => issue.path.at(-1) === LOGO_FIELD && issue.code === "too_big");
      return c.json(
        {
          error: "VALIDATION_ERROR",
          details: parsed.error.flatten(),
          ...(logoTooLarge ? { message: "حجم الشعار أكبر من المسموح به. استخدم صورة أصغر." } : {}),
        },
        400,
      );
    }

    const saved = kept.restore(parsed.data);
    await deps.repo.save(saved);
    return c.json(saved);
  });

  return app;
}

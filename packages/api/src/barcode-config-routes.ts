import { postingRefusalResponse } from "./posting-refusal.js";
import { Hono, type Context } from "hono";
import {
  createDefaultBarcodeConfig,
  updateBarcodeConfig,
  parseEmbeddedBarcode,
  InvalidBarcodeConfigError,
  type BarcodeConfig,
  type BarcodeConfigRepository,
} from "@mezan/domain";
import { updateBarcodeConfigSchema, parseBarcodeRequestSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";

/**
 * Routes for the tenant-wide barcode configuration (default symbology,
 * item-barcode mode, embedded price/weight barcode parsing rules). No Money
 * involved, so serialization is a plain passthrough of the domain shape.
 *
 *   GET  /         current config, or the computed default if none saved yet   (admin.settings.view)
 *   PUT  /         replace the config (embeddedRules is a full replace)        (admin.settings.edit)
 *   POST /parse    test a scanned code against the SAVED config's rules        (admin.settings.view)
 */
export interface BarcodeConfigRoutesDeps {
  readonly store: BarcodeConfigRepository;
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const postingRefusal = postingRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof InvalidBarcodeConfigError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createBarcodeConfigRoutes(
  deps: BarcodeConfigRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("admin.settings.view"), async (c) => {
    const config = (await deps.store.get()) ?? createDefaultBarcodeConfig();
    return c.json(config);
  });

  app.put("/", gate("admin.settings.edit"), async (c) => {
    const parsed = updateBarcodeConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const current: BarcodeConfig = (await deps.store.get()) ?? createDefaultBarcodeConfig();
    try {
      const next = updateBarcodeConfig(current, parsed.data);
      await deps.store.save(next);
      return c.json(next);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.post("/parse", gate("admin.settings.view"), async (c) => {
    const parsed = parseBarcodeRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const config = (await deps.store.get()) ?? createDefaultBarcodeConfig();
    const match = parseEmbeddedBarcode(config.embeddedRules, parsed.data.code);
    return c.json(match);
  });

  return app;
}

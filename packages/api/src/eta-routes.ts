import { Hono, type Context } from "hono";
import {
  EtaService,
  computeEtaReadiness,
  DuplicateEtaSubmissionError,
  EtaExclusionReasonRequiredError,
  EtaOfflineError,
  EtaSubmissionNotFoundError,
  InvalidEtaTransitionError,
  type EtaConfig,
  type EtaSubmission,
  type EtaSubmissionStatus,
} from "@mezan/domain";
import { updateEtaConfigSchema, excludeEtaSubmissionSchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

export interface EtaRoutesDeps {
  readonly service: EtaService;
  /** Stores the encrypted client secret (never returned). Wired to the persistence store. */
  readonly setClientSecret?: (secret: string) => Promise<void>;
}

function serializeConfig(config: EtaConfig) {
  return {
    config: {
      environment: config.environment,
      taxRegistrationNumber: config.taxRegistrationNumber,
      activityCode: config.activityCode,
      address: config.address,
      buyerDataThreshold: config.buyerDataThreshold,
      documentVersion: config.documentVersion,
      autoSubmitOnConfirm: config.autoSubmitOnConfirm,
      signingMethod: config.signingMethod,
      clientId: config.clientId,
      hasClientSecret: config.hasClientSecret,
    },
    readiness: computeEtaReadiness(config),
  };
}

function serializeSubmission(s: EtaSubmission) {
  return {
    id: s.id,
    internalId: s.internalId,
    documentType: s.documentType,
    status: s.status,
    etaUuid: s.etaUuid,
    errors: s.errors,
    exclusionReason: s.exclusionReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    submittedAt: s.submittedAt,
  };
}

function handleError(c: Context, err: unknown): Response {
  if (err instanceof EtaSubmissionNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
  if (err instanceof DuplicateEtaSubmissionError) return c.json({ error: err.code, message: err.message }, 409);
  if (err instanceof InvalidEtaTransitionError) return c.json({ error: err.code, message: err.message }, 422);
  if (err instanceof EtaExclusionReasonRequiredError) return c.json({ error: err.code, message: err.message }, 400);
  // The stubbed online transmit refusing offline is an expected, non-fatal state.
  if (err instanceof EtaOfflineError) return c.json({ error: err.code, message: err.message }, 202);
  throw err;
}

/**
 * الفاتورة الإلكترونية (ETA) routes (docs/catalog/04), mounted under `/eta`:
 *   GET  /config                       config + readiness
 *   PUT  /config                       update config (clientSecret stored, never returned)
 *   GET  /submissions[?status=]        the submission queue
 *   POST /submissions/:id/submit       submit one (online transmit is STUBBED)
 *   POST /submissions/submit-all       إرسال كل الجاهز
 *   POST /submissions/:id/accept       authority acceptance callback (demo/testing)
 *   POST /submissions/:id/exclude      مستبعد (reason required)
 * Permissions: eta.view (reads), eta.submit (config write + submit), eta.cancel (exclude).
 */
export function createEtaRoutes(
  deps: EtaRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const { service } = deps;

  app.get("/config", gate("accounting.eta.view"), async (c) => {
    return c.json(serializeConfig(await service.getConfig()));
  });

  app.put("/config", gate("accounting.eta.submit"), async (c) => {
    const parsed = updateEtaConfigSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const current = await service.getConfig();
    const { clientSecret, ...patch } = parsed.data;
    const next: EtaConfig = {
      ...current,
      ...patch,
      address: patch.address !== undefined ? patch.address : current.address,
    };
    await service.saveConfig(next);
    if (clientSecret && deps.setClientSecret) await deps.setClientSecret(clientSecret);
    return c.json(serializeConfig(await service.getConfig()));
  });

  app.get("/submissions", gate("accounting.eta.view"), async (c) => {
    const status = c.req.query("status") as EtaSubmissionStatus | undefined;
    const submissions = await service.list(status);
    return c.json(submissions.map(serializeSubmission));
  });

  app.post("/submissions/:id/submit", gate("accounting.eta.submit"), async (c) => {
    try {
      return c.json(serializeSubmission(await service.submit(c.req.param("id"))));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/submissions/submit-all", gate("accounting.eta.submit"), async (c) => {
    const result = await service.submitAllReady();
    return c.json({ submitted: result.submitted.map(serializeSubmission), queued: result.queued });
  });

  app.post("/submissions/:id/accept", gate("accounting.eta.submit"), async (c) => {
    let body: { etaUuid?: string } = {};
    try {
      body = (await c.req.json()) as { etaUuid?: string };
    } catch {
      body = {};
    }
    if (!body.etaUuid) return c.json({ error: "VALIDATION_ERROR", message: "etaUuid required" }, 400);
    try {
      return c.json(serializeSubmission(await service.markAccepted(c.req.param("id"), body.etaUuid)));
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/submissions/:id/exclude", gate("accounting.eta.cancel"), async (c) => {
    const parsed = excludeEtaSubmissionSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    try {
      return c.json(serializeSubmission(await service.exclude(c.req.param("id"), parsed.data.reason)));
    } catch (err) {
      return handleError(c, err);
    }
  });

  return app;
}

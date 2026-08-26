import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  ATTACHMENT_ENTITY_PERMISSIONS,
  AttachmentNotFoundError,
  DuplicateAttachmentIdError,
  InvalidAttachmentError,
  can,
  createAttachment,
  deleteAttachment,
  isAttachmentEntityType,
  type Attachment,
  type AttachmentEntityType,
  type AttachmentRepository,
  type AuthContext,
} from "@mezan/domain";
import { createAttachmentSchema } from "@mezan/contracts";
import { headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * المرفقات — `/attachments`. Files hang off a document (invoice, voucher, work
 * order) or an entity (item, customer, supplier, employee).
 *
 * An attachment carries NO permission of its own: every route resolves the
 * permission from the entity it is attached to, so whoever may not read a
 * supplier may not read that supplier's files either. That is why these routes
 * cannot use a fixed `gate("…")` — the code is only known once the entity type
 * is in hand.
 */

export interface AttachmentsRoutesDeps {
  readonly repo: AttachmentRepository;
  readonly resolveAuthContext?: AuthContextResolver;
}

function canView(ctx: AuthContext, entityType: AttachmentEntityType): boolean {
  return ATTACHMENT_ENTITY_PERMISSIONS[entityType].viewAny.some((code) => can(ctx, code));
}

function canManage(ctx: AuthContext, entityType: AttachmentEntityType): boolean {
  return can(ctx, ATTACHMENT_ENTITY_PERMISSIONS[entityType].manage);
}

function denied(c: Context, permission: string) {
  return c.json({ error: "PERMISSION_DENIED", permission, message: `Missing permission '${permission}'.` }, 403);
}

function serialize(attachment: Attachment) {
  return {
    id: attachment.id,
    entityType: attachment.entityType,
    entityId: attachment.entityId,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    uploadedBy: attachment.uploadedBy,
    uploadedAt: attachment.uploadedAt,
    notes: attachment.notes,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof AttachmentNotFoundError) return c.json({ error: err.code, message: err.message }, 404);
  if (err instanceof DuplicateAttachmentIdError) return c.json({ error: err.code, message: err.message }, 409);
  if (err instanceof InvalidAttachmentError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createAttachmentsRoutes(
  deps: AttachmentsRoutesDeps,
  resolveAuthContext: AuthContextResolver = deps.resolveAuthContext ?? headerAuthContextResolver,
) {
  const app = new Hono();

  const withAuth: MiddlewareHandler = async (c, next) => {
    c.set("attachmentAuth", await resolveAuthContext(c));
    await next();
  };
  const auth = (c: Context): AuthContext => c.get("attachmentAuth") as AuthContext;

  app.use("*", withAuth);

  /**
   * `?entityType=&entityId=` narrows to one entity's files; without them the
   * route lists every attachment the caller's permissions already let them
   * read, which is what makes it a checkable list surface (`pnpm check:seed`).
   */
  app.get("/", async (c) => {
    const ctx = auth(c);
    const entityType = c.req.query("entityType");
    const entityId = c.req.query("entityId");

    if (entityType !== undefined) {
      if (!isAttachmentEntityType(entityType)) {
        return c.json({ error: "VALIDATION_ERROR", message: `Unknown entityType '${entityType}'.` }, 400);
      }
      if (!canView(ctx, entityType)) return denied(c, ATTACHMENT_ENTITY_PERMISSIONS[entityType].viewAny[0]!);
      const rows = entityId
        ? await deps.repo.list(entityType, entityId)
        : (await deps.repo.listAll()).filter((row) => row.entityType === entityType);
      return c.json(rows.map(serialize));
    }

    const all = await deps.repo.listAll();
    return c.json(all.filter((row) => canView(ctx, row.entityType)).map(serialize));
  });

  app.get("/:id", async (c) => {
    const found = await deps.repo.findById(c.req.param("id"));
    if (!found) return c.json({ error: "ATTACHMENT_NOT_FOUND", message: "Attachment not found." }, 404);
    if (!canView(auth(c), found.entityType)) {
      return denied(c, ATTACHMENT_ENTITY_PERMISSIONS[found.entityType].viewAny[0]!);
    }
    return c.json(serialize(found));
  });

  /**
   * The bytes come back base64 inside JSON rather than as a raw body: the
   * desktop shell reaches this same app over an IPC bridge that marshals the
   * response as a string, so a binary body would arrive corrupted there.
   */
  app.get("/:id/content", async (c) => {
    const content = await deps.repo.readContent(c.req.param("id"));
    if (!content) return c.json({ error: "ATTACHMENT_NOT_FOUND", message: "Attachment not found." }, 404);
    if (!canView(auth(c), content.attachment.entityType)) {
      return denied(c, ATTACHMENT_ENTITY_PERMISSIONS[content.attachment.entityType].viewAny[0]!);
    }
    return c.json({
      ...serialize(content.attachment),
      contentBase64: Buffer.from(content.bytes).toString("base64"),
    });
  });

  app.post("/", async (c) => {
    const parsed = createAttachmentSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const ctx = auth(c);
    if (!canManage(ctx, parsed.data.entityType)) {
      return denied(c, ATTACHMENT_ENTITY_PERMISSIONS[parsed.data.entityType].manage);
    }
    try {
      const attachment = await createAttachment(
        {
          id: parsed.data.id,
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          fileName: parsed.data.fileName,
          mimeType: parsed.data.mimeType,
          notes: parsed.data.notes,
          bytes: new Uint8Array(Buffer.from(parsed.data.contentBase64, "base64")),
          uploadedBy: ctx.userId,
        },
        deps.repo,
      );
      return c.json(serialize(attachment), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", async (c) => {
    const found = await deps.repo.findById(c.req.param("id"));
    if (!found) return c.json({ error: "ATTACHMENT_NOT_FOUND", message: "Attachment not found." }, 404);
    if (!canManage(auth(c), found.entityType)) {
      return denied(c, ATTACHMENT_ENTITY_PERMISSIONS[found.entityType].manage);
    }
    try {
      await deleteAttachment(found.id, deps.repo);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

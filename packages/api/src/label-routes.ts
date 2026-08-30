import { Hono, type Context } from "hono";
import {
  createLabelLayout,
  updateLabelLayout,
  deleteLabelLayout,
  DuplicateLabelLayoutCodeError,
  InvalidLabelLayoutError,
  LabelLayoutNotFoundError,
  type LabelLayout,
  type LabelLayoutRepository,
} from "@mezan/domain";
import { createLabelLayoutSchema, updateLabelLayoutSchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/**
 * `/label-layouts` — تخطيطات الملصقات (docs/archive/catalog/03 §"طباعة الباركود
 * والملصقات"): the sticker-sheet geometry the label-printing screen renders
 * through the shared print pipeline. Reference data for the item catalog, so
 * it is gated with the same `inventory.item.*` permissions.
 */

function serialize(layout: LabelLayout) {
  return {
    id: layout.id,
    code: layout.code,
    nameAr: layout.nameAr,
    pageSize: layout.pageSize,
    columns: layout.columns,
    rows: layout.rows,
    labelWidthMm: layout.labelWidthMm,
    labelHeightMm: layout.labelHeightMm,
    columnGapMm: layout.columnGapMm,
    rowGapMm: layout.rowGapMm,
    marginBlockMm: layout.marginBlockMm,
    marginInlineMm: layout.marginInlineMm,
    showItemName: layout.showItemName,
    showItemCode: layout.showItemCode,
    showPrice: layout.showPrice,
    showUnit: layout.showUnit,
    showBarcode: layout.showBarcode,
    showBarcodeText: layout.showBarcodeText,
    barcodeHeightMm: layout.barcodeHeightMm,
    active: layout.active,
  };
}

function handleDomainError(c: Context, err: unknown) {
  if (err instanceof LabelLayoutNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateLabelLayoutCodeError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidLabelLayoutError) {
    return c.json({ error: err.code, message: err.message, reasons: err.reasons }, 422);
  }
  throw err;
}

export function createLabelLayoutsRouter(
  layouts: LabelLayoutRepository,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("inventory.item.view"), async (c) => {
    return c.json((await layouts.list()).map(serialize));
  });

  app.get("/:id", gate("inventory.item.view"), async (c) => {
    const layout = await layouts.findById(c.req.param("id"));
    if (!layout) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serialize(layout));
  });

  app.post("/", gate("inventory.item.create"), async (c) => {
    const parsed = createLabelLayoutSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      return c.json(serialize(await createLabelLayout(parsed.data, layouts)), 201);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.patch("/:id", gate("inventory.item.edit"), async (c) => {
    const parsed = updateLabelLayoutSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    try {
      return c.json(serialize(await updateLabelLayout(c.req.param("id"), parsed.data, layouts)));
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  app.delete("/:id", gate("inventory.item.edit"), async (c) => {
    try {
      await deleteLabelLayout(c.req.param("id"), layouts);
      return c.body(null, 204);
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}

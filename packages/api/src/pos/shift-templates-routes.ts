import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  InvalidShiftTemplateError,
  buildShiftTemplate,
  overlappingShiftTemplate,
  shiftCrossesMidnight,
  type BranchRepository,
  type ShiftTemplate,
  type ShiftTemplateRepository,
} from "@mezan/domain";
import { createShiftTemplateSchema, updateShiftTemplateSchema, type ShiftTemplateDTO } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "../permission-gate.js";
import { posDomainError, readJson, validationError } from "./http.js";

export interface ShiftTemplatesRoutesDeps {
  readonly shiftTemplates: ShiftTemplateRepository;
  readonly branches: BranchRepository;
}

function toWire(template: ShiftTemplate): ShiftTemplateDTO {
  return { ...template, crossesMidnight: shiftCrossesMidnight(template) };
}

/**
 * إعدادات الورديات — `/shift-templates`. Platform settings, not POS-licensed:
 * the HR roster uses the same templates.
 */
export function createShiftTemplatesRoutes(deps: ShiftTemplatesRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function check(template: ShiftTemplate): Promise<void> {
    if (template.branchId !== null && !(await deps.branches.findById(template.branchId))) {
      throw new InvalidShiftTemplateError(["الفرع المحدد غير موجود"]);
    }
    const clash = overlappingShiftTemplate(template, await deps.shiftTemplates.list());
    if (clash) {
      throw new InvalidShiftTemplateError([
        `تتداخل مع «${clash.nameAr}» (${clash.fromTime}–${clash.toTime}) — كل عملية تُحسب على وردية واحدة`,
      ]);
    }
  }

  app.get("/", gate("admin.settings.view"), async (c) => c.json((await deps.shiftTemplates.list()).map(toWire)));

  app.post("/", gate("admin.settings.edit"), async (c) => {
    const parsed = createShiftTemplateSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      const template = buildShiftTemplate(`SHIFT-${randomUUID()}`, parsed.data);
      await check(template);
      await deps.shiftTemplates.save(template);
      return c.json(toWire(template), 201);
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  app.put("/:id", gate("admin.settings.edit"), async (c) => {
    const current = await deps.shiftTemplates.findById(c.req.param("id"));
    if (!current) return c.json({ error: "NOT_FOUND", message: "الوردية غير موجودة" }, 404);
    const parsed = updateShiftTemplateSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      const next = buildShiftTemplate(current.id, parsed.data);
      await check(next);
      await deps.shiftTemplates.save(next);
      return c.json(toWire(next));
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  return app;
}

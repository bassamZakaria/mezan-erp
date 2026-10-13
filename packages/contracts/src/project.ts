import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/**
 * Wire contract for projects (docs/archive/catalog/07-mfg-projects-assets.md
 * "المشاريع والمقاولات"). Money (budget) crosses the wire as an exact
 * decimal string, never a float — the domain re-parses it via
 * `Money.fromMajor`.
 */
export const projectStatusSchema = z.enum(["planned", "active", "on_hold", "completed", "cancelled"]);

export const projectSchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable(),
  status: projectStatusSchema,
  customerId: z.string().nullable(),
  managerId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  budget: z.string(),
  siteAddress: z.string().nullable(),
  notes: z.string().nullable(),
  costCenterId: z.string().min(1),
});

export const createProjectSchema = z.object({
  id: clientSuppliedId,
  code: z.string().min(1),
  nameAr: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  budget: z.string().optional(),
  siteAddress: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  /**
   * An EXISTING cost centre to book this project against. Omitted, the project
   * gets a `PRJ-{code}` cost centre of its own, which is the usual case.
   *
   * `projectSchema` has always required `costCenterId` and neither the create
   * nor the update contract carried it, so the choice could not be made through
   * any surface and the Cost Centre P&L could only ever group by the auto-made
   * one (D95).
   */
  costCenterId: z.string().min(1).optional(),
});

/** All fields optional — a PATCH applies only what's supplied. */
export const updateProjectSchema = z.object({
  nameAr: z.string().min(1).optional(),
  nameEn: z.string().nullable().optional(),
  status: projectStatusSchema.optional(),
  customerId: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  budget: z.string().optional(),
  siteAddress: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // No `costCenterId` here on purpose: re-booking a live project against a
  // different cost centre moves every cost already posted under the old one,
  // which is an accounting decision and not a patch field. Choosing it at
  // CREATE is what D95 was about.
});

export type ProjectStatusDTO = z.infer<typeof projectStatusSchema>;
export type ProjectDTO = z.infer<typeof projectSchema>;
export type CreateProjectDTO = z.infer<typeof createProjectSchema>;
export type UpdateProjectDTO = z.infer<typeof updateProjectSchema>;

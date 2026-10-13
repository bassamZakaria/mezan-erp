import { z } from "zod";
import { clientSuppliedId } from "./client-supplied-id.js";

/** Wire contract for a branch (docs/archive/catalog/09 §"إدارة الفروع"). */
export const branchSchema = z.object({
  id: z.string().min(1),
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().min(1),
  parentBranchId: z.string().min(1).nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  isMain: z.boolean(),
  active: z.boolean(),
});

/** POST /branches body. */
export const createBranchSchema = z.object({
  id: clientSuppliedId,
  code: z.string().regex(/^[A-Z0-9_-]{1,20}$/),
  name: z.string().min(1),
  parentBranchId: z.string().min(1).nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  isMain: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** PUT /branches/:id body — every field but id optional. */
export const updateBranchSchema = branchSchema.omit({ id: true }).partial();

/** GET /branches/lookup — what a branch picker may offer this session. */
export const branchLookupSchema = z.object({
  branches: z.array(branchSchema.pick({ id: true, code: true, name: true, isMain: true, active: true })),
  /** Whether the session is granted specific branches rather than all of them. */
  restricted: z.boolean(),
  /** Whether the session may read postings that carry no branch («غير مخصص»). */
  unattributed: z.boolean(),
});

export type BranchLookupDTO = z.infer<typeof branchLookupSchema>;
export type BranchDTO = z.infer<typeof branchSchema>;
export type CreateBranchDTO = z.infer<typeof createBranchSchema>;
export type UpdateBranchDTO = z.infer<typeof updateBranchSchema>;

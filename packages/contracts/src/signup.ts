import { z } from "zod";
import { planSchema } from "./platform.js";

/**
 * Public, session-less contracts served under `/api/signup` — anyone on the
 * internet can call them, so every response here is deliberately thin.
 * Self-serve account creation was removed; accounts are created from the
 * platform console only.
 */

/** What a visitor is allowed to know about a plan — no `features`, no `sortOrder`/`createdAt` internals. */
export const publicPlanSchema = planSchema.pick({
  id: true,
  code: true,
  nameAr: true,
  nameEn: true,
  kind: true,
  modules: true,
  seatsIncluded: true,
  branchesIncluded: true,
  warehousesIncluded: true,
  quotas: true,
  priceMonthly: true,
  priceYearly: true,
  trialDays: true,
  soldOut: true,
});

export const ownerHandOverRequestSchema = z.object({
  token: z.string().min(20),
});

export type PublicPlanDTO = z.infer<typeof publicPlanSchema>;
export type OwnerHandOverRequestDTO = z.infer<typeof ownerHandOverRequestSchema>;

// CONTRACT: the cloud server stamps this meta tag into index.html and the web app reads it to open the public landing page at `/`.
export const CLOUD_SITE_META = { name: "mezan-site", content: "cloud" } as const;

export const siteStatusSchema = z.object({
  contact: z.object({ email: z.string().nullable(), phone: z.string().nullable(), whatsapp: z.string().nullable() }),
});

export type SiteStatusDTO = z.infer<typeof siteStatusSchema>;

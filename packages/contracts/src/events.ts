import { z } from "zod";

/**
 * Wire contract for a domain-event envelope pushed over the realtime transport
 * (docs/plan.md §2.6/§5.6). The `code` is validated as a non-empty string here;
 * the authoritative closed set of codes lives in the versioned catalog in
 * @mezan/domain, which both ends import — the wire schema stays permissive so a
 * newer publisher never trips an older validator on an unknown-but-valid code.
 */
export const domainEventSchema = z.object({
  code: z.string().min(1),
  occurredAt: z.string().min(1), // ISO-8601 UTC
  payload: z.unknown(),
});

export type DomainEventDTO = z.infer<typeof domainEventSchema>;

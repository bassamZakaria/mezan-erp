import { z } from "zod";

/**
 * Wire contracts for LAN multi-till session management (docs/archive/plan.md
 * §2.6/§6.3.3). A "device session" is one connected till/tablet; these
 * schemas validate the `/lan/sessions` request/response bodies exposed by
 * @mezan/api and consumed by the connected-devices admin panel in apps/web.
 */

export const deviceSessionSchema = z.object({
  /** Server-derived seat key — the client must treat this as opaque. */
  sessionId: z.string().min(1),
  /** Which signed-in account holds this seat. */
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceLabel: z.string().min(1),
  appVersion: z.string().optional(),
  connectedAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});

/**
 * NO `sessionId` here on purpose — the caller used to name its own seat
 * identity, which let any signed-in account loop with a fresh random id and
 * burn every seat (PR #54 review finding #1: never trust an identifier the
 * caller supplied for a limit). The seat key is now derived server-side from
 * the authenticated session plus `deviceId`; the caller may still name its
 * device and a human label for it.
 */
export const connectDeviceRequestSchema = z.object({
  deviceId: z.string().min(1),
  deviceLabel: z.string().min(1).optional(),
  appVersion: z.string().trim().min(1).max(40).optional(),
});

export const lanStatusSchema = z.object({
  licensed: z.boolean(),
  seats: z.number().int().nonnegative(),
  connected: z.number().int().nonnegative(),
});

export const lanSessionsListSchema = z.object({
  seats: z.number().int().nonnegative(),
  connected: z.number().int().nonnegative(),
  sessions: z.array(deviceSessionSchema),
});

export type DeviceSessionDTO = z.infer<typeof deviceSessionSchema>;
export type ConnectDeviceRequestDTO = z.infer<typeof connectDeviceRequestSchema>;
export type LanStatusDTO = z.infer<typeof lanStatusSchema>;
export type LanSessionsListDTO = z.infer<typeof lanSessionsListSchema>;

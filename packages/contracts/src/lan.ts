import { z } from "zod";

/**
 * Wire contracts for LAN multi-till session management (docs/archive/plan.md
 * §2.6/§6.3.3). A "device session" is one connected till/tablet; these
 * schemas validate the `/lan/sessions` request/response bodies exposed by
 * @mezan/api and consumed by the connected-devices admin panel in apps/web.
 */

export const deviceSessionSchema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceLabel: z.string().min(1),
  connectedAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});

export const connectDeviceRequestSchema = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceLabel: z.string().min(1).optional(),
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

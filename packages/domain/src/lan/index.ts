export { LAN_MULTI_TILL_FEATURE } from "./feature-flag.js";
export {
  connectDevice,
  disconnectDevice,
  reapStaleSessions,
  emptySeatSessions,
  withSeatLimit,
  SeatSessionRegistry,
  SeatLimitExceededError,
  UserSeatLimitExceededError,
  DeviceSessionNotFoundError,
  DEFAULT_MAX_SEATS_PER_USER,
  DEFAULT_STALE_AFTER_MS,
} from "./session-registry.js";
export type {
  DeviceSession,
  SeatSessionsState,
  ConnectDeviceInput,
  SeatSessionRegistryOptions,
} from "./session-registry.js";

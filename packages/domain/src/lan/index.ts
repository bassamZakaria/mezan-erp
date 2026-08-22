export { LAN_MULTI_TILL_FEATURE } from "./feature-flag.js";
export {
  connectDevice,
  disconnectDevice,
  emptySeatSessions,
  withSeatLimit,
  SeatSessionRegistry,
  SeatLimitExceededError,
  DeviceSessionNotFoundError,
} from "./session-registry.js";
export type {
  DeviceSession,
  SeatSessionsState,
  ConnectDeviceInput,
} from "./session-registry.js";

export {
  AUDIT_SEVERITIES,
  AUDIT_STREAMS,
  createAuditEvent,
  recordSecurityEvent,
  recordSensitiveEvent,
} from "./audit-event.js";
export type {
  AuditSeverity,
  AuditStream,
  AuditEvent,
  AuditEventInput,
  AuditSink,
} from "./audit-event.js";

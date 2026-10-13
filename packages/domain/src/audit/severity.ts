import type { AuditSeverity } from "./audit-event.js";

export enum AuditSeverityCode {
  Critical = "CRITICAL",
  Error = "ERROR",
  Warning = "WARNING",
  Info = "INFO",
}

export const AUDIT_SEVERITY_CODES = Object.values(AuditSeverityCode) satisfies readonly AuditSeverity[];

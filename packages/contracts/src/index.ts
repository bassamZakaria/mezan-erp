/**
 * @mezan/contracts — Zod schemas + inferred types shared by api, domain and web.
 *
 * This package is the single source of truth for over-the-wire shapes. It has
 * no dependency on domain, persistence, api or any driver, so every layer can
 * import it without pulling in a runtime.
 */
export {
  journalLineSchema,
  createJournalEntrySchema,
  type JournalLineDTO,
  type CreateJournalEntryDTO,
} from "./journal.js";

export {
  sequenceDefinitionSchema,
  nextNumberRequestSchema,
  nextNumberResponseSchema,
  type SequenceDefinitionDTO,
  type NextNumberRequestDTO,
  type NextNumberResponseDTO,
} from "./numbering.js";

export {
  auditSeveritySchema,
  auditStreamSchema,
  auditEventSchema,
  type AuditSeverityDTO,
  type AuditStreamDTO,
  type AuditEventDTO,
} from "./audit.js";

export { domainEventSchema, type DomainEventDTO } from "./events.js";

export {
  featureFlagsSchema,
  entitlementsSchema,
  licensePayloadSchema,
  type EntitlementsDTO,
  type LicensePayloadDTO,
} from "./entitlements.js";

export {
  deviceSessionSchema,
  connectDeviceRequestSchema,
  lanStatusSchema,
  lanSessionsListSchema,
  type DeviceSessionDTO,
  type ConnectDeviceRequestDTO,
  type LanStatusDTO,
  type LanSessionsListDTO,
} from "./lan.js";

export {
  accountTypeSchema,
  naturalBalanceSchema,
  accountStatusSchema,
  accountSchema,
  createAccountSchema,
  updateAccountSchema,
  type AccountTypeDTO,
  type NaturalBalanceDTO,
  type AccountStatusDTO,
  type AccountDTO,
  type CreateAccountDTO,
  type UpdateAccountDTO,
} from "./accounts.js";

/** Placeholder marker type until the full contract surface is filled in. */
export type ContractsPackage = "@mezan/contracts";

import type { BilingualReason } from "../collections/errors.js";
/**
 * محطات العمل (Work Stations) — the shop-floor positions a work order's
 * material issues and product receipts happen AT (R9.1).
 *
 * A station is a first-class entity precisely so the shop-floor panel can bind
 * to a real id: recording "خط التعبئة" as free text would make the movements
 * unqueryable and indistinguishable from a typo.
 */

import { InvalidManufacturingDocumentError } from "./errors.js";
import type { ActivationStatus } from "./types.js";

export interface WorkStation {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly notes: string | null;
  readonly status: ActivationStatus;
  readonly createdAt: string;
}

export interface WorkStationRepository {
  findById(id: string): Promise<WorkStation | null>;
  findByCode(code: string): Promise<WorkStation | null>;
  list(): Promise<WorkStation[]>;
  create(station: WorkStation): Promise<void>;
  update(station: WorkStation): Promise<void>;
}

export interface CreateWorkStationCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly notes?: string | null;
}

export interface WorkStationDeps {
  readonly stations: WorkStationRepository;
  readonly now?: () => string;
}

function nowIso(deps: WorkStationDeps): string {
  return deps.now ? deps.now() : new Date().toISOString();
}

export async function createWorkStation(
  command: CreateWorkStationCommand,
  deps: WorkStationDeps,
): Promise<WorkStation> {
  const reasons: BilingualReason[] = [];
  if (command.code.trim() === "") reasons.push({ ar: "محطة العمل تحتاج كوداً.", en: "A work station needs a code." });
  if (command.nameAr.trim() === "") reasons.push({ ar: "محطة العمل تحتاج اسماً بالعربية.", en: "A work station needs an Arabic name." });
  if (command.code.trim() !== "" && (await deps.stations.findByCode(command.code.trim()))) {
    reasons.push({ ar: `كود محطة العمل "${command.code.trim()}" مستخدم بالفعل.`, en: `Work station code "${command.code.trim()}" is already in use.` });
  }
  if (reasons.length > 0) throw new InvalidManufacturingDocumentError(reasons);

  const station: WorkStation = {
    id: command.id,
    code: command.code.trim(),
    nameAr: command.nameAr.trim(),
    nameEn: command.nameEn?.trim() || null,
    notes: command.notes ?? null,
    status: "active",
    createdAt: nowIso(deps),
  };
  await deps.stations.create(station);
  return station;
}

export async function setWorkStationStatus(
  id: string,
  status: ActivationStatus,
  deps: WorkStationDeps,
): Promise<WorkStation> {
  const station = await deps.stations.findById(id);
  if (!station) throw new InvalidManufacturingDocumentError([{ ar: `محطة العمل "${id}" غير موجودة.`, en: `Work station "${id}" was not found.` }]);
  const updated: WorkStation = { ...station, status };
  await deps.stations.update(updated);
  return updated;
}

/**
 * Resolves the station and the operator a shop-floor action names, refusing an
 * id that does not exist or a station that has been deactivated. The command
 * carries ids the client chose, so they are checked against the registry here
 * rather than trusted.
 */
export async function resolveWorkStation(
  stationId: string | null | undefined,
  deps: WorkStationDeps,
): Promise<string | null> {
  if (!stationId) return null;
  const station = await deps.stations.findById(stationId);
  if (!station) throw new InvalidManufacturingDocumentError([{ ar: `محطة العمل "${stationId}" غير موجودة.`, en: `Work station "${stationId}" was not found.` }]);
  if (station.status !== "active") {
    throw new InvalidManufacturingDocumentError([{ ar: `محطة العمل "${station.nameAr}" غير مفعّلة.`, en: `Work station "${station.nameEn ?? station.nameAr}" is not active.` }]);
  }
  return station.id;
}

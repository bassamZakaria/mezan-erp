import type { SecretHasher } from "../users/user.js";
import { normalizeEmail } from "../users/save-user.js";
import { isoTimestamp } from "./validation.js";
import { InvalidPlatformUserError, PlatformUserEmailTakenError } from "./errors.js";

export type PlatformRole = "owner" | "support";
export type PlatformUserStatus = "active" | "inactive";

export interface PlatformUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: PlatformRole;
  readonly status: PlatformUserStatus;
  readonly createdAt: string;
}

export interface PlatformUserRepository {
  findById(id: string): Promise<PlatformUser | null>;
  findByEmail(email: string): Promise<PlatformUser | null>;
  list(): Promise<PlatformUser[]>;
  save(user: PlatformUser): Promise<void>;
}

export interface CreatePlatformUserCommand {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly role: PlatformRole;
  readonly now: string;
}

export const MIN_PLATFORM_PASSWORD_LENGTH = 12;

export async function createPlatformUser(
  cmd: CreatePlatformUserCommand,
  repo: PlatformUserRepository,
  hasher: SecretHasher,
): Promise<PlatformUser> {
  const email = normalizeEmail(cmd.email);
  const now = isoTimestamp(cmd.now);
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("id is required");
  if (email === "") reasons.push("email is required");
  if (cmd.password.length < MIN_PLATFORM_PASSWORD_LENGTH) {
    reasons.push(`password must be at least ${MIN_PLATFORM_PASSWORD_LENGTH} characters`);
  }
  if (!now) reasons.push("now must be an ISO-8601 timestamp");
  if (reasons.length > 0) throw new InvalidPlatformUserError(reasons);
  if (await repo.findByEmail(email)) throw new PlatformUserEmailTakenError(email);
  const user: PlatformUser = {
    id: cmd.id,
    email,
    passwordHash: await hasher.hash(cmd.password),
    role: cmd.role,
    status: "active",
    createdAt: now as string,
  };
  await repo.save(user);
  return user;
}

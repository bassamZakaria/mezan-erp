import type { SecretHasher } from "../users/user.js";
import { normalizeEmail } from "../users/save-user.js";
import { isoTimestamp } from "./validation.js";
import { InvalidPlatformUserError, PlatformUserEmailTakenError, PlatformUserNotFoundError } from "./errors.js";

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
  if (!now || reasons.length > 0) throw new InvalidPlatformUserError(reasons);
  if (await repo.findByEmail(email)) throw new PlatformUserEmailTakenError(email);
  const user: PlatformUser = {
    id: cmd.id,
    email,
    passwordHash: await hasher.hash(cmd.password),
    role: cmd.role,
    status: "active",
    createdAt: now,
  };
  await repo.save(user);
  return user;
}

export interface VerifyPlatformLoginCommand {
  readonly email: string;
  readonly password: string;
}

/** Never used to authenticate; only to spend the same hasher cost an unknown or inactive account would. */
const DECOY_SECRET = "mezan-platform-login-timing-decoy";

/** One memoised decoy hash per hasher instance, so it is computed at most once — mirrors auth-routes.ts. */
const decoyHashes = new WeakMap<SecretHasher, Promise<string>>();

function decoyHashFor(hasher: SecretHasher): Promise<string> {
  let decoy = decoyHashes.get(hasher);
  if (!decoy) {
    decoy = hasher.hash(DECOY_SECRET);
    decoyHashes.set(hasher, decoy);
  }
  return decoy;
}

export async function verifyPlatformLogin(
  cmd: VerifyPlatformLoginCommand,
  repo: PlatformUserRepository,
  hasher: SecretHasher,
): Promise<PlatformUser | null> {
  const email = normalizeEmail(cmd.email);
  const user = await repo.findByEmail(email);
  const ok =
    user && user.status === "active"
      ? await hasher.verify(cmd.password, user.passwordHash)
      : (await hasher.verify(cmd.password, await decoyHashFor(hasher)), false);
  return user && ok ? user : null;
}

export interface DeactivatePlatformUserCommand {
  readonly id: string;
  readonly actorId: string;
}

export async function deactivatePlatformUser(
  cmd: DeactivatePlatformUserCommand,
  repo: PlatformUserRepository,
): Promise<PlatformUser> {
  if (cmd.id === cmd.actorId) throw new InvalidPlatformUserError(["لا يمكنك تعطيل حسابك"]);
  const user = await repo.findById(cmd.id);
  if (!user) throw new PlatformUserNotFoundError(cmd.id);
  if (user.role === "owner" && user.status === "active") {
    const users = await repo.list();
    const activeOwners = users.filter((u) => u.role === "owner" && u.status === "active");
    if (activeOwners.length <= 1) throw new InvalidPlatformUserError(["لا يمكن تعطيل آخر مالك للمنصة"]);
  }
  const next: PlatformUser = { ...user, status: "inactive" };
  await repo.save(next);
  return next;
}

import { ApiKeyAlreadyRevokedError, ApiKeyNotFoundError } from "./errors.js";
import type { ApiKey, ApiKeyRepository } from "./api-key.js";

/** Revokes an API key. Idempotent revocation is rejected — the timestamp of the FIRST revoke is the record. */
export async function revokeApiKey(
  id: string,
  repo: ApiKeyRepository,
  revokedAt: string = new Date().toISOString(),
): Promise<ApiKey> {
  const key = await repo.findById(id);
  if (!key) throw new ApiKeyNotFoundError(id);
  if (key.revokedAt !== null) throw new ApiKeyAlreadyRevokedError(id);
  const next: ApiKey = { ...key, revokedAt };
  await repo.save(next);
  return next;
}

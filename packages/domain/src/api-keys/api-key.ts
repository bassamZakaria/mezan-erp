/**
 * API keys (settings §API keys) — issued, named credentials that scope to a
 * checklist of permissions from the SAME catalog the role editor reads
 * (`permissions/catalog.ts`), not a parallel scope vocabulary.
 *
 * Security invariant: only a hash of the key ever reaches storage. The
 * plaintext key exists for one HTTP response (creation) and is never
 * reconstructable afterwards — `keyHash` is one-way (the same `SecretHasher`
 * port `users/` uses), and `prefix` is the only fragment kept in the clear so
 * a key can be identified in a list without exposing it.
 */
export interface ApiKey {
  readonly id: string;
  readonly name: string;
  /** Short, non-secret fragment of the issued key (e.g. "mzk_a1b2c3d4") — shown in lists. */
  readonly prefix: string;
  /** One-way hash of the full key. The plaintext key is never stored. */
  readonly keyHash: string;
  /** Permission codes from `permissions/catalog.ts` — the key's granted scope. */
  readonly scopes: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface ApiKeyRepository {
  list(): Promise<ApiKey[]>;
  findById(id: string): Promise<ApiKey | null>;
  save(key: ApiKey): Promise<void>;
}

import type { UserPreferences } from "./user-preferences.js";

/** Port for per-user shell preferences — one row per user (see `./user-preferences.ts` on scoping). */
export interface UserPreferencesRepository {
  get(userId: string): Promise<UserPreferences | null>;
  save(preferences: UserPreferences): Promise<void>;
  /** Removes the stored row entirely, so the next read materialises the shipped default. */
  remove(userId: string): Promise<void>;
  /** Every stored row — the admin diagnosis surface lists who has customised what. */
  list(): Promise<readonly UserPreferences[]>;
}

export enum PlatformSettingKey {
  SignupMode = "signup_mode",
}

export interface PlatformSettingRepository {
  get(key: PlatformSettingKey): Promise<string | null>;
  set(key: PlatformSettingKey, value: string, nowIso: string): Promise<void>;
}

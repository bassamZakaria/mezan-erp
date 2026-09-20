import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { sessionSchema, type SessionDTO } from "@mezan/contracts";
import { z } from "zod";

const TOKEN_KEY = "mezan.session.token";
const PROFILE_KEY = "mezan.session.profile";
const CONNECTION_KEY = "mezan.connection";

/**
 * The token lives in the OS keystore and the rest of the session does not.
 * SecureStore refuses values much over 2 KB on Android, and a tenant admin's
 * resolved permission list is far larger than that — storing the whole session
 * there fails on exactly the accounts that matter most.
 */
const storedProfileSchema = sessionSchema.omit({ token: true });
type StoredProfile = z.infer<typeof storedProfileSchema>;

export const connectionSchema = z.object({
  baseUrl: z.string().min(1),
  tenantCode: z.string().nullable(),
  email: z.string().nullable(),
});
export type Connection = z.infer<typeof connectionSchema>;

export async function saveSession(session: SessionDTO): Promise<void> {
  const { token, ...profile } = session;
  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function loadSession(): Promise<SessionDTO | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  const raw = await AsyncStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  let profile: StoredProfile;
  try {
    const parsed = storedProfileSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    profile = parsed.data;
  } catch {
    return null;
  }
  return { ...profile, token };
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.removeItem(PROFILE_KEY);
}

export async function saveConnection(connection: Connection): Promise<void> {
  await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
}

export async function loadConnection(): Promise<Connection | null> {
  const raw = await AsyncStorage.getItem(CONNECTION_KEY);
  if (!raw) return null;
  try {
    const parsed = connectionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

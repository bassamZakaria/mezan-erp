import { cert, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import type { FirebaseAccounts, FirebaseIdentity } from "@mezan/backend";
import type { FirebaseEnv } from "./env.js";

const USER_NOT_FOUND = "auth/user-not-found";

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : undefined;
}

export function createFirebaseAccounts(config: FirebaseEnv, options: { readonly continueUrl?: string } = {}): FirebaseAccounts {
  if (config.authEmulatorHost) {
    // SECURITY: the emulator signs nothing; firebase-admin then accepts any token it is handed.
    if (process.env["NODE_ENV"] === "production") throw new Error("MEZAN_FIREBASE_AUTH_EMULATOR_HOST is refused when NODE_ENV=production");
    process.env["FIREBASE_AUTH_EMULATOR_HOST"] = config.authEmulatorHost;
  }
  const holdsAdminKey = config.serviceAccountJson !== undefined || config.authEmulatorHost !== undefined;
  const app: App = initializeApp(
    {
      projectId: config.projectId,
      ...(config.serviceAccountJson ? { credential: cert(JSON.parse(config.serviceAccountJson) as Record<string, string>) } : {}),
    },
    `mezan-${config.projectId}`,
  );
  const auth: Auth = getAuth(app);

  return {
    async verify(idToken: string): Promise<FirebaseIdentity | null> {
      try {
        // Revocation and a disabled account can only be read with the admin key.
        const token = await auth.verifyIdToken(idToken, holdsAdminKey);
        if (!token.email) return null;
        return { email: token.email, emailVerified: token.email_verified === true, authTimeSeconds: token.auth_time };
      } catch {
        return null;
      }
    },

    async setPasswordLink(email: string, displayName: string): Promise<string | null> {
      if (!holdsAdminKey) return null;
      try {
        await auth.getUserByEmail(email);
      } catch (err) {
        if (errorCode(err) !== USER_NOT_FOUND) throw err;
        // SECURITY: marked verified because the only way to set its password is the link mailed to this address.
        await auth.createUser({ email, emailVerified: true, displayName });
      }
      const link = await auth.generatePasswordResetLink(email, options.continueUrl ? { url: options.continueUrl } : undefined);
      const url = new URL(link);
      url.searchParams.set("lang", "ar");
      return url.toString();
    },
  };
}

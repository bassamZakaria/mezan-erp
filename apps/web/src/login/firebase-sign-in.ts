import type { FirebaseWebConfigDTO } from "@mezan/contracts";
import type { Auth } from "firebase/auth";

export enum FirebaseFailure {
  WrongCredentials = "wrong-credentials",
  TooManyAttempts = "too-many-attempts",
  Disabled = "disabled",
  NotRegistered = "not-registered",
  Cancelled = "cancelled",
  Network = "network",
  Other = "other",
}

export class FirebaseSignInError extends Error {
  constructor(readonly failure: FirebaseFailure) {
    super(failure);
    this.name = "FirebaseSignInError";
  }
}

const FAILURE_BY_CODE: Readonly<Record<string, FirebaseFailure>> = {
  "auth/invalid-credential": FirebaseFailure.WrongCredentials,
  "auth/invalid-login-credentials": FirebaseFailure.WrongCredentials,
  "auth/wrong-password": FirebaseFailure.WrongCredentials,
  "auth/user-not-found": FirebaseFailure.WrongCredentials,
  "auth/invalid-email": FirebaseFailure.WrongCredentials,
  "auth/too-many-requests": FirebaseFailure.TooManyAttempts,
  "auth/user-disabled": FirebaseFailure.Disabled,
  "auth/admin-restricted-operation": FirebaseFailure.NotRegistered,
  "auth/popup-closed-by-user": FirebaseFailure.Cancelled,
  "auth/cancelled-popup-request": FirebaseFailure.Cancelled,
  "auth/network-request-failed": FirebaseFailure.Network,
};

function failureOf(err: unknown): FirebaseSignInError {
  const code = typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : "";
  return new FirebaseSignInError(FAILURE_BY_CODE[code] ?? FirebaseFailure.Other);
}

const authByProject = new Map<string, Promise<Auth>>();

function authFor(config: FirebaseWebConfigDTO): Promise<Auth> {
  const known = authByProject.get(config.projectId);
  if (known) return known;
  const created = (async () => {
    const [{ initializeApp }, { initializeAuth, inMemoryPersistence, browserPopupRedirectResolver, connectAuthEmulator }] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
    ]);
    const app = initializeApp({ apiKey: config.apiKey, authDomain: config.authDomain, projectId: config.projectId, appId: config.appId }, `mezan-${config.projectId}`);
    // SECURITY: the Mezan session cookie is the session; nothing of Firebase's is left in the browser after sign-in.
    const auth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
    auth.languageCode = "ar";
    if (config.authEmulatorUrl) connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
    return auth;
  })();
  authByProject.set(config.projectId, created);
  return created;
}

async function tokenOf(auth: Auth, signIn: () => Promise<{ user: { getIdToken(): Promise<string> } }>): Promise<string> {
  try {
    const { user } = await signIn();
    const token = await user.getIdToken();
    await auth.signOut();
    return token;
  } catch (err) {
    throw failureOf(err);
  }
}

export async function firebasePasswordToken(config: FirebaseWebConfigDTO, email: string, password: string): Promise<string> {
  const auth = await authFor(config);
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  return tokenOf(auth, () => signInWithEmailAndPassword(auth, email.trim(), password));
}

export async function firebaseGoogleToken(config: FirebaseWebConfigDTO, email?: string): Promise<string> {
  const auth = await authFor(config);
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters(email ? { prompt: "select_account", login_hint: email } : { prompt: "select_account" });
  return tokenOf(auth, () => signInWithPopup(auth, provider));
}

export async function firebaseSendPasswordReset(config: FirebaseWebConfigDTO, email: string): Promise<void> {
  const auth = await authFor(config);
  const { sendPasswordResetEmail } = await import("firebase/auth");
  try {
    await sendPasswordResetEmail(auth, email.trim(), { url: window.location.origin });
  } catch (err) {
    const failure = failureOf(err);
    // The same answer whether or not the address has an account.
    if (failure.failure !== FirebaseFailure.WrongCredentials) throw failure;
  }
}

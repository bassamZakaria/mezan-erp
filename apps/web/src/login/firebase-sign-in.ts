import type { FirebaseWebConfigDTO, SignInConfigDTO } from "@mezan/contracts";
import type { Auth } from "firebase/auth";
import type { AppTranslationKey } from "../i18n";

export enum FirebaseFailure {
  WrongCredentials = "wrong-credentials",
  TooManyAttempts = "too-many-attempts",
  Disabled = "disabled",
  NotRegistered = "not-registered",
  Cancelled = "cancelled",
  PopupBlocked = "popup-blocked",
  InvalidEmail = "invalid-email",
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
  "auth/invalid-email": FirebaseFailure.InvalidEmail,
  "auth/popup-blocked": FirebaseFailure.PopupBlocked,
  "auth/too-many-requests": FirebaseFailure.TooManyAttempts,
  "auth/user-disabled": FirebaseFailure.Disabled,
  "auth/admin-restricted-operation": FirebaseFailure.NotRegistered,
  "auth/popup-closed-by-user": FirebaseFailure.Cancelled,
  "auth/cancelled-popup-request": FirebaseFailure.Cancelled,
  "auth/network-request-failed": FirebaseFailure.Network,
};

export const FIREBASE_FAILURE_KEYS: Readonly<Record<FirebaseFailure, AppTranslationKey | null>> = {
  [FirebaseFailure.WrongCredentials]: "login.firebase.wrongCredentials",
  [FirebaseFailure.TooManyAttempts]: "login.tooManyAttempts",
  [FirebaseFailure.Disabled]: "login.firebase.disabled",
  [FirebaseFailure.NotRegistered]: "login.firebase.notRegistered",
  [FirebaseFailure.Cancelled]: null,
  [FirebaseFailure.PopupBlocked]: "login.firebase.popupBlocked",
  [FirebaseFailure.InvalidEmail]: "login.firebase.invalidEmail",
  [FirebaseFailure.Network]: "login.firebase.network",
  [FirebaseFailure.Other]: "login.error.generic",
};

function failureOf(err: unknown): FirebaseSignInError {
  const code = typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : "";
  return new FirebaseSignInError(FAILURE_BY_CODE[code] ?? FirebaseFailure.Other);
}

export const SIGN_IN_CONFIG_PATH = "/platform/sign-in-config";
export const SIGN_IN_CONFIG_KEY = ["platform", "sign-in-config"] as const;
const NO_PLATFORM_IN_FRONT = 404;

/** Only a host with no platform in front (desktop, LAN) answers "no Firebase"; any other failure is retried, never read as one. */
export async function fetchSignInConfig(get: () => Promise<{ readonly ok: boolean; readonly status: number; json<T>(): Promise<T> }>): Promise<SignInConfigDTO> {
  const res = await get();
  if (res.status === NO_PLATFORM_IN_FRONT) return { firebase: null };
  if (!res.ok) throw new Error(`sign-in config answered ${res.status}`);
  return res.json<SignInConfigDTO>();
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
    if (config.authEmulatorUrl) connectAuthEmulator(auth, config.authEmulatorUrl, { disableWarnings: true });
    return auth;
  })();
  authByProject.set(config.projectId, created);
  return created;
}

/** Loads the SDK ahead of the click: a popup opened after a slow import loses the user gesture and is blocked. */
export function prepareFirebase(config: FirebaseWebConfigDTO): void {
  void authFor(config).catch(() => undefined);
}

async function readyAuth(config: FirebaseWebConfigDTO): Promise<Auth> {
  const auth = await authFor(config);
  auth.languageCode = document.documentElement.lang || "ar";
  return auth;
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
  const auth = await readyAuth(config);
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  return tokenOf(auth, () => signInWithEmailAndPassword(auth, email.trim(), password));
}

export async function firebaseGoogleToken(config: FirebaseWebConfigDTO, email?: string): Promise<string> {
  const auth = await readyAuth(config);
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters(email ? { prompt: "select_account", login_hint: email } : { prompt: "select_account" });
  return tokenOf(auth, () => signInWithPopup(auth, provider));
}

export async function firebaseSendPasswordReset(config: FirebaseWebConfigDTO, email: string): Promise<void> {
  const auth = await readyAuth(config);
  const { sendPasswordResetEmail } = await import("firebase/auth");
  try {
    await sendPasswordResetEmail(auth, email.trim(), { url: window.location.origin });
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? err.code : "";
    // The same answer whether or not the address has an account.
    if (code !== "auth/user-not-found") throw failureOf(err);
  }
}

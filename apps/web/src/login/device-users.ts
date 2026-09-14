import type { SessionDTO } from "@mezan/contracts";
import { loadTenantCode } from "../data/session";

/**
 * WHO IS ON THIS DEVICE.
 *
 * The login screen offers faces instead of a typed username, so it needs a
 * list of people — and that list is deliberately NOT the staff roster. It is
 * only who has actually signed in on THIS machine, remembered locally, because
 * an ERP that prints every employee's name and role to whoever opens the lid
 * has leaked something for nothing. A fresh install shows one face, or none.
 *
 * `pinHash` is never stored. This is a list of names to click, not a
 * credential store: the server still verifies the PIN on every sign-in.
 */
const KEY = "mezan.deviceUsers";
const LIMIT = 3;

/**
 * A SaaS "code" tenant shares ONE browser origin across every company, so a
 * plain `mezan.deviceUsers` key would print one tenant's staff on another
 * tenant's login screen. Namespaced by the tenant code once one is stored;
 * the desktop build (and cloud "subdomain" mode, one origin per tenant
 * already) never has a code here, so it keeps the old unscoped key.
 */
function storageKey(): string {
  const code = loadTenantCode();
  return code ? `${KEY}.${code}` : KEY;
}

export interface DeviceUser {
  email: string;
  nameAr: string;
  nameEn?: string | null;
  initials: string;
  role: string;
  /** Last known profile photo, so the face row is a face and not two letters. */
  photoUrl?: string | null;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "؟";
  const first = [...(parts[0] ?? "")][0] ?? "";
  const second = [...(parts[1] ?? "")][0] ?? "";
  return second ? `${first}.${second}` : first;
}

export function readDeviceUsers(): DeviceUser[] {
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u): u is DeviceUser => typeof u === "object" && u !== null && typeof (u as DeviceUser).email === "string")
      .slice(0, LIMIT);
  } catch {
    // A corrupt or unavailable store must not block the login screen — the
    // typed-email path still works with no remembered faces at all.
    return [];
  }
}

/** Called after a successful sign-in; most recent first, capped at three. */
export function rememberDeviceUser(session: SessionDTO): void {
  const entry: DeviceUser = {
    email: session.email,
    nameAr: session.nameAr,
    nameEn: session.nameEn ?? null,
    initials: initialsOf(session.nameAr),
    role: session.roleCode ?? (session.isCompanyAdmin ? "admin" : ""),
    photoUrl: session.photoUrl ?? null,
  };
  try {
    const rest = readDeviceUsers().filter((u) => u.email !== entry.email);
    window.localStorage.setItem(storageKey(), JSON.stringify([entry, ...rest].slice(0, LIMIT)));
  } catch {
    // Remembering is a convenience; failing to remember is not a login failure.
  }
}

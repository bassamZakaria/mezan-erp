import { TenantResolveMode } from "@mezan/contracts";
import { isDesktopHost } from "../data/hooks";
import { pairingSupported } from "../lan/pairing-bridge";

export enum LookupHost {
  DesktopHost = "desktop_host",
  LanTill = "lan_till",
  Cloud = "cloud",
}

const PRIVATE_NETWORK = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/;

export function lookupHostOf(hostname: string = window.location.hostname): LookupHost {
  if (isDesktopHost()) return LookupHost.DesktopHost;
  const host = hostname.toLowerCase();
  if (pairingSupported() || PRIVATE_NETWORK.test(host) || host.endsWith(".local")) return LookupHost.LanTill;
  return LookupHost.Cloud;
}

export function holdsItsOwnBooks(host: LookupHost, noPlatformInFront: boolean): boolean {
  return host === LookupHost.DesktopHost || (host === LookupHost.Cloud && noPlatformInFront);
}

const LAST_MODE_KEY = "mezan.platformMode";
const MODES: readonly string[] = Object.values(TenantResolveMode);

export function rememberTenantMode(mode: TenantResolveMode): void {
  try {
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    return;
  }
}

export function lastTenantMode(): TenantResolveMode | null {
  try {
    const stored = localStorage.getItem(LAST_MODE_KEY);
    return stored !== null && MODES.includes(stored) ? (stored as TenantResolveMode) : null;
  } catch {
    return null;
  }
}

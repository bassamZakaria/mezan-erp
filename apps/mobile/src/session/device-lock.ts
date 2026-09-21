import { SecurityLevel, authenticateAsync, getEnrolledLevelAsync, hasHardwareAsync } from "expo-local-authentication";

/**
 * SECURITY: this is a gate on REOPENING the session already stored on this
 * device — the device's own owner check, nothing more. The server never sees
 * it and it proves no identity to the server, so it must never stand in for
 * the clock's biometric requirement, which verifies a WebAuthn signature the
 * phone cannot produce.
 */
export async function deviceCanConfirmOwner(): Promise<boolean> {
  try {
    if (!(await hasHardwareAsync())) return false;
    const level = await getEnrolledLevelAsync();
    return level === SecurityLevel.BIOMETRIC_WEAK || level === SecurityLevel.BIOMETRIC_STRONG;
  } catch {
    return false;
  }
}

export async function confirmDeviceOwner(promptMessage: string, cancelLabel: string): Promise<boolean> {
  try {
    const result = await authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: true });
    return result.success;
  } catch {
    return false;
  }
}

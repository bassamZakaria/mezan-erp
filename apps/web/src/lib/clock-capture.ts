import type { BiometricAssertionDTO, ClockChallengeDTO, ClockCredentialRegistrationDTO, GeoStampDTO, SelfieUploadDTO } from "@mezan/contracts";

export enum ClockCaptureFailure {
  InsecureContext = "insecure_context",
  NoCamera = "no_camera",
  CameraDenied = "camera_denied",
  NoWebAuthn = "no_webauthn",
  NoPlatformAuthenticator = "no_platform_authenticator",
  Cancelled = "cancelled",
  UnsupportedBrowser = "unsupported_browser",
}

export class ClockCaptureError extends Error {
  constructor(readonly failure: ClockCaptureFailure) {
    super(failure);
    this.name = "ClockCaptureError";
  }
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Why this device cannot answer a biometric check, or null when it can. */
export async function biometricUnavailableReason(): Promise<ClockCaptureFailure | null> {
  if (typeof window === "undefined" || !window.isSecureContext) return ClockCaptureFailure.InsecureContext;
  if (typeof window.PublicKeyCredential === "undefined" || !navigator.credentials) return ClockCaptureFailure.NoWebAuthn;
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available ? null : ClockCaptureFailure.NoPlatformAuthenticator;
  } catch {
    return ClockCaptureFailure.NoPlatformAuthenticator;
  }
}

export function cameraUnavailableReason(): ClockCaptureFailure | null {
  if (typeof window === "undefined" || !window.isSecureContext) return ClockCaptureFailure.InsecureContext;
  if (!navigator.mediaDevices?.getUserMedia) return ClockCaptureFailure.NoCamera;
  return null;
}

function isCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError");
}

export async function registerPlatformCredential(options: ClockChallengeDTO): Promise<ClockCredentialRegistrationDTO> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rp: { id: options.rpId, name: options.rpName },
        user: { id: fromBase64Url(options.userId), name: options.userName, displayName: options.userDisplayName },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        attestation: "none",
        timeout: options.timeoutMs,
      },
    });
  } catch (err) {
    throw new ClockCaptureError(isCancel(err) ? ClockCaptureFailure.Cancelled : ClockCaptureFailure.NoPlatformAuthenticator);
  }
  if (!(credential instanceof PublicKeyCredential)) throw new ClockCaptureError(ClockCaptureFailure.Cancelled);
  const response = credential.response as AuthenticatorAttestationResponse;
  if (typeof response.getPublicKey !== "function" || typeof response.getAuthenticatorData !== "function") {
    throw new ClockCaptureError(ClockCaptureFailure.UnsupportedBrowser);
  }
  const publicKey = response.getPublicKey();
  if (!publicKey) throw new ClockCaptureError(ClockCaptureFailure.UnsupportedBrowser);
  return {
    credentialId: toBase64Url(credential.rawId),
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.getAuthenticatorData()),
    publicKey: toBase64Url(publicKey),
    publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
  };
}

export async function assertPlatformCredential(options: ClockChallengeDTO): Promise<BiometricAssertionDTO> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64Url(options.challenge),
        rpId: options.rpId,
        allowCredentials: options.allowCredentialIds.map((id) => ({ type: "public-key" as const, id: fromBase64Url(id), transports: ["internal" as const] })),
        userVerification: "required",
        timeout: options.timeoutMs,
      },
    });
  } catch (err) {
    throw new ClockCaptureError(isCancel(err) ? ClockCaptureFailure.Cancelled : ClockCaptureFailure.NoPlatformAuthenticator);
  }
  if (!(credential instanceof PublicKeyCredential)) throw new ClockCaptureError(ClockCaptureFailure.Cancelled);
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: toBase64Url(credential.rawId),
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.authenticatorData),
    signature: toBase64Url(response.signature),
  };
}

export async function openFrontCamera(): Promise<MediaStream> {
  const reason = cameraUnavailableReason();
  if (reason) throw new ClockCaptureError(reason);
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) throw new ClockCaptureError(ClockCaptureFailure.CameraDenied);
    throw new ClockCaptureError(ClockCaptureFailure.NoCamera);
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** One JPEG frame, at most 640 px wide — a few tens of KB, well under the attachment cap. */
export async function captureFrame(video: HTMLVideoElement): Promise<SelfieUploadDTO> {
  const width = Math.min(640, video.videoWidth || 640);
  const height = Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || 640)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new ClockCaptureError(ClockCaptureFailure.NoCamera);
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) throw new ClockCaptureError(ClockCaptureFailure.NoCamera);
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { contentBase64: btoa(binary), mimeType: "image/jpeg" };
}

/** Best effort: a refused or slow fix clocks in without a location rather than blocking the punch. */
export function readLocation(timeoutMs = 8000): Promise<GeoStampDTO | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

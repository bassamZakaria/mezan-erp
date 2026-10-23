import {
  SignupModeCode,
  type PublicPlanDTO,
  type SignupCheckCodeResponseDTO,
  type SignupStatusDTO,
  type StartSignupRequestDTO,
  type StartSignupResultDTO,
  type VerifySignupRequestDTO,
  type VerifySignupResultDTO,
} from "@mezan/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createHttpTransport } from "../data/transport";

/**
 * The signup flow's own tiny transport. It talks to `/api/signup` directly —
 * never through `useApi()`'s `request()` — because that helper attaches a
 * tenant session and an `x-mezan-tenant` header, and there is no tenant yet
 * to attach: this is the one screen in the whole app that runs before any
 * tenant exists.
 */
const transport = createHttpTransport("/api/signup");

export enum SignupErrorCode {
  AlreadyActivated = "SIGNUP_ALREADY_ACTIVATED",
}

export class SignupApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "SignupApiError";
  }
}

async function readError(res: Awaited<ReturnType<typeof transport>>, fallback: string): Promise<SignupApiError> {
  try {
    const body = await res.json<{ message?: string; error?: string }>();
    return new SignupApiError(res.status, body.message ?? fallback, body.error ?? null);
  } catch {
    return new SignupApiError(res.status, fallback);
  }
}

export async function fetchPublicPlans(): Promise<PublicPlanDTO[]> {
  const res = await transport("/plans");
  if (!res.ok) throw await readError(res, "تعذّر تحميل الباقات");
  return res.json<PublicPlanDTO[]>();
}

export const PUBLIC_PLANS_QUERY_KEY = ["signup", "plans"] as const;

async function fetchSignupStatus(): Promise<SignupStatusDTO> {
  const res = await transport("/status");
  if (!res.ok) throw await readError(res, "تعذّر معرفة حالة التسجيل");
  return res.json<SignupStatusDTO>();
}

function useSignupStatus(): SignupStatusDTO | undefined {
  return useQuery<SignupStatusDTO>({ queryKey: ["signup", "status"], queryFn: fetchSignupStatus }).data;
}

/** Until the server answers, sign-up is treated as needing approval: never promise an instant account the server may refuse. */
export function useSignupMode(): SignupModeCode {
  return useSignupStatus()?.mode ?? SignupModeCode.Approval;
}

/** The WhatsApp number the platform owner set in the console, or null while there is none (every WhatsApp link stays hidden). */
export function useWhatsappNumber(): string | null {
  return useSignupStatus()?.contact.whatsapp ?? null;
}

export function useSiteContact(): SignupStatusDTO["contact"] | null {
  return useSignupStatus()?.contact ?? null;
}

export function usePublicPlans(): UseQueryResult<PublicPlanDTO[]> {
  return useQuery<PublicPlanDTO[]>({ queryKey: PUBLIC_PLANS_QUERY_KEY, queryFn: fetchPublicPlans });
}

/** `null` means the check itself failed (offline, 429, …) — distinct from a definite "taken". */
export async function checkCodeAvailability(code: string): Promise<boolean | null> {
  const res = await transport(`/check-code?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  const body = await res.json<SignupCheckCodeResponseDTO>();
  return body.available;
}

export async function startSignup(body: StartSignupRequestDTO): Promise<StartSignupResultDTO> {
  const res = await transport("", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res, "تعذّر إرسال طلب التسجيل");
  return res.json<StartSignupResultDTO>();
}

export async function verifySignup(token: string): Promise<VerifySignupResultDTO> {
  const body: VerifySignupRequestDTO = { token };
  const res = await transport("/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res, "تعذّر تفعيل الحساب");
  return res.json<VerifySignupResultDTO>();
}

export async function confirmOwnerHandOver(token: string): Promise<void> {
  const body: VerifySignupRequestDTO = { token };
  const res = await transport("/owner-handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res, "تعذّر تأكيد نقل الملكية");
}

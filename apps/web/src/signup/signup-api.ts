import type {
  PublicPlanDTO,
  SignupCheckCodeResponseDTO,
  StartSignupRequestDTO,
  StartSignupResultDTO,
  VerifySignupRequestDTO,
  VerifySignupResultDTO,
} from "@mezan/contracts";
import { createHttpTransport } from "../data/transport";

/**
 * The signup flow's own tiny transport. It talks to `/api/signup` directly —
 * never through `useApi()`'s `request()` — because that helper attaches a
 * tenant session and an `x-mezan-tenant` header, and there is no tenant yet
 * to attach: this is the one screen in the whole app that runs before any
 * tenant exists.
 */
const transport = createHttpTransport("/api/signup");

export class SignupApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SignupApiError";
  }
}

async function readError(res: Awaited<ReturnType<typeof transport>>, fallback: string): Promise<SignupApiError> {
  try {
    const body = await res.json<{ message?: string }>();
    return new SignupApiError(res.status, body.message ?? fallback);
  } catch {
    return new SignupApiError(res.status, fallback);
  }
}

export async function fetchPublicPlans(): Promise<PublicPlanDTO[]> {
  const res = await transport("/plans");
  if (!res.ok) throw await readError(res, "تعذّر تحميل الباقات");
  return res.json<PublicPlanDTO[]>();
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

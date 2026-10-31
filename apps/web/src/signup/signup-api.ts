import type { OwnerHandOverRequestDTO, PublicPlanDTO, SiteStatusDTO } from "@mezan/contracts";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createHttpTransport } from "../data/transport";
import { serverMessage, type ServerErrorBody } from "../data/server-message";

/**
 * The public site's own tiny transport. It talks to `/api/signup` directly —
 * never through `useApi()`'s `request()` — because that helper attaches a
 * tenant session and an `x-mezan-tenant` header, and these public pages have
 * no tenant to attach.
 */
const transport = createHttpTransport("/api/signup");

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
    const body = await res.json<ServerErrorBody>();
    return new SignupApiError(res.status, serverMessage(body) ?? fallback, body.error ?? null);
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

async function fetchSiteStatus(): Promise<SiteStatusDTO> {
  const res = await transport("/status");
  if (!res.ok) throw await readError(res, "تعذّر تحميل بيانات التواصل");
  return res.json<SiteStatusDTO>();
}

function useSiteStatus(): SiteStatusDTO | undefined {
  return useQuery<SiteStatusDTO>({ queryKey: ["site", "status"], queryFn: fetchSiteStatus }).data;
}

export function useWhatsappNumber(): string | null {
  return useSiteStatus()?.contact.whatsapp ?? null;
}

export function usePublicPlans(): UseQueryResult<PublicPlanDTO[]> {
  return useQuery<PublicPlanDTO[]>({ queryKey: PUBLIC_PLANS_QUERY_KEY, queryFn: fetchPublicPlans });
}

export async function confirmOwnerHandOver(token: string): Promise<void> {
  const body: OwnerHandOverRequestDTO = { token };
  const res = await transport("/owner-handover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(res, "تعذّر تأكيد نقل الملكية");
}

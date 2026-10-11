import { OwnerPinResetOutcome, TenantOwnerAccountNotFoundError, type PlatformHandle } from "@mezan/backend";
import type { OwnerPinResetResultDTO } from "@mezan/contracts";
import { TenantNotFoundError, type Tenant } from "@mezan/domain";
import { generateOwnerPin, platformActor } from "./provision-tenant.js";
import type { TenantRouter } from "./tenant-router.js";

export interface ResetTenantOwnerPinDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly pinOf?: () => string;
}

/** Resets the PIN of the account the platform records as the owner, found by user id so a renamed sign-in address cannot hide it. */
export async function resetTenantOwnerPin(
  deps: ResetTenantOwnerPinDeps,
  input: { readonly tenant: Tenant; readonly actorId: string },
): Promise<OwnerPinResetResultDTO> {
  const backend = await deps.router.backendFor(input.tenant.code);
  await deps.router.reconcileOwner(input.tenant.code);
  const tenant = await deps.platform.stores.tenants.findById(input.tenant.id);
  if (!tenant) throw new TenantNotFoundError(input.tenant.id);
  const account = await backend.ownerAccount(tenant.ownerUserId === null ? { email: tenant.ownerEmail } : { userId: tenant.ownerUserId });
  if (!account) throw new TenantOwnerAccountNotFoundError();
  const adminPin = (deps.pinOf ?? generateOwnerPin)();
  const outcome = await backend.resetOwnerPin({
    userId: account.id,
    email: account.email,
    pin: adminPin,
    onlyIfNeverSignedIn: false,
    actor: platformActor(input.actorId),
  });
  if (outcome !== OwnerPinResetOutcome.Reset) throw new TenantOwnerAccountNotFoundError();
  return { adminEmail: tenant.ownerEmail, signInEmail: account.email, adminPin };
}

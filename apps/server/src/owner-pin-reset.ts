import { OwnerPinResetOutcome, TenantOwnerAccountNotFoundError, type PlatformHandle } from "@mezan/backend";
import type { OwnerPinResetResultDTO } from "@mezan/contracts";
import { TenantNotFoundError, type Tenant } from "@mezan/domain";
import { generateOwnerPin, platformActor } from "./provision-tenant.js";
import type { TenantRouter } from "./tenant-router.js";

export interface ResetTenantOwnerPinDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly pinOf?: () => string;
  readonly now?: () => Date;
}

export async function resetTenantOwnerPin(
  deps: ResetTenantOwnerPinDeps,
  input: { readonly tenant: Tenant; readonly actorId: string },
): Promise<OwnerPinResetResultDTO> {
  const backend = await deps.router.backendOf(input.tenant.id);
  await deps.router.reconcileOwnerOf(input.tenant.id);
  const tenant = await deps.platform.stores.tenants.findById(input.tenant.id);
  if (!tenant) throw new TenantNotFoundError(input.tenant.id);
  const account = await backend.ownerAccount(tenant.ownerUserId === null ? { email: tenant.ownerEmail } : { userId: tenant.ownerUserId });
  if (!account) throw new TenantOwnerAccountNotFoundError();
  const adminPin = (deps.pinOf ?? generateOwnerPin)();
  // SECURITY: the console's PIN takes a fence of its own, newer than any signup
  // claim still in flight, so a holder that wakes up later cannot write over it.
  const fence = await deps.platform.stores.signupRequests.takeProvisionFence((deps.now ?? (() => new Date()))().toISOString());
  const outcome = await backend.resetOwnerPin({
    userId: account.id,
    email: account.email,
    pin: adminPin,
    onlyIfNeverSignedIn: false,
    actor: platformActor(input.actorId),
    fence,
  });
  if (outcome !== OwnerPinResetOutcome.Reset) throw new TenantOwnerAccountNotFoundError();
  return { adminEmail: tenant.ownerEmail, signInEmail: account.email, adminPin };
}

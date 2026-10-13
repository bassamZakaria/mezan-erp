import { OwnerPinResetOutcome, TenantOwnerAccountNotFoundError, type OwnerPinResetAccount, type PlatformHandle } from "@mezan/backend";
import type { OwnerPinResetResultDTO } from "@mezan/contracts";
import { TenantNotFoundError, type Tenant } from "@mezan/domain";
import { withSqliteTransaction } from "@mezan/persistence";
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
  input: { readonly tenant: Tenant; readonly actorId: string; readonly recordIntent?: (account: OwnerPinResetAccount) => Promise<void> },
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
  // REQUIRED ORDERING: the fence and the platform audit row of the intent are
  // one write, made before the PIN moves. An audit that cannot record leaves
  // the PIN as it was.
  const fence = await withSqliteTransaction(
    deps.platform.stores.sqlite,
    async () => {
      const taken = await deps.platform.stores.signupRequests.takeProvisionFence((deps.now ?? (() => new Date()))().toISOString());
      await input.recordIntent?.({ userId: account.id, signInEmail: account.email, adminEmail: tenant.ownerEmail });
      return taken;
    },
    "BEGIN IMMEDIATE",
  );
  const outcome = await backend.resetOwnerPin({
    userId: account.id,
    email: account.email,
    pin: adminPin,
    onlyIfNeverSignedIn: false,
    actor: platformActor(input.actorId),
    fence,
  });
  if (outcome !== OwnerPinResetOutcome.Reset) throw new TenantOwnerAccountNotFoundError(outcome);
  return { adminEmail: tenant.ownerEmail, signInEmail: account.email, adminPin };
}

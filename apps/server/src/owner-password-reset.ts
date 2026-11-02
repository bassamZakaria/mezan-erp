import { OwnerPasswordResetOutcome, TenantOwnerAccountNotFoundError, type OwnerPasswordResetAccount, type PlatformHandle } from "@mezan/backend";
import type { OwnerPasswordResetResultDTO } from "@mezan/contracts";
import { TenantNotFoundError, type Tenant } from "@mezan/domain";
import { TransactionMode } from "@mezan/persistence";
import { generateOwnerPassword, platformActor } from "./provision-tenant.js";
import type { TenantRouter } from "./tenant-router.js";

export interface ResetTenantOwnerPasswordDeps {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly passwordOf?: () => string;
  readonly now?: () => Date;
}

export async function resetTenantOwnerPassword(
  deps: ResetTenantOwnerPasswordDeps,
  input: { readonly tenant: Tenant; readonly actorId: string; readonly recordIntent?: (account: OwnerPasswordResetAccount) => Promise<void> },
): Promise<OwnerPasswordResetResultDTO> {
  const backend = await deps.router.backendOf(input.tenant.id);
  await deps.router.reconcileOwnerOf(input.tenant.id);
  const tenant = await deps.platform.stores.tenants.findById(input.tenant.id);
  if (!tenant) throw new TenantNotFoundError(input.tenant.id);
  const account = await deps.platform.outsideTheTurn(() => backend.ownerAccount(tenant.ownerUserId === null ? { email: tenant.ownerEmail } : { userId: tenant.ownerUserId }));
  if (!account) throw new TenantOwnerAccountNotFoundError();
  const adminPassword = (deps.passwordOf ?? generateOwnerPassword)();
  // SECURITY: the console's password takes a fence of its own, newer than any signup
  // claim still in flight, so a holder that wakes up later cannot write over it.
  // REQUIRED ORDERING: the fence and the platform audit row of the intent are
  // one write, made before the password moves. An audit that cannot record leaves
  // the password as it was.
  const fence = await deps.platform.stores.db.transaction(
    async () => {
      const taken = await deps.platform.stores.signupRequests.takeProvisionFence((deps.now ?? (() => new Date()))().toISOString());
      await input.recordIntent?.({ userId: account.id, signInEmail: account.email, adminEmail: tenant.ownerEmail });
      return taken;
    },
    TransactionMode.Immediate,
  );
  const outcome = await deps.platform.outsideTheTurn(() =>
    backend.resetOwnerPassword({
      userId: account.id,
      email: account.email,
      password: adminPassword,
      onlyIfNeverSignedIn: false,
      actor: platformActor(input.actorId),
      fence,
    }),
  );
  if (outcome !== OwnerPasswordResetOutcome.Reset) throw new TenantOwnerAccountNotFoundError(outcome);
  if (deps.router.credentialsInFirebase) return { adminEmail: tenant.ownerEmail, signInEmail: account.email, adminPassword: null, setPasswordLinkMailed: true };
  return { adminEmail: tenant.ownerEmail, signInEmail: account.email, adminPassword };
}

import { useMemo, useRef, useState } from "react";
import {
  summarize,
  voucherLine,
  getVoucherTypeDefinition,
  type AllocatableInvoice,
  type AllocationSummary,
  type CreateVoucherCommand,
  type VoucherAllocation,
  type VoucherDocument,
} from "@mezan/domain";
import { createVoucherStore, type VoucherStore, type VoucherStoreSeed } from "./voucher-store";

export interface StoreResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

async function attempt<T>(fn: () => Promise<T>): Promise<StoreResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** What the create form supplies (id is generated here). */
export type NewVoucherDraft = Omit<CreateVoucherCommand, "id">;

/**
 * React binding over `voucher-store.ts`: exposes the current voucher documents +
 * open invoices as plain arrays (re-derived on every mutation) plus actions that
 * call straight into the REAL `VoucherService` — create+confirm, reverse,
 * allocate, reverse-allocation — so the screen runs actual cash-guard /
 * numbering / allocation logic, mirroring `useJournalsStore`.
 */
export function useVouchersStore(seed: VoucherStoreSeed) {
  const storeRef = useRef<VoucherStore>(createVoucherStore(seed));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const documents = useMemo(() => storeRef.current.snapshot(), [version]);
  const openInvoices = useMemo(() => storeRef.current.openInvoices(), [version]);
  const allocations = useMemo(() => storeRef.current.allocations(), [version]);

  async function createAndConfirm(draft: NewVoucherDraft): Promise<StoreResult<VoucherDocument>> {
    const result = await attempt(async () => {
      const id = crypto.randomUUID();
      await storeRef.current.service.createVoucher({ ...draft, id });
      const confirmed = await storeRef.current.service.confirmVoucher(id, { actor: "demo", actorRoles: ["*"] });
      return confirmed.document;
    });
    if (result.ok) bump();
    return result;
  }

  async function reverse(id: string): Promise<StoreResult<VoucherDocument>> {
    const result = await attempt(async () => (await storeRef.current.service.reverseVoucher(id, { reversalId: crypto.randomUUID() })).original);
    if (result.ok) bump();
    return result;
  }

  async function allocate(voucherId: string, invoiceId: string, amount: import("@mezan/domain").Money): Promise<StoreResult<unknown>> {
    const result = await attempt(() =>
      storeRef.current.service.allocate(voucherId, { allocationId: crypto.randomUUID(), invoiceId, amount }),
    );
    if (result.ok) bump();
    return result;
  }

  async function reverseAllocation(allocationId: string): Promise<StoreResult<unknown>> {
    const result = await attempt(() => storeRef.current.service.reverseAllocation(allocationId));
    if (result.ok) bump();
    return result;
  }

  function allocationsFor(voucherId: string): VoucherAllocation[] {
    return allocations.filter((a) => a.voucherId === voucherId);
  }

  function summaryFor(doc: VoucherDocument): AllocationSummary {
    const line = voucherLine(doc);
    const def = getVoucherTypeDefinition(line.voucherType);
    return summarize(line.amount, allocationsFor(doc.id), def.allocatable);
  }

  return {
    documents,
    openInvoices,
    allocations,
    allocationsFor,
    summaryFor,
    service: storeRef.current.service,
    accounts: storeRef.current.accounts,
    treasuryAccounts: storeRef.current.treasuryAccounts,
    customers: storeRef.current.customers,
    suppliers: storeRef.current.suppliers,
    createAndConfirm,
    reverse,
    allocate,
    reverseAllocation,
    openInvoicesFor(kind: AllocatableInvoice["kind"], partyId: string | null): AllocatableInvoice[] {
      return openInvoices.filter(
        (i) => i.kind === kind && (partyId ? i.partyId === partyId : true) && i.total.scaled - i.allocated.scaled > 0n,
      );
    },
  };
}

import { useMemo, useRef, useState } from "react";
import { Money, type CreateSalesInvoiceCommand, type SalesInvoice } from "@mezan/domain";
import { createSalesInvoiceStore, type SalesInvoiceStore, type SalesInvoiceStoreSeed } from "./sales-invoice-store";

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

/**
 * React binding over `sales-invoice-store.ts`: exposes the current invoices as
 * a plain array (re-derived on every mutation) plus actions that call straight
 * into the REAL `SalesInvoiceService` — `createDraft` (+ optional `confirm`),
 * `recordPayment`, `cancel` — so the screen runs actual numbering / GL posting
 * / stock issue / lifecycle, mirroring `useJournalsStore`.
 */
export function useSalesInvoicesStore(seed: SalesInvoiceStoreSeed = {}) {
  const storeRef = useRef<SalesInvoiceStore>(createSalesInvoiceStore(seed));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const invoices = useMemo(() => storeRef.current.snapshot(), [version]);
  const { accounts, customers, items, warehouses, service } = storeRef.current;

  async function createDraft(cmd: CreateSalesInvoiceCommand): Promise<StoreResult<SalesInvoice>> {
    const result = await attempt(() => storeRef.current.service.createDraft(cmd));
    if (result.ok) bump();
    return result;
  }

  async function createAndConfirm(cmd: CreateSalesInvoiceCommand): Promise<StoreResult<SalesInvoice>> {
    const result = await attempt(async () => {
      await storeRef.current.service.createDraft(cmd);
      const { invoice } = await storeRef.current.service.confirm(cmd.id, { actor: "demo", actorRoles: ["*"] });
      return invoice;
    });
    if (result.ok) bump();
    return result;
  }

  async function confirmDraft(id: string): Promise<StoreResult<SalesInvoice>> {
    const result = await attempt(async () => (await storeRef.current.service.confirm(id, { actor: "demo", actorRoles: ["*"] })).invoice);
    if (result.ok) bump();
    return result;
  }

  async function cancel(id: string): Promise<StoreResult<SalesInvoice>> {
    const result = await attempt(() => storeRef.current.service.cancel(id));
    if (result.ok) bump();
    return result;
  }

  async function recordPayment(id: string, amount: Money): Promise<StoreResult<SalesInvoice>> {
    const result = await attempt(() => storeRef.current.service.recordPayment(id, amount));
    if (result.ok) bump();
    return result;
  }

  return { invoices, accounts, customers, items, warehouses, service, createDraft, createAndConfirm, confirmDraft, cancel, recordPayment };
}

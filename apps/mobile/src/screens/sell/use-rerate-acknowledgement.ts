import { useRef, useState } from "react";
import type { ConfirmSalesInvoiceDTO, SalesInvoiceDTO } from "@mezan/contracts";
import { rerateNoticeOf, type RerateNotice } from "@/api/errors";

export type ConfirmDraft = (input: { id: string; body?: ConfirmSalesInvoiceDTO }) => Promise<SalesInvoiceDTO>;

export interface PendingRerate extends RerateNotice {
  readonly invoiceId: string;
}

export interface RerateAcknowledgement {
  readonly pending: PendingRerate | null;
  readonly keptDraft: PendingRerate | null;
  readonly confirmed: SalesInvoiceDTO | null;
  readonly busy: boolean;
  confirmDraft(id: string, shownTotal: string): Promise<SalesInvoiceDTO | null>;
  acknowledge(): Promise<SalesInvoiceDTO | null>;
  keepDraft(): void;
  clear(): void;
}

export function useRerateAcknowledgement(confirm: ConfirmDraft): RerateAcknowledgement {
  const [pending, setPending] = useState<PendingRerate | null>(null);
  const [keptDraft, setKeptDraft] = useState<PendingRerate | null>(null);
  const [confirmed, setConfirmed] = useState<SalesInvoiceDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function post(id: string, shownTotal: string, acknowledged: boolean): Promise<SalesInvoiceDTO | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    setKeptDraft(null);
    try {
      const invoice = await confirm({ id, body: acknowledged ? { acknowledgeTaxRecalculation: true } : {} });
      setPending(null);
      setConfirmed(invoice);
      return invoice;
    } catch (err) {
      const rerate = rerateNoticeOf(err, shownTotal);
      if (!rerate) throw err;
      setPending({ invoiceId: id, ...rerate });
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return {
    pending,
    keptDraft,
    confirmed,
    busy,
    confirmDraft: (id, shownTotal) => {
      setConfirmed(null);
      return post(id, shownTotal, false);
    },
    acknowledge: () => (pending ? post(pending.invoiceId, pending.shownTotal, true) : Promise.resolve(null)),
    keepDraft: () => {
      setKeptDraft(pending);
      setPending(null);
    },
    clear: () => {
      setPending(null);
      setKeptDraft(null);
      setConfirmed(null);
    },
  };
}

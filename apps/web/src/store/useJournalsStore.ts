import { useMemo, useRef, useState } from "react";
import { Money, type FrameworkDocument, type JournalDocLine } from "@mezan/domain";
import { createJournalStore, type JournalStore, type JournalStoreSeed } from "./journal-store";

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

/** A line as the create form supplies it (major-unit numbers). */
export interface JournalLineDraft {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface PostJournalCommand {
  date: string;
  memo: string;
  lines: JournalLineDraft[];
}

function toDomainLines(lines: JournalLineDraft[]): JournalDocLine[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    debit: Money.fromMajor(String(l.debit || 0)),
    credit: Money.fromMajor(String(l.credit || 0)),
    memo: l.memo?.trim() ? l.memo.trim() : null,
  }));
}

/**
 * React binding over `journal-store.ts`: exposes the current journal documents
 * as a plain array (re-derived on every mutation) plus actions that call
 * straight into the REAL `DocumentService` — `createDraft` + `confirm` for a
 * post, `reverse` for a reversal — so the screen runs actual domain balance
 * enforcement / numbering / lifecycle, mirroring how `useUsersRolesStore` drives
 * the users/roles screens.
 */
export function useJournalsStore(seed: JournalStoreSeed) {
  const storeRef = useRef<JournalStore>(createJournalStore(seed));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const documents = useMemo(() => storeRef.current.snapshot(), [version]);
  const accounts = storeRef.current.accounts;

  async function postNew(cmd: PostJournalCommand): Promise<StoreResult<FrameworkDocument<JournalDocLine>>> {
    const result = await attempt(async () => {
      const id = crypto.randomUUID();
      await storeRef.current.service.createDraft({ id, date: cmd.date, memo: cmd.memo, lines: toDomainLines(cmd.lines) });
      const confirmed = await storeRef.current.service.confirm(id, { actor: "demo", actorRoles: ["*"] });
      return confirmed.document;
    });
    if (result.ok) bump();
    return result;
  }

  async function saveDraft(cmd: PostJournalCommand): Promise<StoreResult<FrameworkDocument<JournalDocLine>>> {
    const result = await attempt(() =>
      storeRef.current.service.createDraft({ id: crypto.randomUUID(), date: cmd.date, memo: cmd.memo, lines: toDomainLines(cmd.lines) }),
    );
    if (result.ok) bump();
    return result;
  }

  async function postDraft(id: string): Promise<StoreResult<FrameworkDocument<JournalDocLine>>> {
    const result = await attempt(async () => (await storeRef.current.service.confirm(id, { actor: "demo", actorRoles: ["*"] })).document);
    if (result.ok) bump();
    return result;
  }

  async function reverse(id: string): Promise<StoreResult<FrameworkDocument<JournalDocLine>>> {
    const result = await attempt(async () => (await storeRef.current.service.reverse(id, { reversalId: crypto.randomUUID() })).original);
    if (result.ok) bump();
    return result;
  }

  return { documents, accounts, service: storeRef.current.service, postNew, saveDraft, postDraft, reverse };
}

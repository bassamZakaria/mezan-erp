import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IdempotencyRefusal } from "@mezan/contracts";

export interface DocumentId {
  readonly current: () => string;
  readonly renew: () => void;
  /**
   * True when `err` is the server saying this id already holds a document with
   * other contents. The saved document's id is handed to the form's handler
   * and a new id is minted, so the form never dead-ends on an id it cannot use.
   */
  readonly recover: (err: unknown) => boolean;
}

function isKeyReused(err: unknown): boolean {
  return err instanceof Error && (err as { code?: unknown }).code === IdempotencyRefusal.KeyReused;
}

// ONE id per document the user means to create. It survives an attempt whose
// answer never arrived, so pressing save again is answered with the document
// already created instead of creating a second; `renew` is called only once
// everything the save does — a confirm after the create included — is known
// to have succeeded.
export function useDocumentId(onAlreadySaved: (savedId: string) => void): DocumentId {
  const id = useRef(crypto.randomUUID());
  const handler = useRef(onAlreadySaved);
  handler.current = onAlreadySaved;
  const queryClient = useQueryClient();
  return useRef<DocumentId>({
    current: () => id.current,
    renew: () => {
      id.current = crypto.randomUUID();
    },
    recover: (err) => {
      if (!isKeyReused(err)) return false;
      const saved = id.current;
      id.current = crypto.randomUUID();
      // The saved document was created by a request whose answer never
      // arrived, so no list this screen holds has it yet.
      void queryClient.invalidateQueries();
      handler.current(saved);
      return true;
    },
  }).current;
}

export interface AlreadySavedNoticeState {
  readonly savedId: string | null;
  readonly show: (savedId: string) => void;
  readonly clear: () => void;
}

export function useAlreadySavedNotice(): AlreadySavedNoticeState {
  const [savedId, setSavedId] = useState<string | null>(null);
  return { savedId, show: setSavedId, clear: () => setSavedId(null) };
}

/** Says the open document is one that was already saved. It belongs to that document: opening anything else ends it. */
export function AlreadySavedNotice({
  notice,
  openId,
  message,
  dismissLabel,
}: {
  notice: AlreadySavedNoticeState;
  openId: string | null;
  message: string;
  dismissLabel: string;
}) {
  const { savedId, clear } = notice;
  const elsewhere = savedId !== null && openId !== savedId;
  useEffect(() => {
    if (elsewhere) clear();
  }, [elsewhere, clear]);
  if (savedId === null || elsewhere) return null;
  return (
    <div role="status" className="mb-[18px] flex items-start justify-between gap-3 rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
      <span>{message}</span>
      <button type="button" onClick={clear} className="shrink-0 font-semibold underline">
        {dismissLabel}
      </button>
    </div>
  );
}

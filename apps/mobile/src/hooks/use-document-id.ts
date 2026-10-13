import { useRef } from "react";
import { IdempotencyRefusal } from "@mezan/contracts";
import { ApiError } from "@/api/errors";
import { makeDocumentId } from "@/domain/local-id";

export interface DocumentId {
  readonly current: () => string;
  readonly renew: () => void;
  readonly recover: (err: unknown) => boolean;
}

// CONTRACT: `renew` is called only once everything the press does — the
// confirm after the create included — is known to have succeeded. Until then
// the same id is resent, so a retry is answered with the document already created.
export function useDocumentId(onAlreadySaved: (savedId: string) => void): DocumentId {
  const id = useRef(makeDocumentId());
  const handler = useRef(onAlreadySaved);
  handler.current = onAlreadySaved;
  return useRef<DocumentId>({
    current: () => id.current,
    renew: () => {
      id.current = makeDocumentId();
    },
    recover: (err) => {
      if (!(err instanceof ApiError) || err.code !== IdempotencyRefusal.KeyReused) return false;
      const saved = id.current;
      id.current = makeDocumentId();
      handler.current(saved);
      return true;
    },
  }).current;
}

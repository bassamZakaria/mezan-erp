import { useRef } from "react";

export interface DocumentId {
  readonly current: () => string;
  readonly renew: () => void;
}

// ONE id per document the user means to create. It survives an attempt whose
// answer never arrived, so pressing save again is answered with the document
// already created instead of creating a second; `renew` is called the moment a
// create is known to have succeeded.
export function useDocumentId(): DocumentId {
  const id = useRef(crypto.randomUUID());
  return useRef<DocumentId>({
    current: () => id.current,
    renew: () => {
      id.current = crypto.randomUUID();
    },
  }).current;
}

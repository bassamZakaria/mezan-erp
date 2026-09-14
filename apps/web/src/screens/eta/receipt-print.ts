import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ApiError } from "../../data/hooks";
import { useApi } from "../../data/ApiContext";

/** What `GET /eta/receipts/:internalId` returns for a reprint. */
export interface EtaReceiptPrintDTO {
  readonly uuid: string;
  readonly qrValue: string;
}

/**
 * The stored identifier and QR for one document, or null when the document was
 * reported as a B2B e-invoice rather than a consumer e-receipt.
 *
 * The QR is fetched rather than rebuilt in the browser: it encodes the
 * authority's own share URL for the receipt, and a locally-assembled one that
 * drifts from the server's prints a code that resolves to nothing.
 */
export function useEtaReceiptPrint(internalId: string | null): UseQueryResult<EtaReceiptPrintDTO | null, ApiError> {
  const { request, session } = useApi();
  return useQuery<EtaReceiptPrintDTO | null, ApiError>({
    queryKey: ["eta", "receipts", "print", internalId],
    enabled: session !== null && internalId !== null && internalId !== "",
    queryFn: async () => {
      const res = await request(`/eta/receipts/${encodeURIComponent(internalId ?? "")}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new ApiError(res.status, "تعذّر قراءة الإيصال الإلكتروني.");
      return res.json<EtaReceiptPrintDTO>();
    },
  });
}

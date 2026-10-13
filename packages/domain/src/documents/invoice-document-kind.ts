import { InvoiceDocumentKind } from "@mezan/contracts";

export { InvoiceDocumentKind };

export function isRetentionRelease(document: { readonly documentKind?: InvoiceDocumentKind | null }): boolean {
  return document.documentKind === InvoiceDocumentKind.RetentionRelease;
}

export const RETENTION_RELEASE_ITEM_ID = "SRV-CONTRACTING-RETENTION";

import { InvoiceDocumentKind } from "@mezan/contracts";

export { InvoiceDocumentKind };

export function isRetentionRelease(document: { readonly documentKind?: InvoiceDocumentKind | null }): boolean {
  return document.documentKind === InvoiceDocumentKind.RetentionRelease;
}

/**
 * The service item the generated «إفراج عن محتجزات» invoice names. A tenant
 * that prefers its own service item overrides it in the composition.
 */
export const RETENTION_RELEASE_ITEM_ID = "SRV-CONTRACTING-RETENTION";

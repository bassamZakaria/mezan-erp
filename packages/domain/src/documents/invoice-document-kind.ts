import { InvoiceDocumentKind } from "@mezan/contracts";

export { InvoiceDocumentKind };

export function isRetentionRelease(document: { readonly documentKind?: InvoiceDocumentKind | null }): boolean {
  return document.documentKind === InvoiceDocumentKind.RetentionRelease;
}

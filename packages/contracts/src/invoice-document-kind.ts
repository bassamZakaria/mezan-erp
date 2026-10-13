// INVARIANT: a retention release is an invoice only in form. It reclasses
// money already invoiced and taxed on the certificate that withheld it, so it
// is not a supply: it names no tax rate, is never classified, reports no VAT
// row and reaches neither the e-invoice queue nor the e-receipt issuer. The
// kind is stored on the document — nothing infers it from an item or an id.
export enum InvoiceDocumentKind {
  Standard = "standard",
  RetentionRelease = "retention_release",
}

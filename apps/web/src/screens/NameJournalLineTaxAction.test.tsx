// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SessionDTO, TaxRateDTO } from "@mezan/contracts";
import { ClassifiableDocument, ReturnFamily } from "../data/hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { ClassifiableLine } from "./ClassifyLineTaxAction";
import { NameJournalLineTaxAction, type JournalTaxDocument } from "./NameJournalLineTaxAction";
import { ReturnJournalCard } from "./ReturnJournalCard";

const rate = (id: string, name: string, percent: number): TaxRateDTO =>
  ({ id, code: id, name, rate: percent, calculationType: "exclusive", isDefault: false, outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active", isSystem: false }) as TaxRateDTO;
const TAX_RATES = [rate("VAT14", "ضريبة القيمة المضافة", 14), rate("VAT-EXEMPT", "معفى من الضريبة", 0)];
const LINES: ClassifiableLine[] = [
  { lineId: "0", label: "أسمنت", taxRatePercent: 14, taxRateId: "VAT14" },
  { lineId: "1", label: "خدمة توصيل", taxRatePercent: 0, taxRateId: null },
];
const ENTRY = {
  id: "JE-1", entryNo: "JE-000001",
  lines: [
    { accountId: "1105", debit: "0.000000", credit: "214.000000", taxRatePercent: null, taxRateId: null },
    { accountId: "4100", debit: "100.000000", credit: "0.000000", taxRatePercent: null, taxRateId: null },
    { accountId: "2200", debit: "14.000000", credit: "0.000000", taxRatePercent: null, taxRateId: null },
    { accountId: "4100", debit: "100.000000", credit: "0.000000", taxRatePercent: 0, taxRateId: "VAT-EXEMPT" },
  ],
};
const session = (...permissions: string[]): SessionDTO => ({ ...testAdminSession, permissions });
const action = () => screen.queryByRole("button", { name: "تسمية ضريبة سطر القيد" });

interface Sent {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

function mount(document: JournalTaxDocument, opts: { session?: SessionDTO; respond?: () => { status?: number; body: unknown }; entry?: unknown; posted?: boolean; hold?: Promise<void> } = {}) {
  const sent: Sent[] = [];
  let entryReads = 0;
  const answered = stubTransport({
    "GET /gl/journal-entries/*": () => {
      entryReads += 1;
      return { body: opts.entry ?? ENTRY };
    },
    "GET /tax-rates/policy": () => ({ body: { vatEnabled: true } }),
    [`POST /${document}/*/lines/*/journal-tax`]: (init, path) => {
      sent.push({ path, body: JSON.parse((init?.body as string) ?? "{}") });
      return opts.respond?.() ?? { body: { documentId: "D-1", documentNumber: "N-1", lineIds: ["0"], taxRateId: "VAT14", taxRateName: "ضريبة القيمة المضافة", taxRatePercent: 14, journalLinesNamed: 2, filing: "not_queued" } };
    },
  });
  const transport: typeof answered = async (path, init) => {
    if ((init?.method ?? "GET") === "POST" && opts.hold) await opts.hold;
    return answered(path, init);
  };
  renderWithProviders(
    <NameJournalLineTaxAction document={document} documentId="D-1" journalEntryId="JE-1" posted={opts.posted ?? true} lines={LINES} taxRates={TAX_RATES} accountLabel={(id) => `حساب ${id}`} />,
    { transport, initialSession: opts.session ?? testAdminSession },
  );
  return { sent, entryReads: () => entryReads };
}

const DOCUMENTS: readonly [JournalTaxDocument, string][] = [
  [ClassifiableDocument.SalesInvoice, "sales.invoice.classify_tax"],
  [ClassifiableDocument.PurchaseInvoice, "purchases.invoice.classify_tax"],
  [ReturnFamily.Sales, "sales.invoice.classify_tax"],
  [ReturnFamily.Purchases, "purchases.invoice.classify_tax"],
];

describe("NameJournalLineTaxAction — «تسمية ضريبة سطر القيد»", () => {
  it.each(DOCUMENTS)("on %s is hidden from a journal reader who does not hold %s, and never reads the entry for them", async (document) => {
    const none = mount(document, { session: session("accounting.journal.view") });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(action()).toBeNull();
    expect(none.entryReads()).toBe(0);
  });

  it.each(DOCUMENTS)("on %s is hidden from a classifier who may not read the journal, and shown to one who may", async (document, classify) => {
    const blind = mount(document, { session: session(classify) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(action()).toBeNull();
    expect(blind.entryReads()).toBe(0);
  });

  it.each(DOCUMENTS)("on %s sends the picked document line and the ticked journal lines, with no rate for a line that already names one", async (document, classify) => {
    const { sent } = mount(document, { session: session(classify, "accounting.journal.view") });
    fireEvent.click(await screen.findByRole("button", { name: "تسمية ضريبة سطر القيد" }));
    expect(screen.queryByLabelText("الضريبة")).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    fireEvent.click(screen.getByRole("checkbox", { name: /سطر 2: حساب 4100/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /سطر 3: حساب 2200/ }));
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ path: `/${document}/D-1/lines/0/journal-tax`, body: { journalLineIndexes: [1, 2] } });
  });

  it("asks for the rate when the picked document line names none, and refuses to send without a rate or without a line", async () => {
    const { sent } = mount(ReturnFamily.Sales, { entry: { ...ENTRY, lines: ENTRY.lines.map((line) => ({ ...line, taxRateId: line.accountId === "2200" ? "VAT14" : line.taxRateId })) } });
    fireEvent.click(await screen.findByRole("button", { name: "تسمية ضريبة سطر القيد" }));
    fireEvent.click(screen.getByLabelText("بند المستند"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "خدمة توصيل · 0٪" }));
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اختر الضريبة");
    fireEvent.click(screen.getByLabelText("الضريبة"));
    fireEvent.mouseDown(screen.getByRole("option", { name: "معفى من الضريبة · 0٪" }));
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اختر سطراً واحداً على الأقل من القيد.");
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole("checkbox", { name: /سطر 2: حساب 4100/ }));
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ journalLineIndexes: [1], taxRateId: "VAT-EXEMPT" });
  });

  it("shows the server's Arabic mismatch message and keeps the panel open", async () => {
    mount(ReturnFamily.Purchases, {
      respond: () => ({ status: 422, body: { error: "JOURNAL_TAX_LINES_MISMATCH", message: "السطور المختارة لا تطابق ما رحّلته بنود المستند بهذه الضريبة. المطلوب اختيار: 4100 (مدين 100.000000 / دائن 0.000000)." } }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "تسمية ضريبة سطر القيد" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /سطر 1: حساب 1105/ }));
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("السطور المختارة لا تطابق ما رحّلته بنود المستند");
    expect(screen.getByRole("button", { name: "تسمية" })).toBeInTheDocument();
  });

  it("sends once while the first request is pending, with the confirm disabled until it answers", async () => {
    let release: (() => void) | undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sent } = mount(ReturnFamily.Sales, { hold });
    fireEvent.click(await screen.findByRole("button", { name: "تسمية ضريبة سطر القيد" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /سطر 2: حساب 4100/ }));
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "تسمية" })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "تسمية" }));
    release?.();
    await waitFor(() => expect(screen.queryByRole("button", { name: "تسمية" })).toBeNull());
    expect(sent).toHaveLength(1);
  });

  it("is absent on a document that is not posted, and when no journal line is left unnamed", async () => {
    mount(ClassifiableDocument.SalesInvoice, { posted: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(action()).toBeNull();
  });
});

describe("ReturnJournalCard — the return's entry and its journal-tax action", () => {
  const RETURN = { id: "D-1", docNo: "SR-000001", status: "confirmed", journalEntryId: "JE-1", reversesDocId: null, lines: [{ itemId: "ITEM-1", taxRatePercent: 14, taxRateId: "VAT14" }] };

  it("shows the entry's lines to a caller who may read the journal, with the action, and nothing to one who may not", async () => {
    const transport = stubTransport({
      "GET /gl/journal-entries/*": () => ({ body: ENTRY }),
      "GET /tax-rates/policy": () => ({ body: { vatEnabled: true } }),
      "GET /tax-rates": () => ({ body: TAX_RATES }),
      "GET /accounts": () => ({ body: [{ id: "4100", code: "4100", nameAr: "مردودات المبيعات" }] }),
    });
    const { unmount } = renderWithProviders(<ReturnJournalCard family={ReturnFamily.Sales} document={RETURN} lineLabel={() => "أسمنت"} />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("JE-000001")).toBeInTheDocument();
    expect(await screen.findAllByText("4100 — مردودات المبيعات")).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "تسمية ضريبة سطر القيد" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("214.00");
    expect(table).not.toHaveTextContent("214.000000");
    expect(table).not.toHaveTextContent("100.000000");
    unmount();
    renderWithProviders(<ReturnJournalCard family={ReturnFamily.Sales} document={RETURN} lineLabel={() => "أسمنت"} />, { transport, initialSession: session("sales.return.view") });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("JE-000001")).toBeNull();
  });
});

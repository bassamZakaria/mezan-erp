/// <reference types="jest" />
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Locale, STRINGS } from "@/i18n/strings";
import { CollectPermission } from "@/domain/collect-path";
import { Collect } from "../index";

const strings = STRINGS[Locale.Ar].collect;

const PHONE = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }; // rtl-ok

const mockHeld: Set<string> = new Set();
const mockCreateDraft = jest.fn();
const mockCreateCollection = jest.fn();
const mockCustomer = { id: "CUST-1", code: "C-001", nameAr: "شركة النيل للتوريدات", active: true };
const mockOpenInvoice = { id: "INV-ID-1", invoiceNo: "INV-000123", outstanding: "150.500000" };
const mockInvoiceDetail = { id: "INV-ID-1", currency: "EGP", fxRate: null };
const mockBranch = { id: "BR-MAIN", code: "MAIN", name: "الفرع الرئيسي", active: true, isMain: true };
const mockDrawer = { id: "TR-1", code: "CASH-1", name: "خزينة المندوب", status: "active", currency: "EGP", glAccountId: "1300-1" };

jest.mock("@/session/SessionProvider", () => ({ useSession: () => ({ can: (permission: string) => mockHeld.has(permission) }) }));
jest.mock("@/hooks/use-offline", () => ({ useOffline: () => false }));
jest.mock("@/i18n", () => {
  const actual = jest.requireActual("@/i18n/strings");
  return { useStrings: () => actual.STRINGS[actual.Locale.Ar] };
});
jest.mock("@/api/queries", () => ({
  useCustomers: () => ({ data: [mockCustomer], isLoading: false }),
  useOpenInvoices: (_kind: string, customerId: string | null) => ({ data: customerId ? [mockOpenInvoice] : [], isLoading: false }),
  useSalesInvoice: (id: string | null) => ({ data: id ? mockInvoiceDetail : undefined, isError: false }),
  useBranches: () => ({ data: [mockBranch] }),
  useTreasuryAccounts: () => ({ data: [mockDrawer] }),
  useCreateCollection: () => ({ mutateAsync: mockCreateCollection }),
  useCreateVoucherDraft: () => ({ mutateAsync: mockCreateDraft }),
}));

async function openAs(...permissions: CollectPermission[]) {
  mockHeld.clear();
  for (const permission of permissions) mockHeld.add(permission);
  await render(
    <SafeAreaProvider initialMetrics={PHONE}>
      <Collect />
    </SafeAreaProvider>,
  );
}

async function pick(fieldText: string, optionText: string) {
  await fireEvent.press(screen.getByText(fieldText));
  await fireEvent.press(await screen.findByText(optionText));
}

async function fillTheForm() {
  await pick(strings.customerPlaceholder, mockCustomer.nameAr);
  await pick(strings.invoicePlaceholder, mockOpenInvoice.invoiceNo);
  await waitFor(() => expect(screen.getByDisplayValue("150.50")).toBeTruthy());
  await pick(strings.treasuryAccountPlaceholder, mockDrawer.name);
}

beforeEach(() => {
  mockCreateDraft.mockReset().mockResolvedValue({ id: "V-1", docNo: null });
  mockCreateCollection.mockReset().mockResolvedValue({ voucher: { id: "V-2", docNo: "CV-000009" }, held: false });
});

describe("the collect screen, for the session that opens it", () => {
  it("lets a cashier who writes and allocates but does not confirm save a draft that names the invoice it is for", async () => {
    await openAs(CollectPermission.Create, CollectPermission.Allocate);
    expect(screen.getByRole("button", { name: strings.submitDraft })).toBeTruthy();
    await fillTheForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.submitDraft }));

    await waitFor(() => expect(mockCreateDraft).toHaveBeenCalledTimes(1));
    expect(mockCreateDraft.mock.calls[0][0]).toMatchObject({
      voucherType: "customer_collection",
      customerId: "CUST-1",
      branchId: "BR-MAIN",
      treasuryAccountId: "TR-1",
      amount: "150.50",
      allocations: [{ invoiceId: "INV-ID-1", amount: "150.50" }],
    });
    expect(mockCreateCollection).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(new RegExp(strings.draftSavedCarrying))).toBeTruthy());
  });

  it("saves the draft without an allocation for a cashier who may not allocate, and says the invoice is not settled", async () => {
    await openAs(CollectPermission.Create);
    await fillTheForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.submitDraft }));

    await waitFor(() => expect(mockCreateDraft).toHaveBeenCalledTimes(1));
    expect(Object.keys(mockCreateDraft.mock.calls[0][0])).not.toContain("allocations");
    expect(mockCreateDraft.mock.calls[0][0].memo).toBe(`${strings.draftMemo} INV-000123`);
    await waitFor(() => expect(screen.getByText(new RegExp(strings.draftSaved))).toBeTruthy());
  });

  it("collects, confirms and allocates in one call for a session holding all three rights", async () => {
    await openAs(CollectPermission.Create, CollectPermission.Confirm, CollectPermission.Allocate);
    await fillTheForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.submit }));

    await waitFor(() => expect(mockCreateCollection).toHaveBeenCalledTimes(1));
    expect(mockCreateCollection.mock.calls[0][0]).toMatchObject({ customerId: "CUST-1", treasuryAccountId: "TR-1", amount: "150.50", allocations: [{ invoiceId: "INV-ID-1", amount: "150.50" }] });
    expect(mockCreateDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(new RegExp("CV-000009"))).toBeTruthy());
  });

  it("refuses to send anything until a customer and an invoice are picked", async () => {
    await openAs(CollectPermission.Create, CollectPermission.Allocate);
    await fireEvent.press(screen.getByRole("button", { name: strings.submitDraft }));

    await waitFor(() => expect(screen.getByText(strings.invoiceRequired)).toBeTruthy());
    expect(mockCreateDraft).not.toHaveBeenCalled();
  });

  it("tells a session that may only confirm where confirming happens, and offers it no way to submit", async () => {
    await openAs(CollectPermission.Confirm);
    expect(screen.getByText(strings.confirmOnly)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.submit })).toBeDisabled();
  });

  it("tells a session holding none of the rights that it may not collect", async () => {
    await openAs();
    expect(screen.getByText(strings.noPermission)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.submit })).toBeDisabled();
  });
});

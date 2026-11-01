// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { StorageRequestStatusCode, type StorageRequestDTO, type TenantBillingDTO } from "@mezan/contracts";
import type { Session } from "../data/session";
import { SUBSCRIPTION_BILLING_FEATURE } from "@mezan/domain";
import { BillingScreen } from "./BillingScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const ENTITLEMENTS = { plan: "pro", activeModules: ["sales", "admin"], seats: 5, expiresAt: null };

function open(features: Record<string, boolean>) {
  const asked: string[] = [];
  const base = stubTransport({
    "GET /entitlements": () => ({ body: { ...ENTITLEMENTS, features } }),
    "GET /billing/subscription": () => ({
      body: {
        cardCheckout: false, testMode: false, canRenew: false, subscription: null, today: "2026-10-14", month: "2026-10",
        trialEndsAt: null, trialDaysLeft: null, moduleTrialDays: 0, quotas: [], limits: [], modules: [], plans: [], checkouts: [], storageRequest: null,
      },
    }),
  });
  renderWithProviders(<BillingScreen />, {
    transport: (path, init) => {
      asked.push(path.split("?")[0] ?? path);
      return base(path, init);
    },
    initialSession: testAdminSession,
  });
  return asked;
}

describe("BillingScreen — opened by its address on an edition without subscription billing", () => {
  it("says this edition runs on a licence, and asks the server for no subscription", async () => {
    const asked = open({});
    expect(await screen.findByText(/تعمل بترخيص وليس باشتراك/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toContain("/billing/subscription");
  });

  it("reads the subscription on a cloud tenant and shows no such notice", async () => {
    const asked = open({ [SUBSCRIPTION_BILLING_FEATURE]: true });
    await waitFor(() => expect(asked).toContain("/billing/subscription"));
    expect(screen.queryByText(/تعمل بترخيص وليس باشتراك/)).not.toBeInTheDocument();
  });
});

const STORAGE_LIMIT = { limit: "storage_mb" as const, allowed: 2048, used: 200 };

function storageRequest(overrides: Partial<StorageRequestDTO> = {}): StorageRequestDTO {
  return {
    id: "SR-1", tenantId: "T-1", extraMb: 5120, note: null, status: StorageRequestStatusCode.Pending,
    requestedBy: "USER-ADMIN", requestedAt: "2026-10-14T09:00:00.000Z", decidedBy: null, decidedAt: null, ...overrides,
  };
}

function openWithStorage(billing: Partial<TenantBillingDTO>, options: { session?: Session; post?: (body: unknown) => void; postStatus?: number } = {}) {
  const base = stubTransport({
    "GET /entitlements": () => ({ body: { ...ENTITLEMENTS, features: { [SUBSCRIPTION_BILLING_FEATURE]: true } } }),
    "GET /billing/subscription": () => ({
      body: {
        cardCheckout: false, testMode: false, canRenew: false, subscription: null, today: "2026-10-14", month: "2026-10",
        trialEndsAt: null, trialDaysLeft: null, moduleTrialDays: 0, quotas: [], limits: [], modules: [], plans: [], checkouts: [], storageRequest: null,
        ...billing,
      },
    }),
    "POST /billing/storage-requests": (init) => {
      options.post?.(JSON.parse(String(init?.body)));
      return options.postStatus && options.postStatus >= 400
        ? { status: options.postStatus, body: { error: "STORAGE_REQUEST_REFUSED", message: "لديكم طلب قيد المراجعة بالفعل" } }
        : { status: 201, body: storageRequest() };
    },
  });
  renderWithProviders(<BillingScreen />, { transport: base, initialSession: options.session ?? testAdminSession });
}



const memberSession: Session = { ...testAdminSession, isCompanyAdmin: false, permissions: ["admin.settings.view"] };

describe("BillingScreen — attachment storage", () => {
  it("shows the storage limit as a size, not a raw megabyte count", async () => {
    openWithStorage({ limits: [STORAGE_LIMIT] });
    const row = (await screen.findByText("مساحة المرفقات")).closest("div") as HTMLElement;
    expect(row).toHaveTextContent("200 MB");
    expect(row).toHaveTextContent("2 GB");
    expect(row).not.toHaveTextContent("2048");
  });

  it("offers no request card on a plan with no storage limit", async () => {
    openWithStorage({ limits: [{ limit: "seats", allowed: 5, used: 2 }] });
    await screen.findByText("المستخدمون النشطون");
    expect(screen.queryByText("مساحة إضافية للمرفقات")).not.toBeInTheDocument();
  });

  it("lets the company admin ask for 1, 5 or 10 GB and sends the chosen step with the note", async () => {
    const posts: unknown[] = [];
    openWithStorage({ limits: [STORAGE_LIMIT] }, { post: (b) => posts.push(b) });
    await screen.findByText("مساحة إضافية للمرفقات");
    fireEvent.click(screen.getByRole("combobox", { name: "المساحة المطلوبة" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["1 GB", "5 GB", "10 GB"]);
    fireEvent.mouseDown(screen.getByRole("option", { name: "5 GB" }));
    fireEvent.change(screen.getByLabelText("ملاحظة (اختياري)"), { target: { value: "  أرشيف عقود  " } });
    fireEvent.click(screen.getByRole("button", { name: "طلب مساحة إضافية" }));

    await waitFor(() => expect(posts).toEqual([{ extraMb: 5120, note: "أرشيف عقود" }]));
  });

  it("sends the first step and no note when the admin changes nothing", async () => {
    const posts: unknown[] = [];
    openWithStorage({ limits: [STORAGE_LIMIT] }, { post: (b) => posts.push(b) });
    fireEvent.click(await screen.findByRole("button", { name: "طلب مساحة إضافية" }));
    await waitFor(() => expect(posts).toEqual([{ extraMb: 1024 }]));
  });

  it("shows the server's refusal and keeps the form", async () => {
    openWithStorage({ limits: [STORAGE_LIMIT] }, { postStatus: 409 });
    fireEvent.click(await screen.findByRole("button", { name: "طلب مساحة إضافية" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لديكم طلب قيد المراجعة بالفعل");
    expect(screen.getByRole("button", { name: "طلب مساحة إضافية" })).toBeEnabled();
  });

  it("shows a pending request as a pill and takes the form away", async () => {
    openWithStorage({ limits: [STORAGE_LIMIT], storageRequest: storageRequest() });
    expect(await screen.findByText("طلب 5 GB قيد المراجعة")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "طلب مساحة إضافية" })).not.toBeInTheDocument();
  });

  it("tells a declined admin the last request was not approved and lets them ask again", async () => {
    openWithStorage({ limits: [STORAGE_LIMIT], storageRequest: storageRequest({ status: StorageRequestStatusCode.Declined, extraMb: 10240 }) });
    expect(await screen.findByText(/لم تتم الموافقة على طلب 10 GB السابق/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "طلب مساحة إضافية" })).toBeInTheDocument();
  });

  it("tells a user without settings-edit rights to ask the company admin, with no form", async () => {
    openWithStorage({ limits: [STORAGE_LIMIT] }, { session: memberSession });
    expect(await screen.findByText("طلب المساحة الإضافية متاح لمدير المنشأة.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "طلب مساحة إضافية" })).not.toBeInTheDocument();
  });

  it("still shows a pending request to a user without those rights", async () => {
    openWithStorage({ limits: [STORAGE_LIMIT], storageRequest: storageRequest() }, { session: memberSession });
    expect(await screen.findByText("طلب 5 GB قيد المراجعة")).toBeInTheDocument();
    expect(screen.queryByText("طلب المساحة الإضافية متاح لمدير المنشأة.")).not.toBeInTheDocument();
  });

  it("shows each plan offer's storage quota as a size, and none when the plan has no cap", async () => {
    const offer = (id: string, quotas: Record<string, number>) => ({
      id, code: id, nameAr: `باقة ${id}`, nameEn: id, kind: "paid" as const, modules: ["sales"], seatsIncluded: 5, branchesIncluded: 1, warehousesIncluded: 1,
      quotas, priceMonthly: "500.00", priceYearly: "5000.00", trialDays: 0, current: false, suggested: false,
    });
    openWithStorage({ plans: [offer("capped", { storage_mb: 1536 }), offer("open", {})] });
    const capped = (await screen.findByText("باقة capped")).closest("div[class*='rounded-md']") as HTMLElement;
    expect(within(capped).getByText("مساحة المرفقات:")).toHaveTextContent("1.5 GB");
    const open = screen.getByText("باقة open").closest("div[class*='rounded-md']") as HTMLElement;
    expect(within(open).queryByText(/مساحة المرفقات/)).not.toBeInTheDocument();
  });
});

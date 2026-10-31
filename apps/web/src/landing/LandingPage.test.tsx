// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { PublicPlanDTO } from "@mezan/contracts";
import { PlanKind, QuotaKind } from "@mezan/domain";
import { AppI18nProvider } from "../i18n";
import { LandingPage } from "./LandingPage";

const plan = (overrides: Partial<PublicPlanDTO>): PublicPlanDTO => ({
  id: "PLAN-X",
  code: "x",
  nameAr: "س",
  nameEn: "X",
  kind: PlanKind.Paid,
  modules: ["accounting", "sales", "purchases", "inventory", "treasury"],
  seatsIncluded: 3,
  branchesIncluded: 1,
  warehousesIncluded: 1,
  quotas: {},
  priceMonthly: "490.00",
  priceYearly: "4900.00",
  trialDays: 14,
  ...overrides,
});

const PLANS: PublicPlanDTO[] = [
  plan({ id: "PLAN-FREE", code: "free", nameAr: "المجانية", nameEn: "Free", kind: PlanKind.Free, seatsIncluded: 2, quotas: { [QuotaKind.SalesInvoicesPerMonth]: 100 }, priceMonthly: "0.00", priceYearly: "0.00", trialDays: 0 }),
  plan({ id: "PLAN-CORE", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales", "purchases", "inventory", "treasury", "audit"] }),
  plan({
    id: "PLAN-BUSINESS",
    code: "business",
    nameAr: "الأعمال",
    nameEn: "Business",
    modules: ["accounting", "sales", "purchases", "inventory", "treasury", "audit", "installments", "financial_papers"],
    seatsIncluded: 10,
    branchesIncluded: 3,
    warehousesIncluded: 3,
    priceMonthly: "980.00",
    priceYearly: "9800.00",
  }),
];

function open(response: () => Promise<Response>, whatsapp: string | null = null) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => (String(input instanceof Request ? input.url : input).endsWith("/status") ? ok({ contact: { email: null, phone: null, whatsapp } })() : response())),
  );
  render(
    <AppI18nProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/welcome"]}>
          <LandingPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}

const ok = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

describe("LandingPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers no way to create an account, only sign-in and contact", async () => {
    open(ok(PLANS));

    expect(await screen.findByTestId("landing-plan-business")).toBeInTheDocument();
    expect(screen.getByText("تواصل معنا ونفتح حساب منشأتك ونجهّزه لك. ودفاترك تبقى معك.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/signup"))).toEqual([]));
    for (const link of screen.getAllByRole("link", { name: "تسجيل الدخول" })) expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("marks a sold-out package and offers no way to choose it", async () => {
    open(ok(PLANS.map((p) => (p.code === "business" ? { ...p, soldOut: true } : p))));

    const card = await screen.findByTestId("landing-plan-business");
    expect(within(card).getAllByText("نفدت حاليًا").length).toBeGreaterThan(0);
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  });

  it("lets a visitor clear a field and type a new quantity digit by digit without it jumping", async () => {
    open(ok(PLANS));
    const user = userEvent.setup();

    const quantity = screen.getByRole("spinbutton", { name: "الكمية (كرتونة)" });
    await user.clear(quantity);
    await user.type(quantity, "50");

    expect(quantity).toHaveValue(50);
    const example = screen.getByRole("heading", { name: "جرّب مثالًا", level: 2 }).closest("section")!;
    expect(within(example).getByText("350 من 400")).toBeInTheDocument();

    await user.clear(quantity);
    await user.type(quantity, "999");
    await user.tab();
    expect(quantity).toHaveValue(400);
  });

  it("prices each plan from the API and names the Free plan's limits", async () => {
    open(ok(PLANS));

    const free = await screen.findByTestId("landing-plan-free");
    expect(within(free).getByText("مجانًا")).toBeInTheDocument();
    expect(within(free).getByText("مستخدمان")).toBeInTheDocument();
    expect(within(free).getByText("حتى 100 فاتورة بيع شهريًا")).toBeInTheDocument();

    const business = screen.getByTestId("landing-plan-business");
    expect(within(business).getByText("نرشّحها لأغلب الشركات")).toBeInTheDocument();
    expect(within(business).getByText("10 مستخدمين")).toBeInTheDocument();
    expect(within(business).getByText("كل ما في «الأساسية»، ومعه:")).toBeInTheDocument();
    expect(within(business).queryByText("المحاسبة")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "سنويًا" }));
    expect(within(business).getByText(/9,800/)).toBeInTheDocument();
    expect(screen.getByText("وفّر شهرين")).toBeInTheDocument();
  });

  it("does not claim two free months when the console prices a year differently", async () => {
    open(ok(PLANS.map((p) => (p.code === "core" ? { ...p, priceYearly: "5200.00" } : p))));

    await screen.findByTestId("landing-plan-core");
    expect(screen.queryByText("وفّر شهرين")).not.toBeInTheDocument();
  });

  it("offers a retry instead of empty cards when the prices cannot be loaded", async () => {
    open(() => Promise.resolve(new Response("{}", { status: 503 })));

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل الأسعار الآن.");
    expect(screen.getByRole("button", { name: "حاول مرة أخرى" })).toBeInTheDocument();
  });

  it("recomputes the example's entry as the quantity changes, and the entry always balances", async () => {
    open(ok(PLANS));

    const quantity = screen.getByRole("spinbutton", { name: "الكمية (كرتونة)" });
    fireEvent.change(quantity, { target: { value: "10" } });

    const example = screen.getByRole("heading", { name: "جرّب مثالًا", level: 2 }).closest("section")!;
    const totals = within(example).getAllByRole("row").at(-1)!;
    const [debit, credit] = within(totals).getAllByRole("cell").map((cell) => cell.textContent);
    expect(debit).toBe(credit);
    expect(within(example).getByText("390 من 400")).toBeInTheDocument();
  });

  it("keeps the WhatsApp contact hidden until a number is configured", async () => {
    open(ok(PLANS));

    await screen.findByTestId("landing-plan-free");
    expect(screen.queryByText("تحدّث معنا على واتساب")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "تواصل معنا" })).not.toBeInTheDocument();
  });

  it("links to the WhatsApp number the owner set in the console", async () => {
    open(ok(PLANS), "201001234567");

    const links = await screen.findAllByRole("link", { name: "تواصل معنا" });
    for (const link of links) expect(link).toHaveAttribute("href", "https://wa.me/201001234567");
  });
});

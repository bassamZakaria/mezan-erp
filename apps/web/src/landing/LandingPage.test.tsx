// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { SignupModeCode, type PublicPlanDTO } from "@mezan/contracts";
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

function open(response: () => Promise<Response>, mode: SignupModeCode = SignupModeCode.Open) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => (String(input instanceof Request ? input.url : input).endsWith("/status") ? ok({ mode })() : response())),
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

  it("states the trial length read from the live plans, and sends every call to action to signup", async () => {
    open(ok(PLANS));

    expect(await screen.findByText(/جرّب ميزان 14 يومًا بكل المزايا/)).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "ابدأ التجربة المجانية" })) expect(link).toHaveAttribute("href", "/signup");
    for (const link of screen.getAllByRole("link", { name: "تسجيل الدخول" })) expect(link).toHaveAttribute("href", "/dashboard");
  });

  it("asks for an account instead of promising a trial while sign-up needs approval", async () => {
    open(ok(PLANS), SignupModeCode.Approval);

    expect((await screen.findAllByRole("link", { name: "اطلب حسابك" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "ابدأ التجربة المجانية" })).not.toBeInTheDocument();
  });

  it("offers no way to sign up while sign-up is closed, only sign-in", async () => {
    open(ok(PLANS), SignupModeCode.Closed);

    expect(await screen.findByTestId("landing-plan-business")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/signup"))).toEqual([]));
    expect(screen.getAllByRole("link", { name: "تسجيل الدخول" }).length).toBeGreaterThan(0);
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

  it("prices each plan from the API, names the Free plan's limits, and links each card to signup with its plan and cycle", async () => {
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
    expect(within(business).getByRole("link", { name: "ابدأ بهذه الباقة" })).toHaveAttribute("href", "/signup?plan=business&cycle=monthly");

    fireEvent.click(screen.getByRole("radio", { name: "سنويًا" }));
    expect(within(business).getByText(/9,800/)).toBeInTheDocument();
    expect(within(business).getByRole("link", { name: "ابدأ بهذه الباقة" })).toHaveAttribute("href", "/signup?plan=business&cycle=yearly");
    expect(screen.getByText("وفّر شهرين")).toBeInTheDocument();
  });

  it("does not claim two free months when the console prices a year differently", async () => {
    open(ok(PLANS.map((p) => (p.code === "core" ? { ...p, priceYearly: "5200.00" } : p))));

    await screen.findByTestId("landing-plan-core");
    expect(screen.queryByText("وفّر شهرين")).not.toBeInTheDocument();
  });

  it("offers a retry instead of empty cards when the prices cannot be loaded, and drops the day count it cannot know", async () => {
    open(() => Promise.resolve(new Response("{}", { status: 503 })));

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل الأسعار الآن.");
    expect(screen.getByRole("button", { name: "حاول مرة أخرى" })).toBeInTheDocument();
    expect(screen.getByText(/جرّب ميزان بكل المزايا، بلا بطاقة ائتمان/)).toBeInTheDocument();
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
});

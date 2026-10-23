// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { SignupModeCode, type PublicPlanDTO } from "@mezan/contracts";
import { AppI18nProvider } from "../i18n";
import { SignupScreen } from "./SignupScreen";

const plan = (code: string, nameAr: string, priceMonthly: string): PublicPlanDTO => ({
  id: `PLAN-${code}`,
  code,
  nameAr,
  nameEn: code,
  kind: "paid",
  modules: ["accounting"],
  seatsIncluded: 3,
  branchesIncluded: 1,
  warehousesIncluded: 1,
  quotas: {},
  priceMonthly,
  priceYearly: String(Number(priceMonthly) * 10),
  trialDays: 14,
});

function open(path: string, mode: SignupModeCode = SignupModeCode.Approval) {
  const plans = [plan("core", "الأساسية", "490"), plan("business", "الأعمال", "980")];
  const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => (String(input instanceof Request ? input.url : input).endsWith("/status") ? json({ mode }) : json(plans))));
  render(
    <AppI18nProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <SignupScreen />
        </MemoryRouter>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}

describe("SignupScreen — arriving from the pricing page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("selects the plan and billing cycle the visitor chose on the landing page", async () => {
    open("/signup?plan=business&cycle=yearly");

    expect(await screen.findByRole("button", { name: /الأعمال/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /الأساسية/, pressed: false })).toHaveTextContent("4,900");
  });

  it("sends 'sign in' to the app's sign-in, not to / where the cloud site shows its landing page", async () => {
    open("/signup");

    expect(await screen.findByRole("link", { name: "سجّل الدخول" })).toHaveAttribute("href", "/dashboard");
  });

  it("keeps the plan the visitor clicks over the one the pricing page asked for", async () => {
    open("/signup?plan=business&cycle=monthly");
    await screen.findByRole("button", { name: /الأعمال/, pressed: true });

    await userEvent.setup().click(screen.getByRole("button", { name: /الأساسية/ }));

    expect(screen.getByRole("button", { name: /الأساسية/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /الأعمال/, pressed: false })).toBeInTheDocument();
  });

  it("selects nothing for an unknown plan code or cycle, leaving the visitor to choose", async () => {
    open("/signup?plan=platinum&cycle=weekly");

    expect(await screen.findByRole("button", { name: /الأعمال/, pressed: false })).toHaveTextContent("980");
    expect(screen.getByRole("button", { name: /الأساسية/, pressed: false })).toBeInTheDocument();
  });
});

describe("SignupScreen — while sign-up is closed", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows that sign-up is closed and the way to sign in, with no form to fill", async () => {
    open("/signup", SignupModeCode.Closed);

    expect(await screen.findByRole("heading", { name: "التسجيل مغلق حاليًا" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "لديك حساب؟ سجّل الدخول" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});

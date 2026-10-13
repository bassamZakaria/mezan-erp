// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PlatformUnrecordedSecurityEventsDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

const TWO: PlatformUnrecordedSecurityEventsDTO = {
  count: 37,
  dropped: 0,
  corrupted: 0,
  recent: [
    {
      at: "2026-10-12T19:40:11.000Z", module: "platform", action: "CARD_CHECKOUT_SWEEP_RUN", severity: "INFO", actor: "PU-1", entityId: null,
      reason: "audit sink down", details: { examined: 4, paid: 1, stillPending: 3, origin: "41.33.10.10" },
    },
    {
      at: "2026-10-12T19:38:02.000Z", module: "platform", action: "CARD_CHECKOUT_OPENED", severity: "INFO", actor: "paymob", entityId: "t-acme",
      reason: "database is locked", details: { checkoutId: "cc-1", amount: "499.000000", requestedBy: "PU-1" },
    },
  ],
};

function mount(route: string, answer: () => { status?: number; body: unknown }, session = testPlatformSession) {
  const asked: string[] = [];
  renderWithPlatformProviders(<PlatformShell />, {
    route,
    initialSession: session,
    transport: stubPlatformTransport({
      "GET /security/unrecorded": () => {
        asked.push("unrecorded");
        return answer();
      },
      "GET /tenants": () => ({ body: [] }),
    }),
  });
  return asked;
}

describe("the console's page of security events the audit log could not record", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("lists each event with what it was, when, who, why it was not recorded and what it carried", async () => {
    mount("/platform/security", () => ({ body: TWO }));

    expect(await screen.findByRole("heading", { level: 1, name: "أحداث أمنية لم تُسجَّل" })).toBeInTheDocument();
    const rows = await screen.findAllByRole("row");
    const sweep = rows.find((row) => within(row).queryByText("مطابقة عمليات الدفع المعلّقة"))!;
    expect(within(sweep).getByText("audit sink down")).toBeInTheDocument();
    expect(within(sweep).getByText("PU-1")).toBeInTheDocument();
    expect(within(sweep).getByText("2026-10-12 19:40:11")).toBeInTheDocument();
    expect(sweep).toHaveTextContent("فُحصت: 4");
    expect(sweep).toHaveTextContent("مدفوعة: 1");
    expect(sweep).toHaveTextContent("ما زالت معلّقة: 3");

    const opened = rows.find((row) => within(row).queryByText("فتح عملية دفع بالبطاقة"))!;
    expect(within(opened).getByText("t-acme")).toBeInTheDocument();
    expect(within(opened).getByText("database is locked")).toBeInTheDocument();
    expect(opened).toHaveTextContent("cc-1");
  });

  it("names an anonymous actor and a user id in Arabic instead of showing the raw field names", async () => {
    mount("/platform/security", () => ({
      body: {
        count: 1,
        dropped: 0,
        corrupted: 0,
        recent: [{ at: "2026-10-12T19:40:11.000Z", module: "platform", action: "PLATFORM_LOGIN_FAILED", severity: "WARNING", actor: "anonymous", entityId: null, reason: "audit sink down", details: { userId: "PU-9", email: "op@mezan.app" } }],
      },
    }));

    const row = (await screen.findByText("محاولة دخول فاشلة إلى لوحة المنصة")).closest("tr")!;

    expect(within(row).getByText("مجهول (قبل تسجيل الدخول)")).toBeInTheDocument();
    expect(row).toHaveTextContent("المستخدم: PU-9");
    expect(row).not.toHaveTextContent("userId");
    expect(row).not.toHaveTextContent("anonymous");
  });

  it("itemises what is counted and can no longer be shown: events pushed out of the fallback file, and lines it cannot read", async () => {
    mount("/platform/security", () => ({ body: { ...TWO, dropped: 12, corrupted: 2 } }));

    expect(await screen.findByText(/12 حدثاً منها لم يعد محفوظاً/)).toBeInTheDocument();
    expect(screen.getByText(/2 سطراً في ملف الاحتياط تعذّرت قراءته/)).toBeInTheDocument();
  });

  it("says how many were never recorded in all when it shows only the latest of them", async () => {
    mount("/platform/security", () => ({ body: TWO }));

    expect(await screen.findByText("37 حدثاً لم يُسجَّل في سجل التدقيق. المعروض هنا آخر 2 منها.")).toBeInTheDocument();
  });

  it("carries the count on the console's navigation, on every page", async () => {
    mount("/platform/tenants", () => ({ body: TWO }));

    const link = await screen.findByRole("link", { name: /أحداث لم تُسجَّل/ });
    await waitFor(() => expect(within(link).getByText("37")).toBeInTheDocument());
    expect(within(link).getByLabelText("37 حدثاً لم يُسجَّل")).toBeInTheDocument();
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "أحداث أمنية لم تُسجَّل" })).toBeInTheDocument();
  });

  it("marks its own entry, and no other, as the current page in the navigation", async () => {
    mount("/platform/security", () => ({ body: TWO }));

    const link = await screen.findByRole("link", { name: /أحداث لم تُسجَّل/ });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "المنشآت" })).not.toHaveAttribute("aria-current");
  });

  it("says plainly that nothing went unrecorded, and shows no badge and no table", async () => {
    mount("/platform/security", () => ({ body: { count: 0, recent: [] } }));

    expect(await screen.findByText("لا توجد أحداث أمنية لم تُسجَّل. كل حدث أمني على المنصة كُتب في سجل التدقيق.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /أحداث لم تُسجَّل/ });
    expect(within(link).queryByText("0")).not.toBeInTheDocument();
  });

  it("says the list could not be loaded rather than that it is empty, and loads it on retry", async () => {
    let failing = true;
    mount("/platform/security", () => (failing ? { status: 500, body: { error: "INTERNAL", message: "حدث خطأ غير متوقع" } } : { body: TWO }));

    expect(await screen.findByRole("alert")).toHaveTextContent("حدث خطأ غير متوقع");
    expect(screen.queryByText(/لا توجد أحداث أمنية/)).not.toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("فتح عملية دفع بالبطاقة")).toBeInTheDocument();
  });

  it("is not offered to a support operator, who is told the page is the owner's and whose console never asks for the list", async () => {
    const asked = mount("/platform/security", () => ({ status: 403, body: { error: "FORBIDDEN" } }), supportSession);

    expect(await screen.findByText("هذه الصفحة متاحة لمالك المنصة فقط.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /أحداث لم تُسجَّل/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/لا توجد أحداث أمنية/)).not.toBeInTheDocument();
    expect(asked).toEqual([]);
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppI18nProvider } from "../i18n";
import { RouteErrorBoundary } from "./RouteErrorBoundary";

function Boom(): never {
  throw new Error("قيد غير متوازن");
}

function renderRouter(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <div>الرئيسية</div> },
      { path: "/dashboard", element: <div>لوحة التحكم</div> },
      { path: "/boom", element: <Boom />, ErrorBoundary: RouteErrorBoundary },
      { path: "/قيود/:id", element: <Boom />, ErrorBoundary: RouteErrorBoundary },
      {
        path: "/missing",
        loader: () => {
          throw new Response("Not found", { status: 404 });
        },
        ErrorBoundary: RouteErrorBoundary,
      },
      {
        path: "*",
        loader: () => {
          throw new Response("Not found", { status: 404 });
        },
        ErrorBoundary: RouteErrorBoundary,
      },
      ...[401, 403, 500, 503, 418].map((status) => ({
        path: `/refused/${status}`,
        loader: () => {
          throw new Response(`Server said ${status}`, { status, statusText: "Raw Server Text" });
        },
        ErrorBoundary: RouteErrorBoundary,
      })),
    ],
    { initialEntries },
  );
  return render(
    <AppI18nProvider>
      <RouterProvider router={router} />
    </AppI18nProvider>,
  );
}

describe("RouteErrorBoundary", () => {
  it("renders role=alert with the Arabic generic title/body and the raw error detail for a thrown Error", () => {
    renderRouter(["/boom"]);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("تعذّر عرض هذه الشاشة")).toBeInTheDocument();
    // guards §4.5 #13 — «تعذّر عرض هذه الشاشة» is the same sentence on all 118
    // screens, so the route the boundary caught is appended as a support code.
    expect(
      screen.getByText(
        "حدث خطأ أثناء تحميل الشاشة. بقية البرنامج ما زالت تعمل — يمكنك إعادة المحاولة أو الرجوع إلى لوحة التحكم. رمز الشاشة للدعم: /boom",
      ),
    ).toBeInTheDocument();
    // The raw detail is shown too — intentional, not a stack trace substitute for the Arabic copy.
    expect(screen.getByText("قيد غير متوازن")).toBeInTheDocument();
  });

  it("renders the DIFFERENT Arabic not-found title/body for a 404 route error, not the generic copy", async () => {
    renderRouter(["/missing"]);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("الصفحة غير موجودة")).toBeInTheDocument();
    expect(screen.getByText("العنوان المطلوب لا يوافق أي شاشة. ربما تغيّر الرابط أو حُذف المستند.")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر عرض هذه الشاشة")).not.toBeInTheDocument();
  });

  it("never renders raw English enum text or a bare stack trace as the TITLE — the title is always the Arabic copy", () => {
    renderRouter(["/boom"]);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toHaveTextContent("تعذّر عرض هذه الشاشة");
  });

  it("the go-home button navigates to /dashboard", async () => {
    renderRouter(["/boom"]);
    fireEvent.click(screen.getByRole("button", { name: "لوحة التحكم" }));
    await waitFor(() => expect(screen.getByText("لوحة التحكم")).toBeInTheDocument());
  });

  it("renders a retry button labelled with the Arabic retry copy", () => {
    renderRouter(["/boom"]);
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("says which address was not found in Arabic, and never prints the server's own words for it", async () => {
    renderRouter(["/missing"]);

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("العنوان المطلوب: /missing");
    expect(screen.getByText("/missing")).toHaveAttribute("dir", "ltr");
    expect(alert).not.toHaveTextContent(/not found/i);
  });

  it("prints an Arabic address that was not found the way it reads, not percent-encoded, and lets it wrap anywhere so a long one stays inside a narrow screen", async () => {
    renderRouter([`/${encodeURIComponent("تقارير")}/${encodeURIComponent("المبيعات-الشهرية")}`]);

    const alert = await screen.findByRole("alert");
    const address = screen.getByText("/تقارير/المبيعات-الشهرية");

    expect(alert).toHaveTextContent("العنوان المطلوب: /تقارير/المبيعات-الشهرية");
    expect(alert).not.toHaveTextContent("%D8");
    expect(address).toHaveAttribute("dir", "ltr");
    expect(address).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("prints the support code of a screen at an Arabic address the way it reads, in a line that wraps anywhere", () => {
    renderRouter([`/${encodeURIComponent("قيود")}/7`]);

    const body = screen.getByText(/رمز الشاشة للدعم: /);

    expect(body).toHaveTextContent("رمز الشاشة للدعم: /قيود/7");
    expect(body).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("prints the address as it was typed when it cannot be decoded", async () => {
    renderRouter(["/%E0%A4%A"]);

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("العنوان المطلوب: /%E0%A4%A");
  });

  it.each([
    [401, "انتهت الجلسة أو لم يُسجَّل الدخول (401)."],
    [403, "لا تملك صلاحية عرض هذه الشاشة (403)."],
    [500, "الخادم لم يُجب كما يجب (500). حاول بعد قليل."],
    [503, "الخادم لم يُجب كما يجب (503). حاول بعد قليل."],
    [418, "رمز الخطأ: 418"],
  ])("explains a refusal with status %i in Arabic, and never prints the response's own text", async (status, line) => {
    renderRouter([`/refused/${status}`]);

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(line);
    expect(alert).not.toHaveTextContent("Server said");
    expect(alert).not.toHaveTextContent("Raw Server Text");
  });
});

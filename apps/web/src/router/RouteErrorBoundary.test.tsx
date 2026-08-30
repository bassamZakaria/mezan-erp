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
      {
        path: "/missing",
        loader: () => {
          throw new Response("Not found", { status: 404 });
        },
        ErrorBoundary: RouteErrorBoundary,
      },
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
    expect(
      screen.getByText("حدث خطأ أثناء تحميل الشاشة. بقية البرنامج ما زالت تعمل — يمكنك إعادة المحاولة أو الرجوع إلى لوحة التحكم."),
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
});

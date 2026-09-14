// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppI18nProvider } from "../i18n";
import { PlatformApp } from "./PlatformApp";
import { stubPlatformTransport, testPlatformSession } from "./test-support";

/** Mirrors the real mount in `router/routes.tsx`: `{ path: "/platform/*", Component: PlatformApp }`. */
function renderApp(options: Parameters<typeof PlatformApp>[0] & { route?: string } = {}) {
  const { route, ...appProps } = options;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AppI18nProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route ?? "/platform"]}>
          <Routes>
            <Route path="/platform/*" element={<PlatformApp {...appProps} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}

describe("PlatformApp", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the login door when there is no session", () => {
    renderApp({ transport: stubPlatformTransport({}) });
    expect(screen.getByRole("heading", { name: "تسجيل دخول المنصة" })).toBeInTheDocument();
  });

  it("renders the shell with the rail (tenants, plans, operators, sign-out) when a session exists", () => {
    renderApp({ transport: stubPlatformTransport({}), initialSession: testPlatformSession });
    expect(screen.getByRole("link", { name: "المنشآت" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "الباقات" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "المشغّلون" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تسجيل الخروج" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "المنشآت" })).toBeInTheDocument();
  });

  it("falls back to the login door once signed out from the shell", () => {
    renderApp({ transport: stubPlatformTransport({}), initialSession: testPlatformSession });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));
    expect(screen.getByRole("heading", { name: "تسجيل دخول المنصة" })).toBeInTheDocument();
  });
});

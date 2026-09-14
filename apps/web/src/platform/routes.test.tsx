// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppI18nProvider } from "../i18n";
import { routes } from "../router/routes";

/**
 * Exercises the REAL route table (`router/routes.tsx`), not a stand-in —
 * removing the `/platform/*` entry, or pointing it at the wrong component,
 * fails this test even though every other `platform/*.test.tsx` file (which
 * renders `PlatformApp` directly) would keep passing.
 */
describe("routes — /platform/*", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("mounts the platform console's login door at /platform/login", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ["/platform/login"] });
    render(
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppI18nProvider>,
    );
    expect(await screen.findByRole("heading", { name: "تسجيل دخول المنصة" })).toBeInTheDocument();
  });

  it("redirects an already signed-in operator away from /platform/login and gives the rail absolute hrefs", async () => {
    localStorage.setItem(
      "mezan.platform.session",
      JSON.stringify({ token: "TEST-TOKEN", user: { id: "PU-1", email: "owner@mezan.example", role: "owner" } }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ["/platform/login"] });
    render(
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AppI18nProvider>,
    );
    expect(await screen.findByRole("heading", { name: "المنشآت" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "المنشآت" })).toHaveAttribute("href", "/platform/tenants");
    expect(screen.getByRole("link", { name: "الباقات" })).toHaveAttribute("href", "/platform/plans");
  });
});

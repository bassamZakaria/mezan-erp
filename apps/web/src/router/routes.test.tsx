// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProviders } from "../data/AppProviders";
import { routes } from "./routes";

function renderAt(path: string) {
  render(
    <AppProviders>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </AppProviders>,
  );
}

describe("routes — doors loaded on demand", () => {
  it("mounts the owner hand-over screen at /signup/owner-handover", async () => {
    renderAt("/signup/owner-handover?token=t");
    expect(await screen.findByRole("heading", { name: "تأكيد نقل ملكية المنشأة" })).toBeInTheDocument();
  });

  it.each(["/signup", "/signup/verify?token=t"])("sends a retired signup link %s to the front door", async (path) => {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/^\/signup/));
  });

  it("mounts the unlock-link screen at /unlock", async () => {
    renderAt("/unlock");
    expect(await screen.findByRole("heading", { name: "فكّ قفل الحساب" })).toBeInTheDocument();
  });

  it("mounts the reset-password screen at /reset-password", async () => {
    renderAt("/reset-password");
    expect(await screen.findByRole("heading", { name: "تعيين كلمة مرور جديدة" })).toBeInTheDocument();
  });
});

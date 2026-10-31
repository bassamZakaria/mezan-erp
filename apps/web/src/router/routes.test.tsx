// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("mounts the signup flow at /signup", async () => {
    renderAt("/signup");
    expect(await screen.findByRole("heading", { name: "أنشئ حساب ميزان" })).toBeInTheDocument();
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

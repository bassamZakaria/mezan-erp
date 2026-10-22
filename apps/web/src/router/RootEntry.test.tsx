// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "../data/ApiContext";
import { RootEntry } from "./RootEntry";

const APP = <p>the app</p>;

function markCloudSite() {
  const meta = document.createElement("meta");
  meta.name = "mezan-site";
  meta.content = "cloud";
  document.head.append(meta);
}

function open(path: string) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }))));
  render(
    <AppI18nProvider>
      <QueryClientProvider client={new QueryClient()}>
        <ApiProvider initialSession={null}>
          <MemoryRouter initialEntries={[path]}>
            <RootEntry app={APP} />
          </MemoryRouter>
        </ApiProvider>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}

describe("RootEntry", () => {
  afterEach(() => {
    document.head.querySelectorAll('meta[name="mezan-site"]').forEach((meta) => meta.remove());
    vi.unstubAllGlobals();
  });

  it("opens the app, not a marketing page, on a build no cloud server marked (desktop, LAN)", () => {
    open("/");

    expect(screen.getByText("the app")).toBeInTheDocument();
  });

  it("shows a signed-out visitor to the cloud site the landing page at /", async () => {
    markCloudSite();
    open("/");

    expect(await screen.findByRole("heading", { level: 1, name: /حساباتك ومخزنك ومبيعاتك/ })).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
  });

  it("keeps every other address on the cloud site in the app, so a deep link still reaches sign-in", () => {
    markCloudSite();
    open("/sales-invoices");

    expect(screen.getByText("the app")).toBeInTheDocument();
  });
});

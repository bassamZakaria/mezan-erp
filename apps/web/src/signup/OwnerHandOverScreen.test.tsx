// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AppI18nProvider } from "../i18n";
import { SignupApp } from "./SignupApp";

function open(status: number, body: unknown, url = "/signup/owner-handover?token=the-token") {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
  );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <AppI18nProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[url]}>
          <SignupApp />
        </MemoryRouter>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
  return fetchMock;
}

describe("the owner hand-over confirmation page", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms nothing by merely being opened, so a mail scanner that follows the link changes nothing", async () => {
    const fetchMock = open(200, { confirmed: true });

    expect(await screen.findByRole("heading", { name: "تأكيد نقل ملكية المنشأة", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أؤكّد نقل الملكية" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the token once the previous owner presses confirm, then says it is done", async () => {
    const fetchMock = open(200, { confirmed: true });

    fireEvent.click(await screen.findByRole("button", { name: "أؤكّد نقل الملكية" }));

    expect(await screen.findByText("تم تأكيد نقل الملكية. أصبح الحساب الجديد مالك المنشأة.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/signup/owner-handover");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ token: "the-token" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "أؤكّد نقل الملكية" })).not.toBeInTheDocument());
  });

  it("shows the server's Arabic refusal for a link that is wrong or already used", async () => {
    open(400, { error: "OWNER_HANDOVER_LINK_INVALID", message: "رابط التأكيد غير صالح أو سبق استخدامه." });

    fireEvent.click(await screen.findByRole("button", { name: "أؤكّد نقل الملكية" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("رابط التأكيد غير صالح أو سبق استخدامه.");
  });

  it("says in Arabic that the connection failed, never the browser's own words, and confirms on the retry", async () => {
    let down = true;
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      down ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve(new Response(JSON.stringify({ confirmed: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AppI18nProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={["/signup/owner-handover?token=the-token"]}>
            <SignupApp />
          </MemoryRouter>
        </QueryClientProvider>
      </AppI18nProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "أؤكّد نقل الملكية" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    down = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("تم تأكيد نقل الملكية. أصبح الحساب الجديد مالك المنشأة.")).toBeInTheDocument();
  });

  it("says the link is incomplete when it carries no token, and offers nothing to press", async () => {
    open(200, {}, "/signup/owner-handover");

    expect(await screen.findByRole("alert")).toHaveTextContent("رابط التأكيد ناقص.");
    expect(screen.queryByRole("button", { name: "أؤكّد نقل الملكية" })).not.toBeInTheDocument();
  });
});

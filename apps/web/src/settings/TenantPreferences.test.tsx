// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFormat } from "@mezan/ui";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "../data/ApiContext";
import { createQueryClient } from "../data/queryClient";
import { stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";
import { TenantPreferences } from "./TenantPreferences";

function NumeralsProbe() {
  const { numerals } = useFormat();
  return <span data-testid="numerals">{numerals}</span>;
}

function makeWrapper(transport: Transport) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={testAdminSession}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { Wrapper, queryClient };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute("lang", "ar");
  document.documentElement.setAttribute("dir", "rtl");
});

afterEach(() => {
  window.localStorage.clear();
});

describe("TenantPreferences", () => {
  it("always renders its children, even before settings has loaded", () => {
    const transport = stubTransport({ "GET /settings/lookup": () => new Promise(() => {}) as never });
    const { Wrapper } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <span>محتوى التطبيق</span>
        </TenantPreferences>
      </Wrapper>,
    );
    expect(screen.getByText("محتوى التطبيق")).toBeInTheDocument();
  });

  it("applies the tenant's default language when the browser has no locale of its own yet", async () => {
    const transport = stubTransport({ "GET /settings/lookup": () => ({ body: { language: "en", dateNumerals: "western" } }) });
    const { Wrapper } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <span>x</span>
        </TenantPreferences>
      </Wrapper>,
    );
    await waitFor(() => expect(document.documentElement.getAttribute("lang")).toBe("en"));
  });

  it("never overwrites a locale the browser/user has already chosen", async () => {
    window.localStorage.setItem("mezan.locale", "ar");
    const transport = stubTransport({ "GET /settings/lookup": () => ({ body: { language: "en", dateNumerals: "western" } }) });
    const { Wrapper } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <span>x</span>
        </TenantPreferences>
      </Wrapper>,
    );
    // Give the settings query and effect a chance to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("never applies 'de' as the interface language, even with no persisted locale", async () => {
    const transport = stubTransport({ "GET /settings/lookup": () => ({ body: { language: "de", dateNumerals: "western" } }) });
    const { Wrapper } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <span>x</span>
        </TenantPreferences>
      </Wrapper>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("applies the language only ONCE — a later settings refetch with a different language does not re-apply", async () => {
    let call = 0;
    const transport = stubTransport({
      "GET /settings/lookup": () => {
        call += 1;
        return { body: { language: call === 1 ? "en" : "fr", dateNumerals: "western" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <span>x</span>
        </TenantPreferences>
      </Wrapper>,
    );
    await waitFor(() => expect(document.documentElement.getAttribute("lang")).toBe("en"));

    // A user picks Arabic manually elsewhere in the app after the tenant
    // default was applied — this must survive a later settings refetch.
    window.localStorage.setItem("mezan.locale", "ar");
    document.documentElement.setAttribute("lang", "ar");
    await queryClient.refetchQueries({ queryKey: ["settings"] });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.documentElement.getAttribute("lang")).toBe("ar");
  });

  it("passes the tenant's dateNumerals preference into the numerals context for children to read", async () => {
    const transport = stubTransport({ "GET /settings/lookup": () => ({ body: { language: "ar", dateNumerals: "arabic" } }) });
    const { Wrapper } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <NumeralsProbe />
        </TenantPreferences>
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByTestId("numerals")).toHaveTextContent("arabic"));
  });

  it("defaults numerals to 'western' before settings has loaded", () => {
    const transport = stubTransport({ "GET /settings/lookup": () => new Promise(() => {}) as never });
    const { Wrapper } = makeWrapper(transport);
    render(
      <Wrapper>
        <TenantPreferences>
          <NumeralsProbe />
        </TenantPreferences>
      </Wrapper>,
    );
    expect(screen.getByTestId("numerals")).toHaveTextContent("western");
  });
});

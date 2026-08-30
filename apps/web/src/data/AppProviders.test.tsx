// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { useApi } from "./ApiContext";
import { renderWithProviders, stubTransport, testAdminSession } from "./test-support";

function Probe() {
  const { session } = useApi();
  return <div data-testid="probe">{session ? session.nameAr : "signed-out"}</div>;
}

describe("AppProviders", () => {
  it("wires ApiProvider, QueryClientProvider and i18n so a descendant can call useApi", () => {
    renderWithProviders(<Probe />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(screen.getByTestId("probe")).toHaveTextContent(testAdminSession.nameAr);
  });

  it("starts signed out when no initialSession is given", () => {
    renderWithProviders(<Probe />, { transport: stubTransport({}), initialSession: null });
    expect(screen.getByTestId("probe")).toHaveTextContent("signed-out");
  });

  it("sets Arabic as the document direction by default (AppI18nProvider)", () => {
    renderWithProviders(<Probe />, { transport: stubTransport({}), initialSession: null });
    expect(document.documentElement.dir).toBe("rtl");
  });
});

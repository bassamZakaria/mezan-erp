// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { EtaScreen } from "./EtaScreen";
import { RecurringJournalsScreen } from "./enh/recurring-journals/RecurringJournalsScreen";

const branchUser = { ...testAdminSession, isCompanyAdmin: false, branchScope: ["BR-ALEX"] };

describe("a tab backed by a company-wide family, for a branch-restricted user (D111)", () => {
  it("the e-invoicing rejections tab says the report is the whole company's instead of drawing nothing", async () => {
    renderWithProviders(<EtaScreen />, { transport: stubTransport({}), initialSession: branchUser, route: "/?tab=rejections" });
    expect(await screen.findByTestId("branch-unavailable")).toBeInTheDocument();
  });

  it("the recurring-journal history tab stays for a branch user, whose own runs it lists", async () => {
    const transport = stubTransport({ "GET /gl/recurring/templates": () => ({ body: [] }) });
    renderWithProviders(<RecurringJournalsScreen />, { transport, initialSession: branchUser });
    expect(await screen.findByRole("tab", { name: "السجل" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "المستحق" })).not.toBeInTheDocument();
  });
});

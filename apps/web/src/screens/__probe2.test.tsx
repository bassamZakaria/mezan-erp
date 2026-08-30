// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { ProjectsScreen } from "./ProjectsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

describe("probe", () => {
  it("tabs", async () => {
    const transport = stubTransport({
      "GET /projects": () => ({
        body: [
          { id: "prj-1", code: "TOWER-A", nameAr: "برج الأفق", nameEn: null, status: "planned", customerId: null, managerId: null, startDate: null, endDate: null, budget: "0", siteAddress: null, notes: null, costCenterId: "CC-1" },
          { id: "prj-2", code: "VILLA-B", nameAr: "فيلا النخيل", nameEn: null, status: "active", customerId: null, managerId: null, startDate: null, endDate: null, budget: "0", siteAddress: null, notes: null, costCenterId: "CC-2" },
        ],
      }),
      "GET /customers": () => ({ body: [] }),
      "GET /users": () => ({ body: [] }),
    });
    renderWithProviders(<ProjectsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("برج الأفق");
    const tabs = screen.getAllByRole("tab");
    console.log("TABS:", tabs.map((t) => t.textContent));
    fireEvent.click(screen.getByRole("tab", { name: /^نشط/ }));
    console.log("AFTER CLICK planned present:", screen.queryByText("برج الأفق") !== null);
    console.log("AFTER CLICK active present:", screen.queryByText("فيلا النخيل") !== null);
  });
});

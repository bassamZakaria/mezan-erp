// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NewSessionView } from "./NewSessionView";
import { TestNavigation, renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

afterEach(cleanup);

const tea = { id: "itm-tea", code: "TEA-1", nameAr: "شاي أسود", nameEn: null, barcodes: [], type: "stock", status: "active" };

describe("NewSessionView — ad-hoc zone item search", () => {
  it("searches the server one small page at a time and keeps the chosen item's name on its chip", async () => {
    const itemRequests: string[] = [];
    const transport = stubTransport({
      "GET /warehouses": () => ({ body: [] }),
      "GET /item-categories": () => ({ body: [] }),
      "GET /inventory/count-mode/counters": () => ({ body: [] }),
      "GET /items": (_init, path) => {
        itemRequests.push(path);
        return { body: [tea] };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <NewSessionView />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );

    fireEvent.click(screen.getByRole("combobox", { name: "نوع المنطقة" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "أصناف محددة" }));
    fireEvent.change(screen.getByLabelText("ابحث عن صنف"), { target: { value: "شاي" } });
    fireEvent.click(await screen.findByRole("button", { name: /شاي أسود/ }));

    expect(await screen.findByRole("button", { name: "إزالة شاي أسود" })).toBeInTheDocument();
    expect(itemRequests.some((path) => path.includes(`search=${encodeURIComponent("شاي")}`))).toBe(true);
    for (const path of itemRequests) expect(new URLSearchParams(path.split("?")[1]).get("page")).toBe("1");
  });
});

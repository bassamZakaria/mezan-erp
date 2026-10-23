// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { AccountingHubScreen } from "./AccountingHubScreen";
import { ItemsHubScreen } from "./ItemsHubScreen";
import { PurchasesHubScreen } from "./PurchasesHubScreen";
import { NavigationProvider } from "../../navigation";
import type { Session } from "../../data/session";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

const REFUSED = { status: 403, body: { error: "PERMISSION_DENIED" } };
const ENTITLEMENTS = { plan: "pro", activeModules: ["dashboard", "sales", "purchases", "inventory", "accounting", "manufacturing", "treasury", "hr"], features: {}, seats: 10, expiresAt: null };

const seat = (permissions: string[]): Session => ({ ...testAdminSession, userId: "USER-SEAT", isCompanyAdmin: false, permissions: ["dashboard.view", ...permissions], roleCode: "SEAT" });

function open(hub: ReactNode, permissions: string[], served: Record<string, unknown>, withheld: readonly string[]) {
  const asked: string[] = [];
  const handlers: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = { "GET /entitlements": () => ({ body: ENTITLEMENTS }) };
  for (const [path, body] of Object.entries(served)) handlers[`GET ${path}`] = () => (asked.push(path), { body });
  for (const path of withheld) handlers[`GET ${path}`] = () => (asked.push(path), REFUSED);
  renderWithProviders(
    <NavigationProvider value={{ navigate: (() => {}) as never, segments: [], openSubPage: () => {}, openScreenAt: () => {}, intent: null, clearIntent: () => {} }}>{hub}</NavigationProvider>,
    { transport: stubTransport(handlers), initialSession: seat(permissions) },
  );
  return asked;
}

describe("a hub opened by a seat that may read only part of what it shows", () => {
  it("purchases: without the right to read goods receipts, the hub shows the other tiles, no receipts tile, no error, and never asks for receipts", async () => {
    const asked = open(<PurchasesHubScreen />, ["purchases.order.view", "purchases.invoice.view", "purchases.supplier.view"], { "/purchases/orders": [], "/purchases/invoices": [], "/purchases/invoices/counts": { all: 0 }, "/suppliers": [] }, ["/purchases/receipts"]);

    await waitFor(() => expect(asked).toEqual(expect.arrayContaining(["/purchases/orders", "/purchases/invoices", "/suppliers"])));
    await waitFor(() => expect(screen.getByText("أوامر شراء مفتوحة")).toBeInTheDocument());

    expect(asked).not.toContain("/purchases/receipts");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("استلامات غير مفوترة")).toBeNull();
  });

  it("accounting: without the right to read fiscal periods, the hub shows the accounts tile, no periods tile, no error, and never asks for periods", async () => {
    const asked = open(<AccountingHubScreen />, ["accounting.coa.view"], { "/accounts": [] }, ["/fiscal-periods", "/dashboard/summary"]);

    await waitFor(() => expect(asked).toContain("/accounts"));
    await waitFor(() => expect(screen.getByText("عدد الحسابات")).toBeInTheDocument());

    expect(asked).not.toContain("/fiscal-periods");
    expect(asked).not.toContain("/dashboard/summary");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("الفترات المالية المفتوحة")).toBeNull();
  });

  it("items: without the rights behind templates, configurable products and recipes, the hub asks for none of the three", async () => {
    const asked = open(<ItemsHubScreen />, ["inventory.item.view"], { "/items/counts": {}, "/item-specifications": [] }, ["/inventory/product-templates", "/manufacturing/configurable-products", "/manufacturing/boms"]);

    await waitFor(() => expect(asked).toContain("/items/counts"));

    expect(asked.filter((path) => path.startsWith("/inventory/product-templates") || path.startsWith("/manufacturing/"))).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

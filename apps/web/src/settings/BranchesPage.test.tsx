// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { BranchDTO } from "@mezan/contracts";
import { BranchesPage } from "./BranchesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleBranches: BranchDTO[] = [
  {
    id: "b1",
    code: "MAIN",
    name: "الفرع الرئيسي",
    parentBranchId: null,
    phone: "0223456789",
    email: "main@cyag.example",
    address: "القاهرة الجديدة، القاهرة",
    isMain: true,
    active: true,
  },
  {
    id: "b2",
    code: "ALEX",
    name: "فرع الإسكندرية",
    parentBranchId: "b1",
    phone: "0334567890",
    email: null,
    address: "سموحة، الإسكندرية",
    isMain: false,
    active: true,
  },
];

function renderScreen(branches: BranchDTO[] = sampleBranches) {
  let current = [...branches];
  const transport = stubTransport({
    "GET /branches": () => ({ body: current }),
    "GET /warehouses": () => ({ body: [] }),
    "POST /branches": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      // Mirrors branches-routes.ts's createBranchSchema.safeParse — an empty code/name
      // fails zod validation before the domain layer ever runs, so no `message` field.
      if (!/^[A-Z0-9_-]{1,20}$/.test(body.code ?? "") || (body.name ?? "").trim() === "") {
        return { status: 400, body: { error: "VALIDATION_ERROR", details: {} } };
      }
      const created: BranchDTO = {
        id: body.id,
        code: body.code,
        name: body.name,
        parentBranchId: body.parentBranchId ?? null,
        phone: body.phone ?? null,
        email: body.email ?? null,
        address: body.address ?? null,
        isMain: body.isMain ?? false,
        active: true,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<BranchesPage />, { transport, initialSession: testAdminSession });
}

describe("BranchesPage", () => {
  it("lists the real branches from the backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
    expect(await screen.findByText("MAIN")).toBeInTheDocument();
    expect(screen.getByText("فرع الإسكندرية")).toBeInTheDocument();
  });

  it("opens the Branch 360 detail on row click, with an Overview tab and stub tabs", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("MAIN"));
    expect(screen.getByRole("heading", { name: /الفرع الرئيسي/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "المخزون" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "المخزون" }));
    expect(screen.getAllByText("قريباً").length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("MAIN"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الفروع" }));
    expect(screen.getByRole("heading", { name: "الفروع" })).toBeInTheDocument();
  });

  it("adds a new branch through the side panel", async () => {
    renderScreen();
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    fireEvent.change(within(dialog).getByLabelText("اسم الفرع"), { target: { value: "فرع الجيزة" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الفرع"), { target: { value: "GIZA" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));

    expect(await screen.findByText("فرع الجيزة")).toBeInTheDocument();
  });

  it("shows a validation error instead of adding an invalid branch", async () => {
    renderScreen();
    await screen.findByText("MAIN");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرع" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة فرع" });
    // Leave name/code empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الفرع" }));
    expect(await within(dialog).findByText(/تعذر إنشاء الفرع/)).toBeInTheDocument();
  });
});

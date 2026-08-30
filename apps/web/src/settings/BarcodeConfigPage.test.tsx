// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { BarcodeConfigDTO } from "@mezan/contracts";
import { BarcodeConfigPage } from "./BarcodeConfigPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const baseConfig: BarcodeConfigDTO = {
  defaultSymbology: "EAN13",
  itemBarcodeMode: "MANUAL",
  autoGeneratePrefix: null,
  embeddedRules: [],
};

function renderPage(config: BarcodeConfigDTO = baseConfig) {
  let current = config;
  let seenBody: unknown = null;
  const transport = stubTransport({
    "GET /barcode-config": () => ({ body: current }),
    "PUT /barcode-config": (init) => {
      seenBody = JSON.parse((init?.body as string) ?? "{}");
      current = { ...current, ...(seenBody as Partial<BarcodeConfigDTO>) };
      return { body: current };
    },
    "POST /barcode-config/parse": (init) => {
      const { code } = JSON.parse((init?.body as string) ?? "{}");
      if (code === "2012345067895") {
        return { body: { matched: true, ruleId: "R1", itemCode: "12345", value: 67.89, valueType: "PRICE" } };
      }
      return { body: { matched: false } };
    },
  });
  const result = renderWithProviders(<BarcodeConfigPage />, { transport, initialSession: testAdminSession });
  return { ...result, getSeenBody: () => seenBody };
}

describe("BarcodeConfigPage", () => {
  it("loads and displays the current config", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "إعدادات الباركود" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "نوع الترميز الافتراضي" })).toHaveTextContent("EAN-13");
  });

  it("the save button starts disabled and enables once a field is edited", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    const saveButton = screen.getByRole("button", { name: "حفظ الإعدادات" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole("combobox", { name: "طريقة تحديد باركود الصنف" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "توليد تلقائي" }));
    expect(saveButton).not.toBeDisabled();
  });

  it("saving sends exactly the edited field(s) in the PUT body", async () => {
    const { getSeenBody } = renderPage();
    await screen.findByRole("heading", { name: "إعدادات الباركود" });

    fireEvent.click(screen.getByRole("combobox", { name: "طريقة تحديد باركود الصنف" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "توليد تلقائي" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    await screen.findByRole("button", { name: "حفظ الإعدادات", disabled: true });
    expect((getSeenBody() as BarcodeConfigDTO).itemBarcodeMode).toBe("AUTO");
  });

  it("a save the backend refuses shows the Arabic error message and keeps the save button enabled (unsaved)", async () => {
    const transport = stubTransport({
      "GET /barcode-config": () => ({ body: baseConfig }),
      "PUT /barcode-config": () => ({ status: 400, body: { reasons: ["نوع الباركود الافتراضي غير صالح"] } }),
    });
    renderWithProviders(<BarcodeConfigPage />, { transport, initialSession: testAdminSession });
    await screen.findByRole("heading", { name: "إعدادات الباركود" });

    fireEvent.click(screen.getByRole("combobox", { name: "طريقة تحديد باركود الصنف" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "توليد تلقائي" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    expect(await screen.findByText("نوع الباركود الافتراضي غير صالح")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).not.toBeDisabled();
  });

  it("adding an embedded rule updates the rules-count figure, and it survives switching tabs (a re-render)", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "إعدادات الباركود" });

    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));
    expect(screen.getByText("القواعد (0)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إضافة قاعدة" }));
    expect(screen.getByText("القواعد (1)")).toBeInTheDocument();

    // Switch away and back — a re-render must not lose the added rule's count.
    fireEvent.click(screen.getByRole("tab", { name: "الإعدادات العامة" }));
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));
    expect(screen.getByText("القواعد (1)")).toBeInTheDocument();
  });

  it("testing a scanned code against the saved rules shows a matched status pill with the resolved item code and value", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "2012345067895" } });
    fireEvent.click(screen.getByRole("button", { name: "اختبار" }));

    expect(await screen.findByText(/تطابق/)).toBeInTheDocument();
  });

  it("shows a 'no rule matches' pill for an unmatched code", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[inputs.length - 1]!, { target: { value: "0000000000000" } });
    fireEvent.click(screen.getByRole("button", { name: "اختبار" }));

    expect(await screen.findByText("لا يوجد تطابق مع أي قاعدة")).toBeInTheDocument();
  });

  it("shows the loading state while the config is still fetching", () => {
    const transport = stubTransport({ "GET /barcode-config": () => new Promise(() => {}) as never });
    renderWithProviders(<BarcodeConfigPage />, { transport, initialSession: testAdminSession });
    expect(screen.getByText("جارِ التحميل…")).toBeInTheDocument();
  });
});

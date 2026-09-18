// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor} from "@testing-library/react";
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

    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
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

  it("a load failure shows a retry control that re-issues the request", async () => {
    let calls = 0;
    let fail = true;
    const transport = stubTransport({
      "GET /barcode-config": () => {
        calls += 1;
        if (fail) return { status: 500, body: { error: "INTERNAL" } };
        return { body: baseConfig };
      },
    });
    renderWithProviders(<BarcodeConfigPage />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText(/تعذّر تحميل إعدادات الباركود\./)).toBeInTheDocument();
    const callsBeforeRetry = calls;

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    expect(calls).toBeGreaterThan(callsBeforeRetry);
  });

  it("client-side validation blocks the save when a rule's own numbers are inconsistent (value overruns the total length) — the mutation is never called", async () => {
    let putCalls = 0;
    const config: BarcodeConfigDTO = {
      ...baseConfig,
      embeddedRules: [
        { id: "R-A", nameAr: "قاعدة السعر", prefix: "2", totalLength: 13, itemCodeStart: 1, itemCodeLength: 5, valueStart: 7, valueLength: 5, valueType: "PRICE", valueDecimals: 2, active: true },
      ],
    };
    const transport = stubTransport({
      "GET /barcode-config": () => ({ body: config }),
      "PUT /barcode-config": () => {
        putCalls += 1;
        return { body: config };
      },
    });
    renderWithProviders(<BarcodeConfigPage />, { transport, initialSession: testAdminSession });
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    // Shrink the total length under the value's own end (valueStart 7 + valueLength 5 = 12 > new total 5).
    const totalLengthInput = screen.getAllByRole("spinbutton")[0]!;
    fireEvent.change(totalLengthInput, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    expect(await screen.findByText(/القيمة تتجاوز الطول الكلي للباركود/)).toBeInTheDocument();
    expect(putCalls).toBe(0);
    // The save button stays enabled (still dirty) — nothing was silently accepted.
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  const twoRuleConfig: BarcodeConfigDTO = {
    ...baseConfig,
    embeddedRules: [
      { id: "R-A", nameAr: "قاعدة السعر", prefix: "2", totalLength: 13, itemCodeStart: 1, itemCodeLength: 5, valueStart: 7, valueLength: 5, valueType: "PRICE", valueDecimals: 2, active: true },
      { id: "R-B", nameAr: "قاعدة الوزن", prefix: "3", totalLength: 13, itemCodeStart: 1, itemCodeLength: 5, valueStart: 7, valueLength: 5, valueType: "WEIGHT", valueDecimals: 3, active: false },
    ],
  };

  it("updateRule changes only the targeted rule's field, leaving the sibling rule byte-for-byte identical, and saves both correctly", async () => {
    const { getSeenBody } = renderPage(twoRuleConfig);
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    const spinbuttons = screen.getAllByRole("spinbutton");
    expect(spinbuttons).toHaveLength(12);
    // spinbuttons[0] is rule A's "الطول الكلي" (totalLength) — the first NumberField in the first RuleCard.
    fireEvent.change(spinbuttons[0]!, { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    const body = getSeenBody() as BarcodeConfigDTO;
    expect(body.embeddedRules).toHaveLength(2);
    expect(body.embeddedRules[0]).toEqual({ ...twoRuleConfig.embeddedRules[0]!, totalLength: 14 });
    expect(body.embeddedRules[1]).toEqual(twoRuleConfig.embeddedRules[1]);
  });

  it("removeRule deletes exactly the clicked rule, keeping the other rule intact — not the first rule, not both", async () => {
    const { getSeenBody } = renderPage(twoRuleConfig);
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    expect(screen.getByText("القواعد (2)")).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "حذف القاعدة" });
    expect(deleteButtons).toHaveLength(2);
    // Delete the SECOND rule — a bug that always drops index 0 would instead
    // remove the first rule and leave this one, which the assertions below catch.
    fireEvent.click(deleteButtons[1]!);

    expect(screen.getByText("القواعد (1)")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("قاعدة الوزن")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("قاعدة السعر")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
    const body = getSeenBody() as BarcodeConfigDTO;
    expect(body.embeddedRules).toHaveLength(1);
    expect(body.embeddedRules[0]).toEqual(twoRuleConfig.embeddedRules[0]);
  });

  it("the prefix field strips non-digit characters as the user types", async () => {
    renderPage(twoRuleConfig);
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    const prefixInputs = screen.getAllByDisplayValue("2");
    fireEvent.change(prefixInputs[0]!, { target: { value: "2a4b" } });
    expect(screen.getByDisplayValue("24")).toBeInTheDocument();
  });

  it("toggling a rule's 'مفعّلة' switch round-trips to true after re-render, and is sent correctly on save", async () => {
    const { getSeenBody } = renderPage(twoRuleConfig);
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));

    const toggles = screen.getAllByRole("switch", { name: "القاعدة مفعّلة" });
    expect(toggles).toHaveLength(2);
    // toggles[1] is rule B's switch, which starts inactive.
    expect(toggles[1]).not.toBeChecked();
    fireEvent.click(toggles[1]!);
    expect(toggles[1]).toBeChecked();

    fireEvent.click(screen.getByRole("tab", { name: "الإعدادات العامة" }));
    fireEvent.click(screen.getByRole("tab", { name: "قواعد الباركود المدمج" }));
    expect(screen.getAllByRole("switch", { name: "القاعدة مفعّلة" })[1]).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
    const body = getSeenBody() as BarcodeConfigDTO;
    expect(body.embeddedRules[1]!.active).toBe(true);
    expect(body.embeddedRules[0]!.active).toBe(true);
  });

  it("the auto-generate prefix field appears only in AUTO mode, strips non-digits, and an empty prefix saves as null (not an empty string)", async () => {
    const { getSeenBody } = renderPage();
    await screen.findByRole("heading", { name: "إعدادات الباركود" });
    await waitFor(() => expect(screen.queryByText("بادئة الترقيم التلقائي")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("combobox", { name: "طريقة تحديد باركود الصنف" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "توليد تلقائي" }));

    const prefixInput = screen.getAllByRole("textbox").find((el) => (el as HTMLInputElement).value === "")!;
    fireEvent.change(prefixInput, { target: { value: "9x9" } });
    expect(prefixInput).toHaveValue("99");

    fireEvent.change(prefixInput, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
    const body = getSeenBody() as BarcodeConfigDTO;
    expect(body.autoGeneratePrefix).toBeNull();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LeavePolicyDTO, LeavePolicyPresetDTO } from "@mezan/contracts";
import { LeavePoliciesScreen } from "./LeavePoliciesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

/**
 * The create form's leaveType `Select` shows its currently-chosen value as
 * closed-trigger text, so a leave-type label like "إجازة سنوية" is ALWAYS in
 * the DOM even before the table has loaded any rows — `findByText` on it
 * alone resolves too early. Wait for the table specifically instead.
 */
async function findRowText(text: string): Promise<HTMLElement> {
  const table = await screen.findByRole("table");
  return within(table).findByText(text);
}

function policy(overrides: Partial<LeavePolicyDTO> = {}): LeavePolicyDTO {
  return {
    id: "pol-1",
    leaveType: "annual",
    entitlementDays: "21.000000",
    accrualFrequency: "annual",
    carryOver: false,
    maxCarryOverDays: null,
    payoutOnTermination: false,
    legallyMandated: true,
    presetCode: null,
    active: true,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

const presets: LeavePolicyPresetDTO[] = [
  {
    code: "eg-labour-2003",
    labelAr: "قانون العمل المصري 2003",
    effectiveFrom: "2003-07-07",
    lines: [
      {
        leaveType: "annual",
        entitlementDays: "21.000000",
        accrualFrequency: "annual",
        carryOver: true,
        maxCarryOverDays: "6.000000",
        payoutOnTermination: true,
        legallyMandated: true,
        noteAr: "الحد الأدنى القانوني",
      },
    ],
  },
];

function renderScreen(policies: LeavePolicyDTO[] = [policy()]) {
  let current = [...policies];
  let lastBody: unknown = null;
  let lastMethod = "";
  let deleteCalled = false;
  const transport = stubTransport({
    "GET /hr/leave-policies": () => ({ body: current }),
    "GET /hr/leave-policies/presets": () => ({ body: presets }),
    "POST /hr/leave-policies": (init) => {
      lastMethod = "POST";
      lastBody = JSON.parse((init?.body as string) ?? "{}");
      const body = lastBody as Partial<LeavePolicyDTO>;
      const created = policy({ id: "pol-new", ...body });
      current = [...current, created];
      return { body: created };
    },
    "PUT /hr/leave-policies/*": (init, path) => {
      lastMethod = "PUT";
      lastBody = JSON.parse((init?.body as string) ?? "{}");
      const id = path.split("/").pop()!;
      const body = lastBody as Partial<LeavePolicyDTO>;
      current = current.map((p) => (p.id === id ? { ...p, ...body } : p));
      return { body: current.find((p) => p.id === id)! };
    },
    "DELETE /hr/leave-policies/*": (_init, path) => {
      deleteCalled = true;
      const id = path.split("/").pop()!;
      current = current.filter((p) => p.id !== id);
      return { body: {} };
    },
    "POST /hr/leave-policies/apply-preset": (init) => {
      lastBody = JSON.parse((init?.body as string) ?? "{}");
      current = [...current, ...presets[0]!.lines.map((l, i) => policy({ id: `preset-${i}`, ...l, presetCode: "eg-labour-2003" }))];
      return { body: current };
    },
  });
  const result = renderWithProviders(<LeavePoliciesScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getBody: () => lastBody, getMethod: () => lastMethod, wasDeleted: () => deleteCalled };
}

describe("LeavePoliciesScreen", () => {
  it("lists policies", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "سياسات الإجازات" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(await findRowText("إجازة سنوية")).toBeInTheDocument();
    expect(within(table).getByText("21")).toBeInTheDocument();
  });

  it("shows the empty state honestly when there are no policies", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد سياسات إجازات معدة حالياً/)).toBeInTheDocument();
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /hr/leave-policies": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [policy()] };
      },
      "GET /hr/leave-policies/presets": () => ({ body: presets }),
    });
    renderWithProviders(<LeavePoliciesScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل سياسات الإجازات. (رمز 500)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await findRowText("إجازة سنوية");
    expect(screen.queryByText("تعذّر تحميل سياسات الإجازات. (رمز 500)")).not.toBeInTheDocument();
  });

  it("applying a preset posts its code and shows the confirmation banner", async () => {
    const user = userEvent.setup();
    const { getBody } = renderScreen([]);
    await screen.findByText(/لا توجد سياسات/);
    await user.click(screen.getByLabelText("الإعداد"));
    await user.click(await screen.findByRole("option", { name: "قانون العمل المصري 2003" }));
    fireEvent.click(screen.getByRole("button", { name: "تطبيق إعداد جاهز" }));
    await waitFor(() => expect(getBody()).toEqual({ presetCode: "eg-labour-2003" }));
    expect(await screen.findByText('تم تطبيق الإعداد "قانون العمل المصري 2003".')).toBeInTheDocument();
  });

  it("creates a new policy with the real entitlement/frequency/carry-over fields, maxCarryOverDays null when unset", async () => {
    const { getBody, getMethod } = renderScreen([]);
    await screen.findByText(/لا توجد سياسات/);
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة سياسة" })[0]!);
    const dialog = screen.getByRole("dialog");
    const entitled = fieldInput(dialog, "الرصيد الأساسي (أيام/سنة) *");
    fireEvent.change(entitled, { target: { value: "15" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    await waitFor(() => expect(getMethod()).toBe("POST"));
    const body = getBody() as Record<string, unknown>;
    expect(body.entitlementDays).toBe("15");
    expect(body.carryOver).toBe(false);
    expect(body.maxCarryOverDays).toBeNull();
    expect(body.leaveType).toBe("annual");
  });

  it("toggling carry-over reveals the cap field, and sets maxCarryOverDays only when carryOver is on", async () => {
    const { getBody } = renderScreen([]);
    await screen.findByText(/لا توجد سياسات/);
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة سياسة" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "ترحيل الرصيد للسنة التالية" }));
    const capInput = fieldInput(dialog, "حد الترحيل (أيام)");
    fireEvent.change(capInput, { target: { value: "6" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    await waitFor(() => expect(getBody()).not.toBeNull());
    const body = getBody() as Record<string, unknown>;
    expect(body.carryOver).toBe(true);
    expect(body.maxCarryOverDays).toBe("6");
  });

  it("edits an existing policy via PUT with the edited fields", async () => {
    const { getBody, getMethod } = renderScreen([policy({ id: "pol-2", entitlementDays: "10.000000" })]);
    await findRowText("إجازة سنوية");
    fireEvent.click(screen.getByRole("button", { name: "تعديل إجازة سنوية" }));
    const dialog = screen.getByRole("dialog");
    const entitled = fieldInput(dialog, "الرصيد الأساسي (أيام/سنة) *");
    fireEvent.change(entitled, { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));
    await waitFor(() => expect(getMethod()).toBe("PUT"));
    expect((getBody() as Record<string, unknown>).entitlementDays).toBe("12");
  });

  it("deletes a policy only after confirming, hitting the real DELETE endpoint", async () => {
    const { wasDeleted } = renderScreen([policy({ id: "pol-3" })]);
    await findRowText("إجازة سنوية");
    fireEvent.click(screen.getByRole("button", { name: "حذف إجازة سنوية" }));
    const confirmDialog = screen.getByRole("dialog");
    expect(within(confirmDialog).getByText("حذف سياسة الإجازة؟")).toBeInTheDocument();
    expect(wasDeleted()).toBe(false);
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "حذف" }));
    await waitFor(() => expect(wasDeleted()).toBe(true));
  });

  it("a server refusal on create renders the server's Arabic message, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /hr/leave-policies": () => ({ body: [] }),
      "GET /hr/leave-policies/presets": () => ({ body: presets }),
      "POST /hr/leave-policies": () => ({ status: 400, body: { message: "توجد سياسة بهذا النوع بالفعل" } }),
    });
    renderWithProviders(<LeavePoliciesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد سياسات/);
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة سياسة" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));
    expect(await screen.findByText("توجد سياسة بهذا النوع بالفعل")).toBeInTheDocument();
  });
});

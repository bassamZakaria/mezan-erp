// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountDTO, AuditEventDTO } from "@mezan/contracts";
import { ChartOfAccountsScreen } from "./ChartOfAccountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// custom Select combobox (the type/status filters) calls it when opening.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * A chart deliberately carrying the drift a real tenant's data accumulates —
 * a detail account whose parent got demoted, one whose parent was deleted —
 * so validateDraft's server-mirrored refusals (packages/domain/src/accounts)
 * are reachable the way they actually occur: editing an account that already
 * violates a rule, not typing one in through a picker that only offers valid
 * parents.
 */
const driftedAccounts: AccountDTO[] = [
  { id: "1000", code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" },
  { id: "1300", code: "1300", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true, status: "active" },
  { id: "1301", code: "1301", nameAr: "حساب فرعي داخل الصندوق", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: true, status: "active" },
  { id: "1300-1", code: "1300-1", nameAr: "درج الفرع الرئيسي", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" },
  { id: "1300-2", code: "1300-2", nameAr: "حساب أب غير رئيسي", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "1300-1", isHeader: false, status: "active" },
  { id: "1300-3", code: "1300-3", nameAr: "حساب بلا أصل بالقائمة", nameEn: null, type: "asset", naturalBalance: "debit", parentId: "9999-ghost", isHeader: false, status: "active" },
  { id: "2000", code: "2000", nameAr: "الالتزامات", nameEn: "Liabilities", type: "liability", naturalBalance: "credit", parentId: null, isHeader: true, status: "active" },
];

interface RenderOptions {
  accounts?: AccountDTO[];
  patchRequests?: Array<{ id: string; patch: Record<string, unknown> }>;
  patchStatus?: (id: string) => { status?: number; body: unknown } | undefined;
  createStatus?: () => { status?: number; body: unknown } | undefined;
  ledger?: { lines: unknown[]; balance: unknown };
  auditEventsByAccount?: Record<string, AuditEventDTO[]>;
}

function renderScreen(opts: RenderOptions = {}) {
  let current = [...(opts.accounts ?? driftedAccounts)];
  const transport = stubTransport({
    "GET /accounts": () => ({ body: current }),
    "GET /gl/accounts/*/ledger": () => {
      if (opts.ledger) return { body: opts.ledger };
      return { status: 404, body: { error: "NOT_FOUND" } };
    },
    "GET /audit": (_init, path) => {
      const entityId = new URL(path, "http://test").searchParams.get("entityId") ?? "";
      const events = opts.auditEventsByAccount?.[entityId] ?? [];
      return { body: { events, total: events.length } };
    },
    "POST /accounts": (init) => {
      const overridden = opts.createStatus?.();
      if (overridden) return overridden;
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: AccountDTO = { ...body, nameEn: body.nameEn ?? null, parentId: body.parentId ?? null, status: "active" };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /accounts/*": (init, path) => {
      const id = path.split("/").pop()!;
      const overridden = opts.patchStatus?.(id);
      if (overridden) return overridden;
      const patch = JSON.parse((init?.body as string) ?? "{}");
      opts.patchRequests?.push({ id, patch });
      const index = current.findIndex((a) => a.id === id);
      const updated: AccountDTO = { ...current[index]!, ...patch };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<ChartOfAccountsScreen />, { transport, initialSession: testAdminSession });
}

async function openEditFor(user: ReturnType<typeof userEvent.setup>, name: string) {
  fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الرقم..."), { target: { value: name } });
  await user.click(await screen.findByRole("button", { name: `تعديل ${name}` }));
  return screen.getByRole("dialog", { name: "تعديل حساب" });
}

describe("ChartOfAccountsScreen — tree structure", () => {
  it("shows a root header's own nature and 'no parent' when its detail panel is opened", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByText("الأصول"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("رئيسي")).toBeInTheDocument();
    expect(within(dialog).getByText("بدون رئيسي (جذر)")).toBeInTheDocument();
  });

  it("shows 'no parent' for an account whose real parent has been removed from the chart", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByText("حساب بلا أصل بالقائمة"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("تفصيلي")).toBeInTheDocument();
    expect(within(dialog).getByText("بدون رئيسي (جذر)")).toBeInTheDocument();
  });

  it("re-expands a header's children on a second toggle click", async () => {
    renderScreen();
    const cashRow = (await screen.findByText("النقدية")).closest("tr")!;
    const collapse = within(cashRow).getByRole("button", { name: "طي" });
    fireEvent.click(collapse);
    expect(screen.queryByText("درج الفرع الرئيسي")).not.toBeInTheDocument();

    const expand = within(cashRow).getByRole("button", { name: "توسيع" });
    fireEvent.click(expand);
    expect(await screen.findByText("درج الفرع الرئيسي")).toBeInTheDocument();
  });
});

describe("ChartOfAccountsScreen — parent/child validation", () => {
  it("refuses a parent that is not a header, inherited from a demoted account", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    const dialog = await openEditFor(user, "حساب أب غير رئيسي");
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("يجب أن يكون حساباً رئيسياً");
  });

  it("refuses a parent that no longer exists in the chart", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    const dialog = await openEditFor(user, "حساب بلا أصل بالقائمة");
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الحساب الرئيسي المختار غير موجود");
  });

  it("refuses reparenting a header underneath its own descendant", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    const dialog = await openEditFor(user, "النقدية");
    const parentPicker = within(dialog).getByLabelText("الحساب الرئيسي");
    await user.click(parentPicker);
    await user.clear(parentPicker);
    await user.type(parentPicker, "حساب فرعي داخل الصندوق");
    await user.click(within(dialog).getByRole("button", { name: (n) => n.startsWith("1301") }));
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("تسلسل دائري");
  });

  it("refuses turning a header with real children back into a postable account", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    const dialog = await openEditFor(user, "النقدية");
    await user.click(within(dialog).getByLabelText("حساب رئيسي (غير قابل للترحيل عليه)"));
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("حسابات فرعية");
  });

  it("reparents a translated-only account to the top of the chart, leaving its blank English name untouched", async () => {
    const user = userEvent.setup();
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen({ patchRequests });
    await screen.findByText("الأصول");
    const dialog = await openEditFor(user, "درج الفرع الرئيسي");
    expect(within(dialog).getByLabelText("الاسم بالإنجليزي")).toHaveValue("");

    const parentPicker = within(dialog).getByLabelText("الحساب الرئيسي");
    await user.click(parentPicker);
    await user.click(within(dialog).getByRole("button", { name: "بدون رئيسي (جذر)" }));
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]!.id).toBe("1300-1");
    expect(patchRequests[0]!.patch.parentId).toBeNull();
  });
});

describe("ChartOfAccountsScreen — save failures and status changes", () => {
  it("keeps the add-account form open and shows the server's own message when saving fails", async () => {
    const user = userEvent.setup();
    renderScreen({ createStatus: () => ({ status: 500, body: { message: "تعذّر إنشاء الحساب، حاول لاحقاً." } }) });
    await screen.findByText("الأصول");
    await user.click(screen.getByRole("button", { name: "إضافة حساب" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    await user.type(within(dialog).getByLabelText("الكود *"), "1500");
    await user.type(within(dialog).getByLabelText("الاسم *"), "حساب جديد");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("تعذّر إنشاء الحساب");
    expect(screen.getByRole("dialog", { name: "إضافة حساب" })).toBeInTheDocument();
  });

  it("deactivates an account by switching its status to inactive from the edit form", async () => {
    const user = userEvent.setup();
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen({ patchRequests });
    await screen.findByText("الأصول");
    const dialog = await openEditFor(user, "الالتزامات");
    await user.click(within(dialog).getByLabelText("الحالة"));
    await user.click(await screen.findByRole("option", { name: "غير نشط" }));
    await user.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]!.id).toBe("2000");
    expect(patchRequests[0]!.patch.status).toBe("inactive");
  });
});

describe("ChartOfAccountsScreen — account routing tab", () => {
  it("switches to the account-routing tab, hiding the accounts list underneath", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    await user.click(screen.getByRole("button", { name: "توجيه الحسابات" }));

    expect(screen.queryByLabelText("تصفية حسب النوع")).not.toBeInTheDocument();
    expect(await screen.findByText("تعذّر تحميل دليل الحسابات.")).toBeInTheDocument();
  });
});

describe("ChartOfAccountsScreen — account movements", () => {
  it("shows an account's posted movements with a running balance, and its audit tab", async () => {
    const user = userEvent.setup();
    renderScreen({
      ledger: {
        lines: [
          { entryId: "je-1", entryNo: "JE-000010", date: "2026-08-01", memo: null, debit: "100.000000", credit: "0.000000" },
          { entryId: "je-2", entryNo: null, date: "2026-08-05", memo: null, debit: "0.000000", credit: "40.000000" },
        ],
        balance: { accountId: "1300-1", debit: "100.000000", credit: "40.000000", balance: "60.000000" },
      },
      auditEventsByAccount: {
        "1300-1": [
          {
            stream: "sensitive",
            module: "accounting",
            entityType: "ACCOUNT",
            entityId: "1300-1",
            action: "UPDATE",
            actor: "محمد الشهابي",
            branchId: null,
            timestamp: "2026-08-15T10:00:00.000Z",
            severity: "INFO",
            details: null,
          },
        ],
      },
    });
    await user.click(await screen.findByText("درج الفرع الرئيسي"));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByText("JE-000010")).toBeInTheDocument();
    expect(within(dialog).getAllByText("—").length).toBeGreaterThan(0);

    await user.click(within(dialog).getByRole("tab", { name: "سجل التدقيق" }));
    // The tab used to be a sentence promising a trail nobody had wired. It
    // reads `GET /audit` for this account now, so the account's own events are
    // what has to be on screen — and the ledger movements must not be.
    const history = await within(dialog).findByRole("region", { name: "سجل التغييرات" });
    expect(within(history).getByText("تعديل")).toBeInTheDocument();
    expect(within(history).getByText("محمد الشهابي")).toBeInTheDocument();
    expect(within(dialog).queryByText("JE-000010")).not.toBeInTheDocument();
  });
});

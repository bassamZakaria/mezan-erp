// @vitest-environment jsdom
// Side-effect import so jest-dom's matcher augmentation (toBeInTheDocument,
// toHaveTextContent, …) is visible to apps/web's own `tsc --noEmit` — its
// tsconfig doesn't include packages/ui/src/test/setup.ts (which registers
// this for the rest of the workspace), even though the matchers work at
// runtime via vitest.config.ts's `setupFiles`.
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AccountDTO } from "@mezan/contracts";
import { ChartOfAccountsScreen } from "./ChartOfAccountsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// custom Select combobox (the type/status filters) calls it when opening.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const sampleAccounts: AccountDTO[] = [
  { id: "1000", code: "1000", nameAr: "الأصول", nameEn: "Assets", type: "asset", naturalBalance: "debit", parentId: null, isHeader: true, status: "active" },
  { id: "1300", code: "1300", nameAr: "النقدية", nameEn: "Cash", type: "asset", naturalBalance: "debit", parentId: "1000", isHeader: true, status: "active" },
  { id: "1300-1", code: "1300-1", nameAr: "صندوق نقدي الفرع الرئيسي", nameEn: "Main Branch Cash Drawer", type: "asset", naturalBalance: "debit", parentId: "1300", isHeader: false, status: "active" },
  { id: "2000", code: "2000", nameAr: "الالتزامات", nameEn: "Liabilities", type: "liability", naturalBalance: "credit", parentId: null, isHeader: true, status: "active" },
];

function renderScreen(
  accounts: AccountDTO[] = sampleAccounts,
  opts: { patchRequests?: Array<{ id: string; patch: Record<string, unknown> }>; onGetAccounts?: () => { status?: number; body: unknown } | undefined } = {},
) {
  let current = [...accounts];
  const transport = stubTransport({
    "GET /accounts": () => {
      const overridden = opts.onGetAccounts?.();
      if (overridden) return overridden;
      return { body: current };
    },
    "POST /accounts": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      if (current.some((a) => a.code === body.code)) {
        return { status: 409, body: { error: "DUPLICATE_ACCOUNT_CODE", message: `الكود "${body.code}" مستخدم بالفعل.` } };
      }
      const created: AccountDTO = { ...body, nameEn: body.nameEn ?? null, parentId: body.parentId ?? null, status: "active" };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /accounts/*": (init, path) => {
      const id = path.split("/").pop()!;
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

describe("ChartOfAccountsScreen", () => {
  it("renders the page title and stat totals from real data", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "دليل الحسابات" })).toBeInTheDocument();
    expect(await screen.findAllByText(String(sampleAccounts.length))).not.toHaveLength(0);
    const headerCount = sampleAccounts.filter((a) => a.isHeader).length;
    expect(screen.getAllByText(String(headerCount)).length).toBeGreaterThan(0);
  });

  it("renders root and nested accounts from the seeded backend", async () => {
    renderScreen();
    expect(await screen.findByText("الأصول")).toBeInTheDocument();
    expect(screen.getByText("صندوق نقدي الفرع الرئيسي")).toBeInTheDocument();
  });

  it("shows an empty state when there are no accounts yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد حسابات مطابقة")).toBeInTheDocument();
  });

  it("filters the visible rows by search text", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    await user.type(screen.getByPlaceholderText("بحث بالاسم أو الرقم..."), "النقدية");
    // useUrlSearch settles the query into the address 300ms after typing stops
    // (apps/web/src/lib/url-state.ts); the tree filter only re-derives once it does.
    await waitFor(() => expect(screen.queryByText("الالتزامات")).not.toBeInTheDocument());
    expect(screen.getByText("النقدية")).toBeInTheDocument();
  });

  it("filters the visible rows by account type", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    await user.click(screen.getByLabelText("تصفية حسب النوع"));
    await user.click(await screen.findByRole("option", { name: "التزامات" }));
    await waitFor(() => expect(screen.queryByText("الأصول")).not.toBeInTheDocument());
    expect(screen.getByText("الالتزامات")).toBeInTheDocument();
  });

  it("opens the account detail panel on row click, showing balance and parent", async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByText("صندوق نقدي الفرع الرئيسي"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("حركات الحساب")).toBeInTheDocument();
    expect(within(dialog).getByText("مدين")).toBeInTheDocument();
  });

  it("opens the add-account form and creates a new detail account under a header parent", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    await user.click(screen.getByRole("button", { name: "إضافة حساب" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    await user.type(within(dialog).getByLabelText("الكود *"), "1330-1");
    await user.type(within(dialog).getByLabelText("الاسم *"), "حساب اختبار");

    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("حساب اختبار")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "إضافة حساب" })).not.toBeInTheDocument();
  });

  it("rejects creating an account with a duplicate code and keeps the form open with an error", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText("الأصول");
    await user.click(screen.getByRole("button", { name: "إضافة حساب" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة حساب" });
    await user.type(within(dialog).getByLabelText("الكود *"), "1000"); // already exists as a root
    await user.type(within(dialog).getByLabelText("الاسم *"), "نسخة");
    await user.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("مستخدم بالفعل");
    expect(screen.getByRole("dialog", { name: "إضافة حساب" })).toBeInTheDocument();
  });

  it("toggles a single header row's children with the tree-row toggle", async () => {
    renderScreen();
    // Cash (1300) is a header and starts expanded by default; collapse it via its toggle.
    const cashRow = (await screen.findByText("النقدية")).closest("tr")!;
    const toggle = within(cashRow).getByRole("button", { name: "طي" });
    fireEvent.click(toggle);
    expect(screen.queryByText("صندوق نقدي الفرع الرئيسي")).not.toBeInTheDocument();
  });

  it("filters the visible rows by status", async () => {
    const user = userEvent.setup();
    renderScreen([...sampleAccounts, { id: "1400", code: "1400", nameAr: "حساب متوقف", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "inactive" }]);
    await screen.findByText("الأصول");
    await user.click(screen.getByLabelText("تصفية حسب الحالة"));
    await user.click(await screen.findByRole("option", { name: "غير نشط" }));
    await waitFor(() => expect(screen.queryByText("الأصول")).not.toBeInTheDocument());
    expect(screen.getByText("حساب متوقف")).toBeInTheDocument();
  });

  it("re-parents an account to a real header id — not its Arabic label — sent as parentId in the PATCH body", async () => {
    const user = userEvent.setup();
    const patchRequests: Array<{ id: string; patch: Record<string, unknown> }> = [];
    renderScreen(sampleAccounts, { patchRequests });

    await user.click(await screen.findByText("صندوق نقدي الفرع الرئيسي"));
    const detailDialog = screen.getByRole("dialog");
    await user.click(within(detailDialog).getByRole("button", { name: "تعديل" }));

    const formDialog = screen.getByRole("dialog", { name: "تعديل حساب" });
    const parentPicker = within(formDialog).getByLabelText("الحساب الرئيسي");
    await user.click(parentPicker);
    await user.clear(parentPicker);
    await user.type(parentPicker, "الالتزامات");
    await user.click(within(formDialog).getByRole("button", { name: (name) => name.startsWith("2000") }));

    await user.click(within(formDialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(patchRequests).toHaveLength(1));
    expect(patchRequests[0]!.id).toBe("1300-1");
    expect(patchRequests[0]!.patch.parentId).toBe("2000");
  });

  it("does NOT show the empty-tree message when the load failed — the banner is the only story (D123)", async () => {
    renderScreen(sampleAccounts, { onGetAccounts: () => ({ status: 500, body: { error: "INTERNAL" } }) });

    expect(await screen.findByText("تعذّر تحميل دليل الحسابات. (رمز 500)")).toBeInTheDocument();
    // An empty chart of accounts and an unreachable one are opposite facts:
    // one invites "add an account", the other must invite "retry".
    expect(screen.queryByText("لا توجد حسابات مطابقة")).not.toBeInTheDocument();
  });
});

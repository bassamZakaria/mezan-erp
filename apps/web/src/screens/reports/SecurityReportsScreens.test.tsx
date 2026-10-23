// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { ExceptionsReportScreen } from "./ExceptionsReportScreen";
import { PostPostingChangesReportScreen } from "./PostPostingChangesReportScreen";
import { AfterHoursReportScreen } from "./AfterHoursReportScreen";
import { NewAccountsReportScreen } from "./NewAccountsReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

const { createObjectURL, revokeObjectURL } = URL;
afterEach(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

/**
 * guards P-4 — all four exception reports were built, mounted and reachable
 * from no screen at all. These assert each one hits its OWN endpoint under
 * `/security-reports`, and that the honesty the server sends (coverage
 * truncation, gaps, an assumed working day) actually reaches the reader.
 */

const COVERAGE = { matched: 3, scanned: 3, truncated: false, scanLimit: 5000 };

function envelope(rows: unknown[], extra: Record<string, unknown> = {}) {
  return {
    rows,
    groups: [{ key: "_all", labelAr: "", rows, totals: { count: rows.length } }],
    grandTotals: { count: rows.length },
    kpis: [],
    coverage: COVERAGE,
    gaps: [],
    ...extra,
  };
}

describe("the four exception-report screens", () => {
  it("ExceptionsReportScreen reads /security-reports/exceptions and renders the actor and the watch list", async () => {
    let path = "";
    const transport = stubTransport({
      "GET /security-reports/exceptions": (_init, requested) => {
        path = requested;
        return {
          body: envelope(
            [
              {
                actor: "أحمد",
                action: "PERMISSION_REFUSED",
                actionLabelAr: "رفض صلاحية",
                module: "sales",
                count: 12,
                critical: 0,
                error: 12,
                warning: 0,
                info: 0,
                firstAt: "2026-09-01T08:00:00.000Z",
                lastAt: "2026-09-03T08:00:00.000Z",
              },
            ],
            { watchlist: [{ action: "ADMIN_PIN_RESET", labelAr: "إعادة تعيين رمز مدير", count: 0, actorCount: 0, lastAt: null }] },
          ),
        };
      },
    });
    renderWithProviders(<ExceptionsReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getAllByText("أحمد").length).toBeGreaterThan(0));
    expect(path).toContain("/security-reports/exceptions");
    expect(path).toContain("from=");
    expect(path).toContain("to=");
    expect(screen.getByText("قائمة المراقبة")).toBeInTheDocument();
    expect(screen.getByText("إعادة تعيين رمز مدير")).toBeInTheDocument();
  });

  it("shows how many security events the audit log could not record, and the latest of them", async () => {
    const transport = stubTransport({
      "GET /security-reports/exceptions": () => ({
        body: envelope([], {
          unrecorded: {
            count: 7,
            recent: [{ at: "2026-09-03T08:00:00.000Z", module: "auth", action: "LOGIN_FAILED", severity: "WARNING", actor: "anonymous", entityId: null, reason: "database is locked" }],
          },
        }),
      }),
    });
    renderWithProviders(<ExceptionsReportScreen />, { transport, initialSession: testAdminSession });

    const block = await screen.findByRole("alert");
    expect(block).toHaveTextContent("أحداث أمنية لم يتمكّن سجل التدقيق من تسجيلها");
    expect(block).toHaveTextContent("7");
    expect(block).toHaveTextContent("LOGIN_FAILED");
    expect(block).toHaveTextContent("database is locked");
  });

  it("says no security event went unrecorded when the count is zero", async () => {
    const transport = stubTransport({
      "GET /security-reports/exceptions": () => ({ body: envelope([], { unrecorded: { count: 0, recent: [] } }) }),
    });
    renderWithProviders(<ExceptionsReportScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("لم يفُت سجلَّ التدقيق أيُّ حدث أمني")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says out loud that the totals are a floor when the server truncated its scan", async () => {
    const transport = stubTransport({
      "GET /security-reports/exceptions": () => ({
        body: envelope([], { coverage: { matched: 90000, scanned: 5000, truncated: true, scanLimit: 5000 } }),
      }),
    });
    renderWithProviders(<ExceptionsReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() =>
      expect(screen.getByText(/الأرقام أدناه حدٌّ أدنى وليست إجمالياً/)).toBeInTheDocument(),
    );
  });

  it("renders the gaps the server declared rather than showing a blank column as 'nothing to report'", async () => {
    // A gap key the catalogue has no override for — this exercises the
    // fallback path, so the assertion stays true even if a translator
    // later refines the catalogue's copy for a real, named gap.
    const transport = stubTransport({
      "GET /security-reports/post-posting-changes": () => ({
        body: envelope([], {
          gaps: [{ key: "unmapped-gap", labelAr: "سبب الإلغاء", detailAr: "لا يسجّل أي مسار إلغاء سبباً بعد." }],
        }),
      }),
    });
    renderWithProviders(<PostPostingChangesReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByText("سبب الإلغاء")).toBeInTheDocument());
    expect(screen.getByText(/لا يسجّل أي مسار إلغاء سبباً بعد/)).toBeInTheDocument();
  });

  it("PostPostingChangesReportScreen reads its OWN endpoint and renders a row", async () => {
    let path = "";
    const transport = stubTransport({
      "GET /security-reports/post-posting-changes": (_init, requested) => {
        path = requested;
        return {
          body: envelope([
            {
              rowKey: "k1",
              timestamp: "2026-09-02T19:00:00.000Z",
              actor: "منى",
              module: "sales",
              entityType: "SALES_INVOICE",
              entityId: "inv-1",
              docNo: "INV-000014",
              action: "VOID",
              changeType: "VOID",
              changeTypeLabelAr: "إلغاء",
              severity: "WARNING",
              branchId: "br-1",
              reversalId: null,
              reason: null,
            },
          ]),
        };
      },
    });
    renderWithProviders(<PostPostingChangesReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getAllByText("INV-000014").length).toBeGreaterThan(0));
    expect(path).toContain("/security-reports/post-posting-changes");
  });

  it("AfterHoursReportScreen warns when the working day was assumed rather than configured", async () => {
    const transport = stubTransport({
      "GET /security-reports/after-hours": () => ({
        body: envelope([], {
          workingHours: {
            timezone: "Africa/Cairo",
            timezoneResolved: true,
            startHour: 9,
            endHour: 17,
            standardDailyWorkHours: 8,
            weekendDays: [5, 6],
            weekStartDay: 6,
            startHourSource: "default",
            weekendSource: "default",
          },
        }),
      }),
    });
    renderWithProviders(<AfterHoursReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getByText(/لم تُضبط أوقات العمل في الإعدادات/)).toBeInTheDocument());
  });

  it("AfterHoursReportScreen reads its OWN endpoint", async () => {
    let path = "";
    const transport = stubTransport({
      "GET /security-reports/after-hours": (_init, requested) => {
        path = requested;
        return { body: envelope([]) };
      },
    });
    renderWithProviders(<AfterHoursReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(path).toContain("/security-reports/after-hours"));
  });

  it("NewAccountsReportScreen reads /security-reports/new-accounts with its look-back default", async () => {
    let path = "";
    const transport = stubTransport({
      "GET /security-reports/new-accounts": (_init, requested) => {
        path = requested;
        return {
          body: envelope([
            {
              userId: "u-1",
              nameAr: "سارة",
              email: "sara@example.com",
              status: "active",
              isCompanyAdmin: false,
              roleId: null,
              createdAt: "2026-08-20T10:00:00.000Z",
              lastLoginAt: null,
              createdBy: "admin",
              createdByEventAt: "2026-08-20T10:00:00.000Z",
              postedDocumentCount: 0,
              voidedDocumentCount: 0,
              credentialResetCount: 1,
              firstActivityAt: null,
              lastActivityAt: null,
            },
          ]),
        };
      },
    });
    renderWithProviders(<NewAccountsReportScreen />, { transport, initialSession: testAdminSession });

    await waitFor(() => expect(screen.getAllByText("سارة").length).toBeGreaterThan(0));
    expect(path).toContain("/security-reports/new-accounts");
    expect(path).toContain("days=90");
  });

  it("renders the shared empty state on zero rows", async () => {
    const transport = stubTransport({
      "GET /security-reports/new-accounts": () => ({ body: envelope([]) }),
    });
    renderWithProviders(<NewAccountsReportScreen />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByText("لا توجد بيانات لعرضها.")).toBeInTheDocument());
  });
});

describe("SecurityReportScreen — a paged report", () => {
  const afterHoursRow = (n: number) => ({
    rowKey: `ah-${n}`,
    localDate: "2026-03-07",
    localTime: "22:00",
    weekday: 6,
    outsideReason: "after_hours",
    actor: `مستخدم-${n}`,
    action: "LOGIN",
    entityType: "user",
    entityId: `u-${n}`,
    branchId: "br-1",
  });
  const allRows = [1, 2, 3].map(afterHoursRow);

  function pagedTransport() {
    const paths: string[] = [];
    const transport = stubTransport({
      "GET /security-reports/after-hours": (_init, requested) => {
        paths.push(requested);
        const query = new URLSearchParams(requested.split("?")[1]);
        if (!query.has("pageSize")) return { body: envelope(allRows) };
        const page = Number(query.get("page"));
        const rows = [allRows[page - 1] ?? afterHoursRow(page)];
        return { body: envelope(rows, { grandTotals: { count: 120 }, page: { page, pageSize: Number(query.get("pageSize")), totalRows: 120 } }) };
      },
    });
    return { transport, paths };
  }

  it("asks for one page and moves to the page clicked", async () => {
    const { transport, paths } = pagedTransport();
    renderWithProviders(<AfterHoursReportScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByRole("cell", { name: "مستخدم-1" })).toBeInTheDocument();
    expect(paths[0]).toContain("page=1");
    expect(paths[0]).toContain("pageSize=50");
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(await screen.findByRole("cell", { name: "مستخدم-2" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "مستخدم-1" })).toBeNull();
  });

  it("prints every row, then returns to the page", async () => {
    const { transport } = pagedTransport();
    let printed: string[] = [];
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      printed = allRows.map((row) => row.actor).filter((actor) => screen.queryByRole("cell", { name: actor }) !== null);
    });
    renderWithProviders(<AfterHoursReportScreen />, { transport, initialSession: testAdminSession });
    await screen.findByRole("cell", { name: "مستخدم-1" });
    fireEvent.click(screen.getByRole("button", { name: "طباعة" }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printed).toEqual(["مستخدم-1", "مستخدم-2", "مستخدم-3"]);
    await waitFor(() => expect(screen.queryByRole("cell", { name: "مستخدم-3" })).toBeNull());
    print.mockRestore();
  });

  it("exports every row, not just the page on screen", async () => {
    const { transport } = pagedTransport();
    let exported: Blob | null = null;
    Object.assign(URL, { createObjectURL: vi.fn((blob: Blob) => ((exported = blob), "blob:x")), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderWithProviders(<AfterHoursReportScreen />, { transport, initialSession: testAdminSession });
    await screen.findByRole("cell", { name: "مستخدم-1" });
    fireEvent.click(screen.getByRole("button", { name: "تصدير CSV" }));
    await waitFor(() => expect(exported).not.toBeNull());
    const text = await (exported as unknown as Blob).text();
    for (const row of allRows) expect(text).toContain(row.actor);
    click.mockRestore();
  });
});

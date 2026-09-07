// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { ExceptionsReportScreen } from "./ExceptionsReportScreen";
import { PostPostingChangesReportScreen } from "./PostPostingChangesReportScreen";
import { AfterHoursReportScreen } from "./AfterHoursReportScreen";
import { NewAccountsReportScreen } from "./NewAccountsReportScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

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
    expect(screen.getByText("الضوابط المراقَبة")).toBeInTheDocument();
    expect(screen.getByText("إعادة تعيين رمز مدير")).toBeInTheDocument();
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
    const transport = stubTransport({
      "GET /security-reports/post-posting-changes": () => ({
        body: envelope([], {
          gaps: [{ key: "reason", labelAr: "سبب الإلغاء", detailAr: "لا يسجّل أي مسار إلغاء سبباً بعد." }],
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

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuditEventDTO, AuditQueryResponseDTO, BranchDTO } from "@mezan/contracts";
import { AuditLogScreen } from "./AuditLogScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * `TextField` (settings/form-controls.tsx) renders a `<label>` that is never
 * associated with its input via `for`/`id`, so `getByLabelText` can't find
 * these fields (module/entity/from/to here). Fall back to the DOM structure
 * the shared `Field` wrapper always uses: a `<label>` immediately followed by
 * its control in the same wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

const BRANCH: BranchDTO = {
  id: "BR1",
  code: "MAIN",
  name: "الفرع الرئيسي",
  parentBranchId: null,
  phone: null,
  email: null,
  address: null,
  isMain: true,
  active: true,
};

const SECURITY_EVENT: AuditEventDTO = {
  stream: "security",
  module: "auth",
  entityType: "session",
  entityId: "s-1",
  action: "login_failed",
  actor: "sara@cyag.example",
  branchId: "BR1",
  timestamp: "2026-08-20T09:15:00.000Z",
  severity: "CRITICAL",
  details: { ip: "10.0.0.5" },
};

const SENSITIVE_EVENT: AuditEventDTO = {
  stream: "sensitive",
  module: "gl",
  entityType: "journal_entry",
  entityId: "je-1",
  action: "reverse",
  actor: "admin@cyag.example",
  branchId: null,
  timestamp: "2026-08-21T11:00:00.000Z",
  severity: "INFO",
  details: null,
};

/** Builds a `GET /audit` handler that reads its own query string to answer list vs. count requests distinctly. */
function auditHandler(events: AuditEventDTO[]) {
  return (_init: RequestInit | undefined, path: string): StubResult => {
    const qs = new URLSearchParams(path.split("?")[1] ?? "");
    const stream = qs.get("stream");
    const severity = qs.get("severity");
    const actor = qs.get("actor");
    const module_ = qs.get("module");
    const branchId = qs.get("branchId");
    const from = qs.get("from");
    let filtered = events;
    if (stream) filtered = filtered.filter((e) => e.stream === stream);
    if (severity) filtered = filtered.filter((e) => e.severity === severity);
    if (actor) filtered = filtered.filter((e) => e.actor.includes(actor));
    if (module_) filtered = filtered.filter((e) => e.module === module_);
    if (branchId) filtered = filtered.filter((e) => e.branchId === branchId);
    if (from) filtered = filtered.filter((e) => e.timestamp >= from);
    const body: AuditQueryResponseDTO = { events: filtered, total: filtered.length };
    return { body };
  };
}

function baseHandlers(events: AuditEventDTO[] = [SECURITY_EVENT, SENSITIVE_EVENT]) {
  return {
    "GET /audit": auditHandler(events),
    "GET /branches": () => ({ body: [BRANCH] }),
  };
}

describe("AuditLogScreen — list", () => {
  it("renders real audit events off GET /audit with the exact request query issued", async () => {
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });

    expect(await screen.findByText("login_failed")).toBeInTheDocument();
    expect(screen.getByText("reverse")).toBeInTheDocument();
    expect(screen.getByText("sara@cyag.example")).toBeInTheDocument();
    expect(screen.getByText("حرج")).toBeInTheDocument(); // CRITICAL severity pill
    expect(screen.getByText("معلومة")).toBeInTheDocument(); // INFO severity pill
    expect(screen.getByText("الفرع الرئيسي")).toBeInTheDocument(); // resolved branch name
    expect(screen.getByText("—")).toBeInTheDocument(); // null branchId

    await waitFor(() => expect(paths.some((p) => p.startsWith("/audit?limit=25"))).toBe(true));
    // the two independent stream-count lookups hit the same route with their own filter
    await waitFor(() => expect(paths.some((p) => p.includes("stream=security") && p.includes("limit=1"))).toBe(true));
    await waitFor(() => expect(paths.some((p) => p.includes("stream=sensitive") && p.includes("limit=1"))).toBe(true));
  });

  it("shows the documented empty state when no event matches", async () => {
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([])),
    });
    expect(await screen.findByText("لا توجد أحداث مطابقة")).toBeInTheDocument();
  });

  it("shows the Arabic load error instead of a raw failure when the audit request fails", async () => {
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /audit": () => ({ status: 500, body: { error: "INTERNAL" } }),
        "GET /branches": () => ({ body: [BRANCH] }),
      }),
    });
    expect(await screen.findByText("تعذّر تحميل سجل المراجعة.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("opens the read-only detail panel on row click, including further JSON details", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers()),
    });
    await user.click(await screen.findByText("login_failed"));
    const dialog = screen.getByRole("dialog", { name: "تفاصيل الحدث" });
    expect(within(dialog).getByText("sara@cyag.example")).toBeInTheDocument();
    expect(within(dialog).getByText(/"ip"/)).toBeInTheDocument();
    expect(within(dialog).getByText(/10\.0\.0\.5/)).toBeInTheDocument();
  });

  it("shows the no-further-details message for an event with null details", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers()),
    });
    await user.click(await screen.findByText("reverse"));
    const dialog = screen.getByRole("dialog", { name: "تفاصيل الحدث" });
    expect(within(dialog).getByText("لا توجد تفاصيل إضافية")).toBeInTheDocument();
    expect(within(dialog).getByText("لم يُسجَّل فرع لهذا الحدث")).toBeInTheDocument();
  });
});

describe("AuditLogScreen — filters", () => {
  it("sends the stream tab to the server as a query param", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });
    await screen.findByText("login_failed");
    await user.click(screen.getByRole("tab", { name: /أحداث الأمان/ }));
    await waitFor(() => expect(paths.some((p) => p.includes("stream=security"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("reverse")).not.toBeInTheDocument());
    expect(screen.getByText("login_failed")).toBeInTheDocument();
  });

  it("sends the severity filter to the server and re-narrows the rows", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });
    await screen.findByText("login_failed");
    await user.click(screen.getByLabelText("الخطورة"));
    await user.click(await screen.findByRole("option", { name: "حرج" }));
    await waitFor(() => expect(paths.some((p) => p.includes("severity=CRITICAL"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("reverse")).not.toBeInTheDocument());
    expect(screen.getByText("login_failed")).toBeInTheDocument();
  });

  it("sends the branch filter to the server", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });
    await screen.findByText("login_failed");
    await user.click(screen.getByLabelText("الفرع"));
    await user.click(await screen.findByRole("option", { name: "الفرع الرئيسي" }));
    await waitFor(() => expect(paths.some((p) => p.includes("branchId=BR1"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("reverse")).not.toBeInTheDocument());
  });

  it("sends the module text filter to the server", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });
    await screen.findByText("login_failed");
    await user.type(textFieldInput(document.body, "الوحدة"), "auth");
    await waitFor(() => expect(paths.some((p) => p.includes("module=auth"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("reverse")).not.toBeInTheDocument());
  });

  it("sends the actor search box to the server", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });
    await screen.findByText("login_failed");
    await user.type(screen.getByPlaceholderText("بحث باسم المستخدم..."), "admin");
    await waitFor(() => expect(paths.some((p) => p.includes("actor=admin"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("login_failed")).not.toBeInTheDocument());
    expect(screen.getByText("reverse")).toBeInTheDocument();
  });

  it("sends the from-date filter to the server", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers(),
        "GET /audit": (init, path) => {
          paths.push(path);
          return auditHandler([SECURITY_EVENT, SENSITIVE_EVENT])(init, path);
        },
      }),
    });
    await screen.findByText("login_failed");
    await user.type(textFieldInput(document.body, "من تاريخ"), "2026-08-21");
    await waitFor(() => expect(paths.some((p) => p.includes("from=2026-08-21"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("login_failed")).not.toBeInTheDocument());
    expect(screen.getByText("reverse")).toBeInTheDocument();
  });

  it("clears every filter with the clear-filters button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AuditLogScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers()),
    });
    await screen.findByText("login_failed");
    await user.type(textFieldInput(document.body, "الوحدة"), "auth");
    await waitFor(() => expect(screen.queryByText("reverse")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "مسح الفلاتر" }));
    expect(await screen.findByText("reverse")).toBeInTheDocument();
    expect(textFieldInput(document.body, "الوحدة")).toHaveValue("");
  });
});

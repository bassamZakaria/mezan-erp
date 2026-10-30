// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { UserImportRowStatusDTO, type RoleTemplateDTO, type UserImportReportDTO } from "@mezan/contracts";
import { ProvisioningScreen } from "./ProvisioningScreen";
import { TestNavigation, renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

afterEach(cleanup);

const PASSWORD = "Zq7mKd4WxP2c";
const CSV = "name_ar,email,role,branches,warehouses\nسلمى,salma@x.test,CASH,MAIN,WH-1";

const TEMPLATE: RoleTemplateDTO = {
  id: "accountant",
  code: "ACCOUNTANT",
  nameAr: "محاسب",
  nameEn: "Accountant",
  descriptionAr: "يقيّد الحركات المالية",
  descriptionEn: "Books entries",
  permissions: ["accounting.journal.view", "accounting.journal.post"],
  omittedPermissions: ["hr.employee.view"],
};

function report(over: Partial<UserImportReportDTO> = {}): UserImportReportDTO {
  return {
    dryRun: true,
    digest: "d".repeat(64),
    fileProblems: [],
    rows: [{ rowNumber: 2, email: "salma@x.test", nameAr: "سلمى", roleCode: "CASH", status: UserImportRowStatusDTO.Ok, problems: [] }],
    summary: { total: 1, valid: 1, invalid: 0 },
    seats: { limit: 5, active: 1, available: 4 },
    created: 0,
    credentials: [],
    ...over,
  };
}

interface Calls {
  readonly imports: Record<string, unknown>[];
  readonly templates: Record<string, unknown>[];
}

function renderScreen(handlers: { dry?: UserImportReportDTO; committed?: UserImportReportDTO; permissions?: string[]; segments?: string[] } = {}) {
  const calls: Calls = { imports: [], templates: [] };
  const transport = stubTransport({
    "GET /roles/templates": () => ({ body: [TEMPLATE] }),
    "GET /users": () => ({
      body: [
        { id: "u1", nameAr: "كريم", nameEn: null, email: "karim@x.test", phone: null, roleId: "r1", isCompanyAdmin: false, employeeId: null, branchScope: "*", warehouseScope: "*", status: "active", mustChangePassword: false, photoUrl: null, lastLoginAt: null, createdAt: "2026-10-01" },
      ],
    }),
    "POST /roles/from-template": (init) => {
      calls.templates.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { status: 201, body: { id: "r1", code: "ACCOUNTANT_2", name: "محاسب", description: "", permissions: TEMPLATE.permissions.slice(0, 1), isSystem: false, createdAt: "2026-10-17", templateId: "accountant", omittedPermissions: ["hr.employee.view"] } };
    },
    "POST /users/import": (init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.imports.push(body);
      if (body.dryRun === false) {
        return {
          status: 201,
          body:
            handlers.committed ??
            report({
              dryRun: false,
              created: 1,
              credentials: [{ rowNumber: 2, userId: "u-new", email: "salma@x.test", nameAr: "سلمى", password: PASSWORD }],
            }),
        };
      }
      return { body: handlers.dry ?? report() };
    },
  });
  const session = handlers.permissions ? { ...testAdminSession, permissions: handlers.permissions } : testAdminSession;
  renderWithProviders(
    <TestNavigation initialSegments={handlers.segments ?? []}>
      <ProvisioningScreen />
    </TestNavigation>,
    { transport, initialSession: session },
  );
  return calls;
}

function typeCsv(value: string) {
  fireEvent.change(screen.getByLabelText("محتوى الملف"), { target: { value } });
}

describe("ProvisioningScreen", () => {
  it("refuses a caller who cannot create users", async () => {
    renderScreen({ permissions: ["admin.users.view"] });
    expect(await screen.findByText("لا تملك صلاحية تجهيز المستخدمين")).toBeInTheDocument();
    expect(screen.queryByLabelText("محتوى الملف")).not.toBeInTheDocument();
  });

  it("keeps the import button off until the exact file has been checked", async () => {
    renderScreen();
    const commit = await screen.findByRole("button", { name: "استيراد المستخدمين" });
    expect(commit).toBeDisabled();
    typeCsv(CSV);
    expect(commit).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "فحص الملف" }));
    await screen.findByText("1 صف سليم من 1، و0 به أخطاء.");
    await waitFor(() => expect(commit).toBeEnabled());
    typeCsv(`${CSV}\n`);
    expect(commit).toBeDisabled();
    expect(await screen.findByText("تغيّر الملف بعد الفحص؛ افحصه من جديد قبل الاستيراد.")).toBeInTheDocument();
  });

  it("shows each row's problems and never offers the import while any row fails", async () => {
    renderScreen({
      dry: report({
        digest: null,
        rows: [{ rowNumber: 2, email: "bad", nameAr: "", roleCode: "GHOST", status: UserImportRowStatusDTO.Error, problems: [{ code: "ROW_UNKNOWN_ROLE", messageAr: "الدور «GHOST» غير موجود.", messageEn: "The role does not exist." }] }],
        summary: { total: 1, valid: 0, invalid: 1 },
      }),
    });
    typeCsv(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "فحص الملف" }));
    expect(await screen.findByText("الدور «GHOST» غير موجود.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استيراد المستخدمين" })).toBeDisabled();
  });

  it("asks for an acknowledgement and a reason when a role pairs both sides of a duty rule, and sends them with the check", async () => {
    const calls = renderScreen({
      dry: report({
        digest: null,
        rows: [{ rowNumber: 2, email: "salma@x.test", nameAr: "سلمى", roleCode: "CASH", status: UserImportRowStatusDTO.Error, problems: [{ code: "ROW_SOD_CONFLICT", messageAr: "تعارض فصل مهام", messageEn: "Conflict" }] }],
        summary: { total: 1, valid: 0, invalid: 1 },
      }),
    });
    typeCsv(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "فحص الملف" }));
    await screen.findByText("دور يجمع طرفي فصل مهام");
    fireEvent.click(screen.getByLabelText("أقرّ بذلك وأتحمل المسؤولية"));
    fireEvent.change(screen.getByLabelText("سبب الإقرار"), { target: { value: "مكتب صغير" } });
    fireEvent.click(screen.getByRole("button", { name: "فحص الملف" }));
    await waitFor(() => expect(calls.imports).toHaveLength(2));
    expect(calls.imports[1]).toMatchObject({ dryRun: true, acknowledge: true, reason: "مكتب صغير" });
  });

  it("commits with the dry run's digest, shows the sheet once, and forgets it when closed", async () => {
    const calls = renderScreen();
    typeCsv(CSV);
    fireEvent.click(await screen.findByRole("button", { name: "فحص الملف" }));
    const commit = screen.getByRole("button", { name: "استيراد المستخدمين" });
    await waitFor(() => expect(commit).toBeEnabled());
    fireEvent.click(commit);

    const heading = await screen.findByRole("heading", { name: "كشف بيانات الدخول — يُعرض مرة واحدة" });
    expect(heading).toBeInTheDocument();
    expect(calls.imports[1]).toMatchObject({ dryRun: false, digest: "d".repeat(64) });
    const sheet = screen.getByRole("region", { name: "كشف بيانات الدخول — يُعرض مرة واحدة" });
    expect(within(sheet).getByText(PASSWORD)).toBeInTheDocument();

    const close = screen.getByRole("button", { name: "إغلاق الكشف" });
    expect(close).toBeDisabled();
    fireEvent.click(screen.getByLabelText("طبعتُ الكشف أو حفظته في مكان آمن"));
    fireEvent.click(close);

    await waitFor(() => expect(screen.queryByText(PASSWORD)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(screen.getByText("تم استيراد 1 مستخدم.")).toBeInTheDocument();
  });

  it("creates a role from a template and reports what was left out", async () => {
    const calls = renderScreen();
    fireEvent.click(await screen.findByRole("radio", { name: "قوالب الأدوار" }));
    expect(await screen.findByText("محاسب")).toBeInTheDocument();
    expect(screen.getByText("1 صلاحية خارج الوحدات المرخصة لم تُضمَّن")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إنشاء دور من هذا القالب" }));
    fireEvent.click(await screen.findByRole("button", { name: "إنشاء الدور" }));
    expect(await screen.findByText(/تم إنشاء الدور «محاسب» بالكود ACCOUNTANT_2/)).toBeInTheDocument();
    expect(calls.templates).toEqual([{ templateId: "accountant", name: "محاسب" }]);
  });

  it("opens the clone tab with the user picked in the users list already chosen", async () => {
    renderScreen({ segments: ["clone", "u1"] });
    expect(await screen.findByLabelText("المستخدم المراد استنساخه")).toBeInTheDocument();
    expect(await screen.findByText("كريم — karim@x.test")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "استنساخ مستخدم" })).toBeChecked();
  });
});

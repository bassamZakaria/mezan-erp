// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";
import { licensableLabel } from "./module-options";

function openNewPlan(onPost: (body: { modules?: string[] }) => void) {
  renderWithPlatformProviders(<PlatformShell />, {
    route: "/platform/plans/new",
    initialSession: testPlatformSession,
    transport: stubPlatformTransport({
      "GET /plans": () => ({ body: [] }),
      "POST /plans": (init) => {
        const body = JSON.parse(String(init?.body));
        onPost(body);
        return { status: 201, body: { ...body, id: "PLAN-9", status: "active", createdAt: "2026-10-31T00:00:00.000Z" } };
      },
    }),
  });
}

async function fillRequired() {
  await screen.findByRole("heading", { name: "باقة جديدة" });
  fireEvent.change(screen.getByLabelText("الكود"), { target: { value: "shop" } });
  fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "المتجر" } });
  fireEvent.change(screen.getByLabelText("الاسم بالإنجليزية"), { target: { value: "Shop" } });
  fireEvent.click(screen.getByRole("button", { name: "المبيعات" }));
  for (const [label, value] of [["السعر الشهري (جنيه)", "900"], ["السعر السنوي (جنيه)", "9000"]] as const) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.blur(screen.getByLabelText(label));
  }
}

describe("plan editor — HR parts", () => {
  beforeEach(() => localStorage.clear());

  it("sells chosen HR parts without the whole module", async () => {
    let posted: { modules?: string[] } | null = null;
    openNewPlan((body) => (posted = body));
    await fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "الدوام والإجازات" }));
    fireEvent.click(screen.getByRole("button", { name: "الرواتب" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.modules).toEqual(["sales", "hr.time", "hr.payroll"]);
  });

  it("says the staff list is free, and drops the part choice once the whole module is picked", async () => {
    openNewPlan(() => undefined);
    await fillRequired();
    expect(screen.getByText("الأفراد: مجاني في كل الباقات")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الرواتب" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "الموارد البشرية" }));
    expect(screen.queryByRole("button", { name: "الرواتب" })).not.toBeInTheDocument();
  });
});

describe("licensableLabel", () => {
  const t = ((key: string) => (key === "module.hr" ? "الموارد البشرية" : key)) as never;
  it("names a part under its parent", () => {
    expect(licensableLabel("hr.time", t)).toBe("الموارد البشرية — الدوام والإجازات");
  });
});

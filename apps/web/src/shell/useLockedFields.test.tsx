// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "../data/AppProviders";
import type { Session } from "../data/session";
import { stubTransport, testAdminSession } from "../data/test-support";
import { TextField } from "../settings/form-controls";
import { useLockedFields } from "./useLockedFields";

function CreditLimitForm() {
  const locked = useLockedFields("/customers");
  const sent = locked.withoutLocked({ nameAr: "عميل", creditLimit: "5000", paymentTermsDays: 30, phone: "010" });
  return (
    <>
      <TextField label="حد الائتمان" value="5000" onChange={() => {}} {...locked.props("creditLimit")} />
      <TextField label="الهاتف" value="010" onChange={() => {}} {...locked.props("phone")} />
      <output data-testid="sent">{Object.keys(sent).join(",")}</output>
    </>
  );
}

function renderAs(session: Session) {
  return render(
    <AppProviders transport={stubTransport({})} initialSession={session}>
      <CreditLimitForm />
    </AppProviders>,
  );
}

describe("a field that applies to every branch is locked for a branch-restricted user, with the reason beside it (D111)", () => {
  it("disables the field the policy names, says why in Arabic, and does not send it", () => {
    renderAs({ ...testAdminSession, isCompanyAdmin: false, branchScope: ["BR-ALEX"] });
    expect(screen.getByLabelText("حد الائتمان")).toBeDisabled();
    expect(screen.getByText("يسري على كل الفروع — تغيّره الإدارة.")).toBeInTheDocument();
    expect(screen.getByLabelText("الهاتف")).toBeEnabled();
    expect(screen.getByTestId("sent")).toHaveTextContent("nameAr,phone");
  });

  it("leaves every field open, and sent, for a user who holds every branch", () => {
    renderAs(testAdminSession);
    expect(screen.getByLabelText("حد الائتمان")).toBeEnabled();
    expect(screen.queryByText("يسري على كل الفروع — تغيّره الإدارة.")).not.toBeInTheDocument();
    expect(screen.getByTestId("sent")).toHaveTextContent("nameAr,creditLimit,paymentTermsDays,phone");
  });
});

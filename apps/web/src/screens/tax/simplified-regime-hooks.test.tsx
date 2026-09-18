// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { useRecordSimplifiedRegime } from "./simplified-regime-hooks";
import { errorMessage } from "../../lib/error-message";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

function Harness() {
  const record = useRecordSimplifiedRegime();
  const [shown, setShown] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={() =>
          void record
            .mutateAsync({ state: "active", electedOn: null, form110Reference: null })
            .catch((err: unknown) => setShown(errorMessage(err, "fallback")))
        }
      >
        save
      </button>
      {shown ? <p role="alert">{shown}</p> : null}
    </>
  );
}

describe("useRecordSimplifiedRegime", () => {
  it("shows the server's Arabic reason for a refused record, not the generic failure", async () => {
    const transport = stubTransport({
      "PUT /tax/simplified-regime": () => ({
        status: 400,
        body: { error: "VALIDATION_ERROR", message: "تاريخ ورقم نموذج 1/10 المقدَّم مطلوبان لتسجيل الاختيار" },
      }),
    });
    renderWithProviders(<Harness />, { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("تاريخ ورقم نموذج 1/10 المقدَّم مطلوبان لتسجيل الاختيار");
  });
});

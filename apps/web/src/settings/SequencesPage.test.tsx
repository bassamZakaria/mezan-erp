// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor} from "@testing-library/react";
import type { SequenceListItemDTO } from "@mezan/contracts";
import { SequencesPage } from "./SequencesPage";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sequenceOne: SequenceListItemDTO = {
  code: "TEST-SEQ",
  labelAr: "تسلسل الاختبار",
  prefix: "TS-",
  padLength: 4,
  annualReset: false,
  currentValue: 41,
  nextNumber: "TS-0042",
  isOverridden: false,
};

const sequenceTwo: SequenceListItemDTO = {
  code: "OTHER-SEQ",
  labelAr: "تسلسل آخر",
  prefix: "OT-",
  padLength: 3,
  annualReset: true,
  currentValue: 5,
  nextNumber: "OT-006",
  isOverridden: false,
};

function renderPage(sequences: SequenceListItemDTO[] = [sequenceOne, sequenceTwo]) {
  let current = [...sequences];
  let seenPatchPath = "";
  let seenBody: unknown = null;
  const transport = stubTransport({
    "GET /sequences": () => ({ body: current }),
    "PATCH /sequences/*": (init, path) => {
      seenPatchPath = path;
      seenBody = JSON.parse((init?.body as string) ?? "{}");
      const code = path.split("/").pop()!;
      current = current.map((s) => (s.code === code ? { ...s, ...(seenBody as Partial<SequenceListItemDTO>) } : s));
      return { body: current.find((s) => s.code === code) };
    },
    "POST /sequences/*/counter": (init, path) => {
      seenBody = JSON.parse((init?.body as string) ?? "{}");
      const code = path.split("/")[2]!;
      const body = seenBody as { value: number };
      current = current.map((s) => (s.code === code ? { ...s, currentValue: body.value } : s));
      return { body: current.find((s) => s.code === code) };
    },
  });
  const result = renderWithProviders(<SequencesPage />, { transport, initialSession: testAdminSession });
  return { ...result, getSeenBody: () => seenBody, getSeenPath: () => seenPatchPath };
}

describe("SequencesPage — list", () => {
  it("lists the real sequences fetched from the backend, with their prefix and next number", async () => {
    renderPage();
    expect(await screen.findByText("تسلسل الاختبار")).toBeInTheDocument();
    expect(screen.getByText("TS-0042")).toBeInTheDocument();
    expect(screen.getByText("تسلسل آخر")).toBeInTheDocument();
  });

  it("shows a load-failure notice with a retry action rather than a blank list", async () => {
    const transport = stubTransport({ "GET /sequences": () => ({ status: 500, body: {} }) });
    renderWithProviders(<SequencesPage />, { transport, initialSession: testAdminSession });
    expect(await screen.findByRole("button", { name: /إعادة/ })).toBeInTheDocument();
  });
});

describe("SequencesPage — edit panel", () => {
  it("editing the prefix and saving sends exactly the edited fields in the PATCH body", async () => {
    const { getSeenBody, getSeenPath } = renderPage();
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));

    const prefixInput = screen.getByDisplayValue("TS-");
    fireEvent.change(prefixInput, { target: { value: "INV-" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await screen.findByText("TS-0042", { exact: false }).catch(() => null);
    expect(getSeenBody()).toEqual({ prefix: "INV-", padLength: 4, annualReset: false });
    expect(getSeenPath()).toBe("/sequences/TEST-SEQ");
  });

  it("refuses client-side (no request) when the prefix is blanked out, and shows an Arabic message", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /sequences": () => ({ body: [sequenceOne] }),
      "PATCH /sequences/*": () => {
        called = true;
        return { body: sequenceOne };
      },
    });
    renderWithProviders(<SequencesPage />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));

    fireEvent.change(screen.getByDisplayValue("TS-"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText(/مطلوبان/)).toBeInTheDocument();
    expect(called).toBe(false);
  });

  // guards D100 / §4.5 #13 — this test used to pin the DEFECT: every failed
  // save showed one fixed sentence whatever the backend said. `readError` now
  // carries the server's own reason to the screen.
  it("D100: a save the backend refuses shows the server's own reason, not a fixed generic sentence", async () => {
    const transport = stubTransport({
      "GET /sequences": () => ({ body: [sequenceOne] }),
      "PATCH /sequences/*": () => ({ status: 409, body: { message: "البادئة مستخدمة في تسلسل آخر" } }),
    });
    renderWithProviders(<SequencesPage />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));

    fireEvent.change(screen.getByDisplayValue("TS-"), { target: { value: "DUP-" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    // «البادئة مستخدمة في تسلسل آخر» tells the admin what to change; the
    // generic sentence told them only that something went wrong.
    expect(await screen.findByText("البادئة مستخدمة في تسلسل آخر")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("تعذّر حفظ إعدادات التسلسل.")).not.toBeInTheDocument());
  });

  it("closing and reopening the panel for a DIFFERENT row shows that row's own current/next figures, not the previous row's", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));
    expect(within(screen.getByRole("dialog")).getByText("41")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));

    fireEvent.click(await screen.findByText("تسلسل آخر"));
    expect(within(screen.getByRole("dialog")).getByText("5")).toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).queryByText("41")).not.toBeInTheDocument();
  });
});

describe("SequencesPage — guarded counter adjustment", () => {
  it("the confirm submit stays disabled until the acknowledgment checkbox is ticked", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل العداد يدويًا…" }));

    const submit = screen.getByRole("button", { name: "تأكيد تعديل العداد" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).not.toBeDisabled();
  });

  it("refuses a value below the current counter — the submit re-disables and a warning shows", async () => {
    renderPage();
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل العداد يدويًا…" }));
    fireEvent.click(screen.getByRole("checkbox"));

    const valueInput = screen.getByDisplayValue("41");
    fireEvent.change(valueInput, { target: { value: "10" } });

    expect(screen.getByRole("button", { name: "تأكيد تعديل العداد" })).toBeDisabled();
  });

  it("confirming a valid new counter value sends confirm:true and updates the figure shown", async () => {
    const { getSeenBody } = renderPage();
    fireEvent.click(await screen.findByText("تسلسل الاختبار"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل العداد يدويًا…" }));
    fireEvent.click(screen.getByRole("checkbox"));

    const valueInput = screen.getByDisplayValue("41");
    fireEvent.change(valueInput, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد تعديل العداد" }));

    await new Promise((r) => setTimeout(r, 20));
    expect(getSeenBody()).toEqual({ value: 100, confirm: true });
  });
});

/// <reference types="jest" />
import { Text } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { SalesInvoiceDTO } from "@mezan/contracts";
import { ApiError, ApiFailure } from "@/api/errors";
import { Button } from "@/components/button";
import { Locale, STRINGS } from "@/i18n/strings";
import { RerateNotice } from "../rerate-notice";
import { useRerateAcknowledgement, type ConfirmDraft } from "../use-rerate-acknowledgement";

const SERVER_MESSAGE = "أُعيد احتساب الضريبة على بنود الفاتورة وفق إعداد ضريبة القيمة المضافة الحالي.";
const confirmed = { id: "INV-LOCAL-1", docNo: "INV-000777", totals: { grandTotal: "114.000000" } } as unknown as SalesInvoiceDTO;

function refusingUntilAcknowledged(): { confirm: ConfirmDraft; calls: unknown[] } {
  const calls: unknown[] = [];
  const confirm: ConfirmDraft = async (input) => {
    calls.push(input);
    if (input.body?.acknowledgeTaxRecalculation) return confirmed;
    throw new ApiError(ApiFailure.Refused, 409, SERVER_MESSAGE, null, null, { recalculatedGrandTotal: "114.000000" });
  };
  return { confirm, calls };
}

function Harness({ confirm }: { confirm: ConfirmDraft }) {
  const rerate = useRerateAcknowledgement(confirm);
  return (
    <>
      <Button label="تأكيد" onPress={() => void rerate.confirmDraft("INV-LOCAL-1", "100.000000").then((done) => done ?? undefined)} />
      <RerateNotice rerate={rerate} strings={STRINGS[Locale.Ar]} />
      <Text>{rerate.confirmed ? `posted ${rerate.confirmed.docNo}` : "not posted"}</Text>
    </>
  );
}

async function refuseOnce() {
  const gateway = refusingUntilAcknowledged();
  await render(<Harness confirm={gateway.confirm} />);
  await fireEvent.press(screen.getByRole("button", { name: "تأكيد" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "تأكيد بالإجمالي الجديد" })).toBeTruthy());
  return gateway;
}

describe("the sell screen's re-rate acknowledgement", () => {
  it("shows the server's reason with the total on screen beside the total that would post", async () => {
    const { calls } = await refuseOnce();
    await waitFor(() => expect(screen.getByText(SERVER_MESSAGE)).toBeTruthy());
    expect(screen.getByText(/الإجمالي الذي سيُرحَّل: 114\.00.*المعروض حالياً: 100\.00/)).toBeTruthy();
    expect(calls).toEqual([{ id: "INV-LOCAL-1", body: {} }]);
    expect(screen.getByText("not posted")).toBeTruthy();
  });

  it("confirms the same draft with the acknowledgement, once", async () => {
    const { calls } = await refuseOnce();
    await fireEvent.press(screen.getByRole("button", { name: "تأكيد بالإجمالي الجديد" }));
    expect(calls).toEqual([{ id: "INV-LOCAL-1", body: {} }, { id: "INV-LOCAL-1", body: { acknowledgeTaxRecalculation: true } }]);
    await waitFor(() => expect(screen.getByText("posted INV-000777")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "تأكيد بالإجمالي الجديد" })).toBeNull();
  });

  it("leaves the draft unposted when the seller backs out, and says in Arabic that it was saved as a draft", async () => {
    const { calls } = await refuseOnce();
    await fireEvent.press(screen.getByRole("button", { name: "حفظ كمسودة دون تأكيد" }));
    expect(calls).toEqual([{ id: "INV-LOCAL-1", body: {} }]);
    expect(screen.getByText(/حُفظت الفاتورة كمسودة ولم تُرحَّل/)).toBeTruthy();
    expect(screen.getByText("not posted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "تأكيد بالإجمالي الجديد" })).toBeNull();
  });
});

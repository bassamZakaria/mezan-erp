import { describe, expect, it } from "vitest";
import { EtaSubmissionStatusCode, Money, type EtaSubmission, type FrameworkDocument, type SalesReturnLine } from "@mezan/domain";
import { createEtaVoidPort, createSalesReturnVoidGuards, ReturnVoidRefusalCode } from "./eta-void.js";

const RETURN = { id: "R1", docNo: "SR-000001" } as FrameworkDocument<SalesReturnLine>;

function etaHolding(chain: readonly { internalId: string; status: EtaSubmissionStatusCode }[]) {
  const excluded: { id: string; reason: string }[] = [];
  const eta = {
    async findByInternalId(internalId: string) {
      const found = chain.find((link) => link.internalId === internalId);
      return found ? ({ id: `sub:${found.internalId}`, internalId: found.internalId, status: found.status } as EtaSubmission) : null;
    },
    async exclude(id: string, reason: string) {
      excluded.push({ id, reason });
      return {} as EtaSubmission;
    },
  };
  return { port: createEtaVoidPort(eta), excluded };
}

async function voidWith(chain: readonly { internalId: string; status: EtaSubmissionStatusCode }[], refunds = 0) {
  const { port, excluded } = etaHolding(chain);
  const guards = createSalesReturnVoidGuards({
    refundsOf: async () => Array.from({ length: refunds }, (_, i) => ({ voucherId: `V${i}`, voucherNo: `RV-${i}`, date: "2026-08-24", amount: Money.fromMajor("1") })),
    eta: port,
  });
  const refusal = await guards.guard(RETURN).then(() => null, (err: { code: string; message: string }) => err);
  if (!refusal) await guards.withdraw(RETURN);
  return { refusal, excluded };
}

describe("voiding a sales return whose credit note or refund receipt exists", () => {
  it.each([
    [EtaSubmissionStatusCode.Submitted, ReturnVoidRefusalCode.EtaAwaitingVerdict, "انتظر"],
    [EtaSubmissionStatusCode.Accepted, ReturnVoidRefusalCode.EtaAccepted, "بفاتورة مبيعات جديدة"],
  ])("is refused while the authority holds it (%s)", async (status, code, way) => {
    const { refusal, excluded } = await voidWith([{ internalId: "SR-000001", status }]);
    expect(refusal?.code).toBe(code);
    expect(refusal?.message).toContain(way);
    expect(excluded).toEqual([]);
  });

  it.each([EtaSubmissionStatusCode.Ready, EtaSubmissionStatusCode.PendingSignature, EtaSubmissionStatusCode.Error])(
    "proceeds and withdraws one the authority never took or refused (%s)",
    async (status) => {
      const { refusal, excluded } = await voidWith([{ internalId: "SR-000001", status }]);
      expect(refusal).toBeNull();
      expect(excluded.map((e) => e.id)).toEqual(["sub:SR-000001"]);
      expect(excluded[0]?.reason).toContain("SR-000001");
    },
  );

  it("proceeds and writes nothing when there is none, or it is already excluded", async () => {
    expect(await voidWith([])).toEqual({ refusal: null, excluded: [] });
    expect(await voidWith([{ internalId: "SR-000001", status: EtaSubmissionStatusCode.Excluded }])).toEqual({ refusal: null, excluded: [] });
  });

  it("is judged by the reissue, not by the rejected receipt before it", async () => {
    const { refusal } = await voidWith([
      { internalId: "SR-000001", status: EtaSubmissionStatusCode.Error },
      { internalId: "SR-000001-R2", status: EtaSubmissionStatusCode.Accepted },
    ]);
    expect(refusal?.code).toBe(ReturnVoidRefusalCode.EtaAccepted);
  });

  it("is refused first while a refund voucher stands, naming it", async () => {
    const { refusal, excluded } = await voidWith([{ internalId: "SR-000001", status: EtaSubmissionStatusCode.Ready }], 1);
    expect(refusal?.code).toBe(ReturnVoidRefusalCode.HasRefunds);
    expect(refusal?.message).toContain("RV-0");
    expect(excluded).toEqual([]);
  });
});

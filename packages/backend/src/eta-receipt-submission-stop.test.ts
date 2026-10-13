import { describe, expect, it, vi } from "vitest";
import { createEtaReceiptIssuer } from "./eta-receipts.js";

type Deps = Parameters<typeof createEtaReceiptIssuer>[0];

describe("a receipt submission run scheduled just before the backend closes", () => {
  it("never reads the store once stop() has landed", async () => {
    const getConfig = vi.fn(async () => ({ autoSubmitOnConfirm: true }));
    const submitReadyReceipts = vi.fn(async () => ({ queued: [] }));
    const issuer = createEtaReceiptIssuer({ eta: { getConfig, submitReadyReceipts } } as unknown as Deps);

    issuer.scheduleSubmission();
    issuer.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(getConfig).not.toHaveBeenCalled();
    expect(submitReadyReceipts).not.toHaveBeenCalled();
  });

  it("still submits when nothing stopped it", async () => {
    const getConfig = vi.fn(async () => ({ autoSubmitOnConfirm: true }));
    const submitReadyReceipts = vi.fn(async () => ({ queued: [] }));
    const issuer = createEtaReceiptIssuer({ eta: { getConfig, submitReadyReceipts } } as unknown as Deps);

    issuer.scheduleSubmission();
    await vi.waitFor(() => expect(submitReadyReceipts).toHaveBeenCalledTimes(1));
    issuer.stop();
  });
});

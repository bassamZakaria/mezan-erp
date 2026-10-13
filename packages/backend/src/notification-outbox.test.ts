import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

describe("the notification outbox on a tenant whose mail is switched off", () => {
  let kit: BackendKit;
  beforeAll(async () => {
    kit = await bootBackendKit();
  }, 240_000);
  afterAll(async () => {
    await kit.close();
  });

  it("says mail is not configured, with the queue depth it would send", async () => {
    const outbox = await kit.call("GET", "/notifications/outbox");
    expect(outbox.status).toBe(200);
    expect(outbox.body).toMatchObject({ mailConfigured: false, transportAvailable: true, queuedIsCapped: false });
    expect(typeof outbox.body.queued).toBe("number");
  });

  it("refuses «إرسال الآن» and leaves every waiting message waiting", async () => {
    const before = (await kit.call("GET", "/notifications/outbox")).body.queued;
    const drained = await kit.call("POST", "/notifications/drain", {});
    expect(drained.status).toBe(409);
    expect(drained.body.error).toBe("NOTIFICATION_MAIL_NOT_CONFIGURED");
    expect((await kit.call("GET", "/notifications/outbox")).body.queued).toBe(before);
  });

  it("is closed to a session that cannot edit the settings", async () => {
    expect((await kit.call("GET", "/notifications/outbox", undefined, ["notifications.rule.view"])).status).toBe(403);
  });
});

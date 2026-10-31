import { describe, expect, it } from "vitest";
import { createSqlitePlatformStores } from "./platform-store.js";

describe("sign-in email list", () => {
  it("gives one email to one tenant, normalised, and lets it go only from its holder", async () => {
    const { signInEmails, close } = createSqlitePlatformStores();
    expect(await signInEmails.claim(" Ali@Example.com", "t-a")).toBe(true);
    expect(await signInEmails.claim("ali@example.com", "t-a")).toBe(true);
    expect(await signInEmails.claim("ALI@example.com", "t-b")).toBe(false);
    await signInEmails.release("ali@example.com", "t-b");
    expect(await signInEmails.tenantOf("ali@example.com")).toBe("t-a");
    await signInEmails.release("ali@example.com", "t-a");
    expect(await signInEmails.tenantOf("ali@example.com")).toBeNull();
    close();
  });

  it("replaces a tenant's emails, answers the ones held elsewhere, and forgets a tenant whole", async () => {
    const { signInEmails, close } = createSqlitePlatformStores();
    await signInEmails.claim("shared@example.com", "t-a");
    await signInEmails.claim("gone@example.com", "t-b");
    expect(await signInEmails.replaceTenant("t-b", ["kept@example.com", "Shared@example.com"])).toEqual(["shared@example.com"]);
    expect(await signInEmails.tenantOf("gone@example.com")).toBeNull();
    expect(await signInEmails.tenantOf("kept@example.com")).toBe("t-b");
    expect(await signInEmails.tenantOf("shared@example.com")).toBe("t-a");
    await signInEmails.forgetTenant("t-b");
    expect(await signInEmails.tenantOf("kept@example.com")).toBeNull();
    expect(await signInEmails.tenantOf("shared@example.com")).toBe("t-a");
    close();
  });
});

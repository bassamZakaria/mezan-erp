import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

const ARABIC = /[؀-ۿ]/;
const account = async (id: string) => (await world.request("GET", `/treasury-accounts/${id}`)).body as { currency: string; glAccountId: string | null };

describe("a treasury account's currency and ledger account are fixed once it has moved", () => {
  it("refuses a currency change on a foreign account that has movements", async () => {
    const refused = await world.request("PATCH", "/treasury-accounts/TR-DEMO-BANK-USD", { currency: "EGP" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("TREASURY_ACCOUNT_HAS_MOVEMENTS");
    expect(String(refused.body.message)).toMatch(ARABIC);
    expect(String(refused.body.messageEn)).toContain("TR-DEMO-BANK-USD");
    expect((await account("TR-DEMO-BANK-USD")).currency).toBe("USD");
  });

  it("refuses turning a base-currency account that has movements into a foreign one", async () => {
    const refused = await world.request("PATCH", "/treasury-accounts/TR-DEMO-BANK", { currency: "USD" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("TREASURY_ACCOUNT_HAS_MOVEMENTS");
    expect(String(refused.body.message)).toMatch(ARABIC);
    expect((await account("TR-DEMO-BANK")).currency).toBe("EGP");
  });

  it("refuses repointing an account that has movements at another ledger account", async () => {
    const before = await account("TR-DEMO-BANK-USD");
    const refused = await world.request("PATCH", "/treasury-accounts/TR-DEMO-BANK-USD", { glAccountId: "1310" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("TREASURY_ACCOUNT_HAS_MOVEMENTS");
    expect((await account("TR-DEMO-BANK-USD")).glAccountId).toBe(before.glAccountId);
  });

  it("refuses a new account of another currency on a ledger account a treasury account already uses", async () => {
    const shared = (await account("TR-DEMO-BANK-USD")).glAccountId;
    const refused = await world.request("POST", "/treasury-accounts", { id: "TR-SHARE", code: "BANK-SH", name: "مشترك", type: "bank", currency: "EGP", branchId: "BR-MAIN", glAccountId: shared });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("TREASURY_GL_ACCOUNT_CURRENCY_CONFLICT");
    expect(String(refused.body.message)).toMatch(ARABIC);
    expect(String(refused.body.messageEn)).toContain("USD");
    expect((await world.request("GET", "/treasury-accounts/TR-SHARE")).status).toBe(404);
  });

  it("refuses moving an unused account onto a ledger account held in another currency", async () => {
    const shared = (await account("TR-DEMO-BANK-USD")).glAccountId;
    expect((await world.request("POST", "/treasury-accounts", { id: "TR-NEW", code: "BANK-NEW", name: "جديد", type: "bank", currency: "EGP", branchId: "BR-MAIN", glAccountId: null })).status).toBe(201);
    const refused = await world.request("PATCH", "/treasury-accounts/TR-NEW", { glAccountId: shared });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("TREASURY_GL_ACCOUNT_CURRENCY_CONFLICT");
  });

  it("still lets an account with no movements change currency, and any account change its name", async () => {
    expect((await world.request("PATCH", "/treasury-accounts/TR-NEW", { currency: "EUR" })).status).toBe(200);
    expect((await account("TR-NEW")).currency).toBe("EUR");
    const renamed = await world.request("PATCH", "/treasury-accounts/TR-DEMO-BANK-USD", { name: "بنك الدولار", currency: "USD" });
    expect(renamed.status).toBe(200);
  });
});

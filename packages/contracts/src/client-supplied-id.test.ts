import { describe, expect, it } from "vitest";
import { CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE, CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE_EN, clientSuppliedId } from "./client-supplied-id.js";

describe("the id a client may give a new record", () => {
  it.each(["4be458e5-2c98-4a2b-9f6e-5d0d3b480cf5", "je-1", "mj-ctl", "SCN-X-0042", "قيد-1", "1300-1", "INV_2026.001", "a".repeat(128)])("%s is accepted", (id) => {
    expect(clientSuppliedId.safeParse(id).success).toBe(true);
  });

  it.each([
    "release:inv:1",
    "inv:void",
    "ADJ1:REVERSAL",
    "FXR:al-1",
    "PI-JE:pi-1",
    "cert-1-DED",
    "cert-1-DED-VOID",
    "",
    " ",
    "a b",
    "a/b",
    "a?b",
    "a#b",
    "a%3Ab",
    "a\nb",
    "a".repeat(129),
  ])("%j is refused", (id) => {
    const parsed = clientSuppliedId.safeParse(id);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe(CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE);
  });

  it("the refusal is Arabic with an English twin", () => {
    expect(CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE).toMatch(/[؀-ۿ]/);
    expect(CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE_EN).toMatch(/reserved/i);
  });
});

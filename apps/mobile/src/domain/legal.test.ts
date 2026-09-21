import { describe, expect, it } from "vitest";
import { Locale } from "../i18n/strings";
import { LegalPage, legalUrl } from "./legal";

describe("legalUrl", () => {
  it("serves Arabic by default and English with ?lang=en, on the public site's origin", () => {
    expect(legalUrl("https://review.mezan.app/", LegalPage.Privacy, Locale.Ar)).toBe("https://review.mezan.app/legal/privacy");
    expect(legalUrl("https://review.mezan.app", LegalPage.AccountDeletion, Locale.En)).toBe(
      "https://review.mezan.app/legal/account-deletion?lang=en",
    );
  });
});

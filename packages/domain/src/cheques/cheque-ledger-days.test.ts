import { describe, expect, it } from "vitest";
import { chequeBounceOntoPartyEntryId, chequeLedgerDays } from "./cheque.js";

const base = { id: "CHQ-1", issueDate: "2026-08-12", creationJournalEntryId: "JE-C", bounceJournalEntryId: "JE-B", bouncedAt: "2026-10-10T22:30:00.000Z" } as const;
const dates = new Map([
  ["JE-C", "2026-08-14"],
  ["JE-B", "2026-09-05"],
]);
const entryDate = (id: string) => dates.get(id);

describe("the days a cheque's credit to its party arose and was undone", () => {
  it("are the days its own entries are dated", () => {
    expect(chequeLedgerDays({ ...base, status: "bounced" }, entryDate)).toEqual({ raised: "2026-08-14", undone: "2026-09-05" });
    expect(chequeLedgerDays({ ...base, status: "replaced" }, entryDate)).toEqual({ raised: "2026-08-14", undone: "2026-09-05" });
  });

  it("a bounce an earlier build parked off the party is undone on the day its reclassification put the debt back", () => {
    const withReclassification = (id: string) => (id === chequeBounceOntoPartyEntryId("CHQ-1") ? "2026-10-13" : dates.get(id));
    expect(chequeLedgerDays({ ...base, status: "bounced" }, withReclassification)).toEqual({ raised: "2026-08-14", undone: "2026-10-13" });
  });

  it("a cheque that has not bounced was never undone", () => {
    expect(chequeLedgerDays({ ...base, status: "deposited" }, entryDate)).toEqual({ raised: "2026-08-14", undone: null });
  });

  it("a bounce recorded with no entry id is read on the tenant day it was recorded, never back on the issue date", () => {
    expect(chequeLedgerDays({ ...base, status: "bounced", bounceJournalEntryId: null }, entryDate)).toEqual({ raised: "2026-08-14", undone: "2026-10-11" });
  });

  it("with neither an entry nor a recorded instant, the bounce is read on the day the cheque was raised", () => {
    expect(chequeLedgerDays({ ...base, status: "bounced", bounceJournalEntryId: null, bouncedAt: null, creationJournalEntryId: null }, entryDate)).toEqual({ raised: "2026-08-12", undone: "2026-08-12" });
  });
});

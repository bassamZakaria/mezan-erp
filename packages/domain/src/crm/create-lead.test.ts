import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { createInMemoryLeadRepository } from "./test-helpers/in-memory-crm-repositories.js";
import { createLead } from "./create-lead.js";
import { InvalidLeadError } from "./errors.js";

describe("createLead", () => {
  it("creates a lead with defaults, starting status 'new'", async () => {
    const repo = createInMemoryLeadRepository();
    const lead = await createLead({ id: "lead-1", name: "أحمد محمد" }, repo);
    expect(lead).toMatchObject({
      id: "lead-1",
      name: "أحمد محمد",
      company: null,
      email: null,
      phone: null,
      source: "other",
      expectedValue: null,
      status: "new",
      convertedCustomerId: null,
      convertedOpportunityId: null,
    });
    expect(await repo.findById("lead-1")).toEqual(lead);
  });

  it("creates a lead with all optional fields set", async () => {
    const repo = createInMemoryLeadRepository();
    const lead = await createLead(
      {
        id: "lead-2",
        name: "سارة علي",
        company: "شركة الفا",
        email: "sara@example.com",
        phone: "0100000000",
        source: "website",
        expectedValue: Money.fromMajor("1500.00"),
        interest: "نظام ERP",
        notes: "عميل مهتم",
      },
      repo,
    );
    expect(lead.company).toBe("شركة الفا");
    expect(lead.source).toBe("website");
    expect(lead.expectedValue?.equals(Money.fromMajor("1500.00"))).toBe(true);
  });

  it("rejects an empty name", async () => {
    const repo = createInMemoryLeadRepository();
    await expect(createLead({ id: "lead-3", name: "  " }, repo)).rejects.toThrow(InvalidLeadError);
  });
});

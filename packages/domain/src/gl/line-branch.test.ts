import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { inBranchOf } from "./line-branch.js";

const line = (branchId: string | null | undefined) => ({ accountId: "1200", debit: Money.fromMajor("10"), credit: Money.zero(), branchId });

describe("a line added beside a document's own lines takes their branch", () => {
  it("takes the one branch every own line carries", () => {
    expect(inBranchOf([line("BR-ALEX"), line("BR-ALEX")], [line(undefined), line(null)]).map((added) => added.branchId)).toEqual(["BR-ALEX", "BR-ALEX"]);
  });

  it("keeps a branch the added line already names", () => {
    expect(inBranchOf([line("BR-ALEX")], [line("BR-MAIN")]).map((added) => added.branchId)).toEqual(["BR-MAIN"]);
  });

  it("stays unattributed when the own lines span branches, carry none, or there are none", () => {
    expect(inBranchOf([line("BR-ALEX"), line("BR-MAIN")], [line(undefined)])[0]?.branchId ?? null).toBeNull();
    expect(inBranchOf([line("BR-ALEX"), line(null)], [line(undefined)])[0]?.branchId ?? null).toBeNull();
    expect(inBranchOf([line(null)], [line(undefined)])[0]?.branchId ?? null).toBeNull();
    expect(inBranchOf([], [line(undefined)])[0]?.branchId ?? null).toBeNull();
  });
});

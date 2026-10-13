import { describe, expect, it } from "vitest";
import * as actions from "./actions.js";

describe("fiscal period actions — closing and locking go through the close guard only", () => {
  it("this module moves a period back to open and nothing else: no bare close, no bare lock", () => {
    expect(Object.keys(actions).sort()).toEqual(["reopenFiscalPeriod"]);
  });
});

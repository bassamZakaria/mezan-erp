import { describe, expect, it } from "vitest";
import { sourceLineOptions } from "./return-source-lines";

describe("sourceLineOptions — a return picks the invoice LINE it reverses", () => {
  it("offers one option per line, valued by the line's id, labelled by the item", () => {
    expect(
      sourceLineOptions([
        { sourceLineId: "l1", itemId: "cement", label: "أسمنت" },
        { sourceLineId: "l2", itemId: "brick", label: "طوب" },
      ]),
    ).toEqual([
      { value: "l1", label: "أسمنت" },
      { value: "l2", label: "طوب" },
    ]);
  });

  it("numbers the lines of an item sold twice, so the 14% line and the export line are two different choices", () => {
    expect(
      sourceLineOptions([
        { sourceLineId: "l1", itemId: "cement", label: "أسمنت" },
        { sourceLineId: "l2", itemId: "brick", label: "طوب" },
        { sourceLineId: "l3", itemId: "cement", label: "أسمنت" },
      ]),
    ).toEqual([
      { value: "l1", label: "أسمنت · 1" },
      { value: "l2", label: "طوب" },
      { value: "l3", label: "أسمنت · 2" },
    ]);
  });
});

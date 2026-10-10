import { describe, expect, it } from "vitest";
import { firstSourceLineWithRoom, sourceLineOptions } from "./return-source-lines";

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

describe("firstSourceLineWithRoom — a new return row starts on a line that still has something to return", () => {
  const sold = [
    { sourceLineId: "l1", qty: "3.000000" },
    { sourceLineId: "l2", qty: "5" },
  ];

  it("starts on the first line while it has quantity left", () => {
    expect(firstSourceLineWithRoom(sold, [])).toBe("l1");
    expect(firstSourceLineWithRoom(sold, [{ sourceLineId: "l1", qty: "2" }])).toBe("l1");
  });

  it("moves to the next line once the rows already on the form take the whole of the first", () => {
    expect(firstSourceLineWithRoom(sold, [{ sourceLineId: "l1", qty: "3" }])).toBe("l2");
    expect(firstSourceLineWithRoom(sold, [{ sourceLineId: "l1", qty: "1" }, { sourceLineId: "l1", qty: "2" }])).toBe("l2");
  });

  it("adds what confirmed returns took to what the form rows take, exactly — 0.1 + 0.2 is 0.3", () => {
    const fine = [{ sourceLineId: "l1", qty: "0.3" }, { sourceLineId: "l2", qty: "1" }];
    expect(firstSourceLineWithRoom(fine, [{ sourceLineId: "l1", qty: "0.1" }, { sourceLineId: "l1", qty: "0.2" }])).toBe("l2");
  });

  it("answers null when no line has anything left", () => {
    expect(firstSourceLineWithRoom(sold, [{ sourceLineId: "l1", qty: "3" }, { sourceLineId: "l2", qty: "5" }])).toBeNull();
    expect(firstSourceLineWithRoom([], [])).toBeNull();
  });
});

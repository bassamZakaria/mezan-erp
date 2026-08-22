// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextField } from "./item-form-controls";

describe("item-form-controls TextField", () => {
  it("keeps the hint out of the label's accessible name and ties it via aria-describedby instead", () => {
    render(
      <TextField label="كود الصنف" value="" onChange={() => {}} disabled dir="ltr" hint="يُنشأ تلقائياً" />,
    );

    // Accessible name resolves to exactly the label text — the hint is no longer folded in.
    const input = screen.getByLabelText("كود الصنف");
    expect(input).toHaveAccessibleName("كود الصنف");

    const hint = screen.getByText("يُنشأ تلقائياً");
    expect(input).toHaveAttribute("aria-describedby", hint.id);
  });

  it("omits aria-describedby when there is no hint", () => {
    render(<TextField label="اسم الصنف" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("اسم الصنف")).not.toHaveAttribute("aria-describedby");
  });
});

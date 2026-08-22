// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangeFilter } from "./DateRangeFilter";

describe("DateRangeFilter", () => {
  it("renders all preset chips", () => {
    render(
      <DateRangeFilter preset="month" onPresetChange={() => {}} range={{ from: null, to: null }} onRangeChange={() => {}} />,
    );
    expect(screen.getByRole("radio", { name: "هذا الشهر" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "اليوم" })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onPresetChange when a chip is clicked", () => {
    const onPresetChange = vi.fn();
    render(
      <DateRangeFilter preset="month" onPresetChange={onPresetChange} range={{ from: null, to: null }} onRangeChange={() => {}} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "هذا الربع" }));
    expect(onPresetChange).toHaveBeenCalledWith("quarter");
  });

  it("only shows the custom from/to inputs when preset is 'custom'", () => {
    const { rerender } = render(
      <DateRangeFilter preset="month" onPresetChange={() => {}} range={{ from: null, to: null }} onRangeChange={() => {}} />,
    );
    expect(screen.queryByLabelText("من تاريخ")).not.toBeInTheDocument();

    rerender(
      <DateRangeFilter preset="custom" onPresetChange={() => {}} range={{ from: null, to: null }} onRangeChange={() => {}} />,
    );
    expect(screen.getByLabelText("من تاريخ")).toBeInTheDocument();
    expect(screen.getByLabelText("إلى تاريخ")).toBeInTheDocument();
  });

  it("calls onRangeChange when a custom date is edited", () => {
    const onRangeChange = vi.fn();
    render(
      <DateRangeFilter preset="custom" onPresetChange={() => {}} range={{ from: null, to: null }} onRangeChange={onRangeChange} />,
    );
    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-08-01" } });
    expect(onRangeChange).toHaveBeenCalledWith({ from: "2026-08-01", to: null });
  });
});

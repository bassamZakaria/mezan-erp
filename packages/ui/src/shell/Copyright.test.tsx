// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Copyright } from "./Copyright";

afterEach(() => {
  vi.useRealTimers();
});

describe("Copyright", () => {
  it("renders the Arabic copyright notice with the current year interpolated, Cyag named", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
    render(<Copyright />);
    expect(screen.getByText("جميع الحقوق محفوظة © 2026 Cyag")).toBeInTheDocument();
  });

  it("does not go stale across a year boundary — it reads the clock, not a stored year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    render(<Copyright />);
    expect(screen.getByText(/2030/)).toBeInTheDocument();
  });
});

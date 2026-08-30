// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Kbd, modKeyLabel } from "./Kbd";

describe("Kbd", () => {
  it("splits a '+'-joined string into separate caps", () => {
    render(<Kbd keys="Ctrl+K" />);
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
  });

  it("keeps a space-joined chord as one cap rather than splitting it", () => {
    render(<Kbd keys="g s" />);
    expect(screen.getByText("g s")).toBeInTheDocument();
  });

  it("renders an array of keys as-is without splitting on '+'", () => {
    render(<Kbd keys={["Ctrl", "Shift", "P"]} />);
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.getByText("Shift")).toBeInTheDocument();
    expect(screen.getByText("P")).toBeInTheDocument();
  });

  it("applies the chrome tone classes when tone is 'chrome'", () => {
    render(<Kbd keys="K" tone="chrome" />);
    expect(screen.getByText("K")).toHaveClass("border-chrome-border");
  });

  it("applies the surface tone classes by default", () => {
    render(<Kbd keys="K" />);
    expect(screen.getByText("K")).toHaveClass("border-border-strong");
  });

  it("isolates the shortcut as a latin run for RTL surrounding text", () => {
    const { container } = render(<Kbd keys="Ctrl+K" />);
    expect(container.querySelector("span.mz-lat")).not.toBeNull();
  });
});

describe("modKeyLabel", () => {
  const originalUserAgent = navigator.userAgent;

  afterEach(() => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: originalUserAgent });
  });

  it("returns the command glyph on Apple platforms", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    expect(modKeyLabel()).toBe("⌘");
  });

  it("returns Ctrl on non-Apple platforms", () => {
    vi.stubGlobal("navigator", { ...navigator, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" });
    expect(modKeyLabel()).toBe("Ctrl");
  });
});

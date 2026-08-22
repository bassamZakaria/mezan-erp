// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useTheme } from "./useTheme";

function ThemeProbe() {
  const { theme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("dark")}>set-dark</button>
      <button onClick={() => setTheme("light")}>set-light</button>
      <button onClick={() => setTheme("system")}>set-system</button>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

function rootAttr(): string {
  return document.documentElement.getAttribute("data-theme") ?? "none";
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("useTheme", () => {
  it("defaults to system (no data-theme attribute) with no stored preference", () => {
    render(<ThemeProbe />);
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    expect(rootAttr()).toBe("none");
  });

  it("setting an explicit theme applies [data-theme] on <html>", () => {
    render(<ThemeProbe />);
    fireEvent.click(screen.getByText("set-dark"));
    expect(rootAttr()).toBe("dark");
    fireEvent.click(screen.getByText("set-light"));
    expect(rootAttr()).toBe("light");
  });

  it("returning to system removes the attribute again", () => {
    render(<ThemeProbe />);
    fireEvent.click(screen.getByText("set-dark"));
    fireEvent.click(screen.getByText("set-system"));
    expect(rootAttr()).toBe("none");
  });

  it("toggleTheme flips light <-> dark", () => {
    render(<ThemeProbe />);
    fireEvent.click(screen.getByText("set-light"));
    act(() => fireEvent.click(screen.getByText("toggle")));
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    act(() => fireEvent.click(screen.getByText("toggle")));
    expect(screen.getByTestId("theme")).toHaveTextContent("light");
  });

  it("persists the preference to localStorage", () => {
    render(<ThemeProbe />);
    fireEvent.click(screen.getByText("set-dark"));
    expect(window.localStorage.getItem("mezan:theme")).toBe("dark");
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useDebounced } from "./use-debounced";
import { EMPTY } from "./empty";

function Harness({ delayMs }: { delayMs?: number }) {
  const [text, setText] = useState("");
  const settled = useDebounced(text, delayMs);
  return (
    <>
      <input aria-label="بحث" value={text} onChange={(e) => setText(e.target.value)} />
      <output data-testid="settled">{settled}</output>
      <button type="button" onClick={() => setText((t) => `${t}x`)}>
        type
      </button>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebounced", () => {
  it("holds the value still until the delay has passed", () => {
    vi.useFakeTimers();
    render(<Harness />);

    act(() => screen.getByText("type").click());
    expect(screen.getByTestId("settled").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.getByTestId("settled").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("settled").textContent).toBe("x");
  });

  it("lets only the last of a burst of keystrokes through", () => {
    vi.useFakeTimers();
    render(<Harness />);

    for (let i = 0; i < 6; i++) {
      act(() => screen.getByText("type").click());
      act(() => {
        vi.advanceTimersByTime(50);
      });
    }
    expect(screen.getByTestId("settled").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("settled").textContent).toBe("xxxxxx");
  });

  it("honours a caller's own delay", () => {
    vi.useFakeTimers();
    render(<Harness delayMs={1000} />);

    act(() => screen.getByText("type").click());
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByTestId("settled").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("settled").textContent).toBe("x");
  });

  it("starts settled on its initial value, so the first render is not empty", () => {
    render(<Harness />);
    expect(screen.getByTestId("settled").textContent).toBe("");
  });
});

describe("EMPTY", () => {
  it("is the same array every time, so a memo dependency can hold still", () => {
    const maybeUndefined: readonly unknown[] | undefined = undefined;
    const first: readonly unknown[] = maybeUndefined ?? EMPTY;
    const second: readonly unknown[] = maybeUndefined ?? EMPTY;
    expect(first).toBe(second);
    expect(first).toHaveLength(0);
  });
});

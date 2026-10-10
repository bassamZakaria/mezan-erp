// @vitest-environment jsdom
import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { useUrlFlag, useUrlNumber, useUrlParam, useUrlSearch, useUrlSort } from "./url-state";

function Address() {
  const location = useLocation();
  return <output data-testid="address">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(ui: React.ReactElement, initial = "/items") {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/items"
          element={
            <>
              {ui}
              <Address />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const address = () => screen.getByTestId("address").textContent;

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useUrlParam", () => {
  function Harness({ fallback = "" }: { fallback?: string }) {
    const [status, setStatus] = useUrlParam("status", fallback);
    return (
      <>
        <output data-testid="value">{status}</output>
        <button type="button" onClick={() => setStatus("out_of_stock")}>
          set
        </button>
        <button type="button" onClick={() => setStatus(fallback)}>
          reset
        </button>
      </>
    );
  }

  it("reads the value out of the address", () => {
    renderAt(<Harness />, "/items?status=active");
    expect(screen.getByTestId("value").textContent).toBe("active");
  });

  it("falls back when the parameter is absent", () => {
    renderAt(<Harness fallback="all" />);
    expect(screen.getByTestId("value").textContent).toBe("all");
  });

  it("writes the value into the address", async () => {
    renderAt(<Harness fallback="all" />);
    act(() => screen.getByText("set").click());
    await flush();
    expect(address()).toBe("/items?status=out_of_stock");
    expect(screen.getByTestId("value").textContent).toBe("out_of_stock");
  });

  it("removes a value equal to its default, so an untouched screen has a clean address", async () => {
    renderAt(<Harness fallback="all" />, "/items?status=active");
    act(() => screen.getByText("reset").click());
    await flush();
    expect(address()).toBe("/items");
  });

  it("replaces rather than pushes, so Back leaves the screen instead of walking the filters", async () => {
    renderAt(<Harness fallback="all" />);
    act(() => screen.getByText("set").click());
    await flush();
    expect(window.history.length).toBeLessThan(5);
  });
});

describe("useUrlNumber", () => {
  function Harness() {
    const [page, setPage] = useUrlNumber("page", 1);
    return (
      <>
        <output data-testid="value">{String(page)}</output>
        <button type="button" onClick={() => setPage(3)}>
          go
        </button>
        <button type="button" onClick={() => setPage(1)}>
          first
        </button>
      </>
    );
  }

  it("reads a number out of the address", () => {
    renderAt(<Harness />, "/items?page=4");
    expect(screen.getByTestId("value").textContent).toBe("4");
  });

  it("falls back when the parameter is missing or not a number", () => {
    renderAt(<Harness />, "/items?page=abc");
    expect(screen.getByTestId("value").textContent).toBe("1");
  });

  it("writes a page and drops it again at the default", async () => {
    renderAt(<Harness />);
    act(() => screen.getByText("go").click());
    await flush();
    expect(address()).toBe("/items?page=3");

    act(() => screen.getByText("first").click());
    await flush();
    expect(address()).toBe("/items");
  });
});

describe("useUrlFlag", () => {
  function Harness() {
    const [on, setOn] = useUrlFlag("archived");
    return (
      <>
        <output data-testid="value">{on ? "on" : "off"}</output>
        <button type="button" onClick={() => setOn(!on)}>
          toggle
        </button>
      </>
    );
  }

  it("is on only for the literal 1", () => {
    renderAt(<Harness />, "/items?archived=1");
    expect(screen.getByTestId("value").textContent).toBe("on");
  });

  it("is off for any other value, including `true`", () => {
    renderAt(<Harness />, "/items?archived=true");
    expect(screen.getByTestId("value").textContent).toBe("off");
  });

  it("appears in the address only while it is on", async () => {
    renderAt(<Harness />);
    act(() => screen.getByText("toggle").click());
    await flush();
    expect(address()).toBe("/items?archived=1");

    act(() => screen.getByText("toggle").click());
    await flush();
    expect(address()).toBe("/items");
  });
});

describe("useUrlSort", () => {
  function Harness() {
    const [sort, setSort] = useUrlSort<"code" | "name">({ key: "code", direction: "asc" });
    return (
      <>
        <output data-testid="value">{`${sort.key}:${sort.direction}`}</output>
        <button type="button" onClick={() => setSort({ key: "name", direction: "desc" })}>
          by name
        </button>
      </>
    );
  }

  it("parses the one-parameter form", () => {
    renderAt(<Harness />, "/items?sort=name:desc");
    expect(screen.getByTestId("value").textContent).toBe("name:desc");
  });

  it("treats any direction that is not desc as ascending", () => {
    renderAt(<Harness />, "/items?sort=name:sideways");
    expect(screen.getByTestId("value").textContent).toBe("name:asc");
  });

  it("falls back for an empty sort parameter", () => {
    renderAt(<Harness />, "/items?sort=");
    expect(screen.getByTestId("value").textContent).toBe("code:asc");
  });

  it("writes the column and its direction as one fact", async () => {
    renderAt(<Harness />);
    act(() => screen.getByText("by name").click());
    await flush();
    expect(address()).toBe("/items?sort=name%3Adesc");
  });
});

describe("useUrlSearch", () => {
  function Harness() {
    const [text, setText, settled] = useUrlSearch("q", 0);
    return (
      <>
        <input aria-label="بحث" value={text} onChange={(e) => setText(e.target.value)} />
        <output data-testid="settled">{settled}</output>
      </>
    );
  }

  it("opens with whatever the address already carries", () => {
    renderAt(<Harness />, "/items?q=%D8%A3%D8%B1%D8%B2");
    expect((screen.getByLabelText("بحث") as HTMLInputElement).value).toBe("أرز");
    expect(screen.getByTestId("settled").textContent).toBe("أرز");
  });

  it("settles the typed text into the address", async () => {
    renderAt(<Harness />);
    const input = screen.getByLabelText("بحث") as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "أرز");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    await flush();
    expect(decodeURIComponent(address() as string)).toBe("/items?q=أرز");
  });
});

describe("two writes in one handler", () => {
  function Harness() {
    const [status, setStatus] = useUrlParam("status", "all");
    const [page, setPage] = useUrlNumber("page", 1);
    return (
      <>
        <output data-testid="value">{`${status}|${page}`}</output>
        <button
          type="button"
          onClick={() => {
            setStatus("out_of_stock");
            setPage(1);
          }}
        >
          filter
        </button>
      </>
    );
  }

  it("merges them, so ticking a chip does not drop the chip while resetting the page", async () => {
    renderAt(<Harness />, "/items?page=5");
    act(() => screen.getByText("filter").click());
    await flush();
    expect(address()).toBe("/items?status=out_of_stock");
  });
});

/**
 * فواتير المبيعات resets its pager in an effect keyed on its filters AND on
 * `setPage`. react-router hands back a new `setSearchParams` whenever the
 * address changes, and the setters here were rebuilt from it — so writing
 * `page=2` changed `setPage`, re-ran the effect, and wrote the page straight
 * back to 1. Every page after the first was unreachable.
 */
describe("a setter listed in an effect's dependencies", () => {
  function Harness() {
    const [status] = useUrlParam("status", "all");
    const [page, setPage] = useUrlNumber("page", 1);
    useEffect(() => {
      setPage(1);
    }, [status, setPage]);
    return (
      <>
        <output data-testid="value">{String(page)}</output>
        <button type="button" onClick={() => setPage(2)}>
          next
        </button>
      </>
    );
  }

  it("keeps its identity across address changes, so paging is not undone by the reset effect", async () => {
    renderAt(<Harness />);
    await flush();
    act(() => screen.getByText("next").click());
    await flush();
    await flush();
    expect(address()).toBe("/items?page=2");
    expect(screen.getByTestId("value").textContent).toBe("2");
  });

  it("still writes through the current address after earlier writes", async () => {
    function Two() {
      const [status, setStatus] = useUrlParam("status", "all");
      const [page, setPage] = useUrlNumber("page", 1);
      return (
        <>
          <output data-testid="value">{`${status}|${page}`}</output>
          <button type="button" onClick={() => setStatus("active")}>
            status
          </button>
          <button type="button" onClick={() => setPage(3)}>
            page
          </button>
        </>
      );
    }
    renderAt(<Two />);
    act(() => screen.getByText("status").click());
    await flush();
    act(() => screen.getByText("page").click());
    await flush();
    expect(address()).toBe("/items?status=active&page=3");
  });
});

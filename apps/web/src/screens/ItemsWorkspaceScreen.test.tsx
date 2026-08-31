// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactElement } from "react";
import { screen, fireEvent, within, waitFor} from "@testing-library/react";
import { ItemsWorkspaceScreen } from "./ItemsWorkspaceScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * `ItemsWorkspaceScreen` is a thin `ScreenTabs` composition — the tab strip
 * itself reads/writes the screen's open segment through `useSubPage()`, so it
 * needs the same in-memory `NavigationProvider` stand-in the tabbed
 * sub-screens' own tests use. Crucially this mirrors production exactly:
 * `AppLayout.tsx` wires exactly ONE such provider for the whole app, with
 * `segments` a single flat array per active screen (AppLayout.tsx:164-165) —
 * there is no per-tab nesting, so this stand-in reproduces the real sharing
 * between `ScreenTabs` and whatever it mounts.
 */
function WithSubPageNav({ children }: { children: ReactElement }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

function trackedTransport(handlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult>) {
  const calls: string[] = [];
  const wrapped: typeof handlers = {};
  for (const [key, fn] of Object.entries(handlers)) {
    wrapped[key] = (init, path) => {
      calls.push(`${key.split(" ")[0]} ${path}`);
      return fn(init, path);
    };
  }
  return { transport: stubTransport(wrapped), calls };
}

describe("ItemsWorkspaceScreen", () => {
  it("opens on الأصناف and renders only that tab's screen (the others are unmounted, not just hidden)", async () => {
    const { transport, calls } = trackedTransport({
      "GET /items": () => ({ body: [] }),
      "GET /accounts": () => ({ body: [] }),
    });
    renderWithProviders(
      <WithSubPageNav>
        <ItemsWorkspaceScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );

    const tablist = screen.getByRole("tablist", { name: "أقسام الأصناف" });
    const selected = within(tablist).getByRole("tab", { selected: true });
    expect(selected).toHaveTextContent("الأصناف");

    expect(await screen.findByText("لا توجد أصناف مطابقة")).toBeInTheDocument();
    // GET /item-specifications never fires while the specs tab is unopened —
    // ScreenTabs mounts a render FUNCTION per tab, not a kept-alive node.
    expect(calls.some((c) => c.startsWith("GET /item-specifications"))).toBe(false);
  });

  it("folds the other four sections behind «أقسام أخرى من الأصناف» and lists them there", async () => {
    const transport = stubTransport({ "GET /items": () => ({ body: [] }), "GET /accounts": () => ({ body: [] }) });
    renderWithProviders(
      <WithSubPageNav>
        <ItemsWorkspaceScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد أصناف مطابقة");

    const tablist = screen.getByRole("tablist", { name: "أقسام الأصناف" });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1); // only الأصناف is on the strip (primaryCount=1)
    fireEvent.click(screen.getByRole("button", { name: "أقسام أخرى من الأصناف" }));
    const menu = screen.getByRole("menu", { name: "أقسام أخرى من الأصناف" });
    expect(menu).toHaveTextContent("قوالب المنتجات");
    expect(menu).toHaveTextContent("منتجات قابلة للتهيئة");
    expect(menu).toHaveTextContent("المواصفات");
    expect(menu).toHaveTextContent("قوائم المواد");
  });

  /**
   * DEFECT — the tab strip and the mounted screen fight over the same
   * segment. `ScreenTabs` (ScreenTabs.tsx:51-55) reads `segments[0]` as the
   * open TAB KEY and never strips it before rendering the tab body
   * (ScreenTabs.tsx:127: `{active?.render()}`, no nested `NavigationProvider`
   * that shifts `segments`). But `ItemSpecificationsScreen` also owns
   * `useSubPage()` (ItemSpecificationsScreen.tsx:273) and reads that exact
   * same `segments[0]` as its OWN sub-page address — "new" to create, or an
   * item-specification CODE to edit (ItemSpecificationsScreen.tsx:380-396).
   * With segments=["specs"] (what `#/stock/items/specs` actually is), the
   * tab strip correctly reads "specs" as the open tab, while the screen
   * mounted inside it just as correctly reads "specs" as a specification
   * CODE it has never heard of, and renders its own not-found page instead
   * of the list. ItemsWorkspaceScreen.tsx:19-31's own comment claims "None
   * of the four screens uses sub-pages of its own... so nothing is shadowed
   * by taking that segment" — false for هذا (specs) and for BomsScreen,
   * which has the identical `useSubPage()` shape (BomsScreen.tsx:161,331).
   * المواصفات is unreachable through this workspace whenever it is not tab 0.
   */
  it("[DEFECT] shows المواصفات as tab-not-found instead of its list once it is not the default tab", async () => {
    const transport = stubTransport({
      "GET /items": () => ({ body: [] }),
      "GET /accounts": () => ({ body: [] }),
      "GET /item-specifications": () => ({ body: [] }),
    });
    renderWithProviders(
      <WithSubPageNav>
        <ItemsWorkspaceScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد أصناف مطابقة");

    fireEvent.click(screen.getByRole("button", { name: "أقسام أخرى من الأصناف" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "المواصفات" }));

    // The STRIP itself gets it right — ScreenTabs owns tab selection cleanly.
    const tablist = screen.getByRole("tablist", { name: "أقسام الأصناف" });
    const selected = await within(tablist).findByRole("tab", { selected: true });
    expect(selected).toHaveTextContent("المواصفات");

    // But the mounted screen, reading the very same segment as its own
    // sub-page address, thinks "specs" names a specification to edit.
    expect(await screen.findByText("لم يتم العثور على هذه المواصفة.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("لا توجد مواصفات — أضف مواصفة جديدة")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "العودة إلى المواصفات" })).toBeInTheDocument();
  });
});

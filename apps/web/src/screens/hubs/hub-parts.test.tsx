// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppI18nProvider } from "../../i18n";
import { NavigationProvider } from "../../navigation";
import { DateAndDoc, HubActions, type HubAction } from "./hub-parts";

function TestNavigation({ navigate, children }: { navigate: (screen: string, intent?: unknown) => void; children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: navigate as never,
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

function renderWithNav(ui: ReactNode, navigate: (screen: string, intent?: unknown) => void) {
  return render(
    <AppI18nProvider>
      <TestNavigation navigate={navigate}>{ui}</TestNavigation>
    </AppI18nProvider>,
  );
}

describe("HubActions", () => {
  const actions: HubAction[] = [
    { label: "accountingHub.newJournalEntry", screen: "journals" },
    { label: "assetsHub.newAsset", screen: "asset-register" },
  ];

  it("renders one button per action with the right Arabic label", () => {
    const navigate = vi.fn();
    renderWithNav(<HubActions actions={actions} />, navigate);
    expect(screen.getByRole("button", { name: "قيد محاسبي جديد" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أصل جديد" })).toBeInTheDocument();
  });

  it("marks the first action primary and the rest default", () => {
    const navigate = vi.fn();
    renderWithNav(<HubActions actions={actions} />, navigate);
    const first = screen.getByRole("button", { name: "قيد محاسبي جديد" });
    const second = screen.getByRole("button", { name: "أصل جديد" });
    expect(first.className).toMatch(/brand/);
    expect(second.className).not.toEqual(first.className);
  });

  it("navigates to the action's screen with a create intent on click", () => {
    const navigate = vi.fn();
    renderWithNav(<HubActions actions={actions} />, navigate);
    fireEvent.click(screen.getByRole("button", { name: "أصل جديد" }));
    expect(navigate).toHaveBeenCalledWith("asset-register", "create");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("renders nothing for an empty action list", () => {
    const navigate = vi.fn();
    const { container } = renderWithNav(<HubActions actions={[]} />, navigate);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("DateAndDoc", () => {
  it("renders only the date when docNo is null", () => {
    render(
      <AppI18nProvider>
        <DateAndDoc date="2026-08-30" docNo={null} />
      </AppI18nProvider>,
    );
    expect(screen.getByText("2026-08-30")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders only the date when docNo is undefined", () => {
    render(
      <AppI18nProvider>
        <DateAndDoc date="2026-08-30" />
      </AppI18nProvider>,
    );
    expect(screen.getByText("2026-08-30")).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it("renders the docNo after a separator when provided", () => {
    render(
      <AppI18nProvider>
        <DateAndDoc date="2026-08-30" docNo="JE-0001" />
      </AppI18nProvider>,
    );
    expect(screen.getByText("2026-08-30")).toBeInTheDocument();
    expect(screen.getByText("· JE-0001")).toBeInTheDocument();
  });
});

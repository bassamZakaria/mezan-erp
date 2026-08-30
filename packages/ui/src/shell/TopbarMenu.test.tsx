// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TopbarMenu } from "./TopbarMenu";

function renderMenu(childrenFactory?: (close: () => void) => ReactNode) {
  return render(
    <TopbarMenu
      label="قائمة المستخدم"
      trigger={(props) => (
        <button ref={props.ref} onClick={props.onClick} aria-haspopup={props["aria-haspopup"]} aria-expanded={props["aria-expanded"]}>
          فتح القائمة
        </button>
      )}
    >
      {childrenFactory ?? ((close) => <button onClick={close}>عنصر القائمة</button>)}
    </TopbarMenu>,
  );
}

describe("TopbarMenu", () => {
  it("is closed initially, with aria-expanded false on the trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "فتح القائمة" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the panel on trigger click, portaled with role=menu and the given label", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "فتح القائمة" }));
    const menu = screen.getByRole("menu", { name: "قائمة المستخدم" });
    expect(menu).toBeInTheDocument();
    expect(menu.parentElement).toBe(document.body);
  });

  it("clicking the trigger again toggles the panel closed", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "فتح القائمة" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on outside click", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "فتح القائمة" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not close on a click inside the panel itself", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "فتح القائمة" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "عنصر القائمة" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "فتح القائمة" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("passes a close callback to a function-as-children body, which closes the panel", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "فتح القائمة" }));
    fireEvent.click(screen.getByRole("button", { name: "عنصر القائمة" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("accepts static (non-function) children too", () => {
    render(
      <TopbarMenu label="ثابت" trigger={(props) => <button ref={props.ref} onClick={props.onClick}>فتح</button>}>
        <span>محتوى ثابت</span>
      </TopbarMenu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "فتح" }));
    expect(screen.getByText("محتوى ثابت")).toBeInTheDocument();
  });
});

/**
 * D113: the panel is portaled to <body>, so it is nowhere near its trigger in
 * the DOM. Without moving focus in, a keyboard user who opens it Tabs into
 * whatever follows the trigger in the page instead; without moving it back
 * out, the item they activate destroys the element focus was on and strands
 * them on <body>, at the top of the document.
 */
describe("TopbarMenu — focus management (D113)", () => {
  it("moves focus into the panel when it opens, so the first item is reachable without hunting for it", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "فتح القائمة" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "عنصر القائمة" }));
  });

  it("returns focus to the trigger when an item closes the panel", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "فتح القائمة" });
    trigger.focus();
    fireEvent.click(trigger);
    const item = screen.getByRole("button", { name: "عنصر القائمة" });
    // A keyboard user activates the item they are ON — so focus is inside the
    // panel when it goes away, and something has to catch it.
    item.focus();
    fireEvent.click(item);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves focus alone when the user dismisses it by clicking something else", () => {
    const outside = document.createElement("button");
    outside.textContent = "زر آخر";
    document.body.append(outside);
    try {
      renderMenu();
      const trigger = screen.getByRole("button", { name: "فتح القائمة" });
      trigger.focus();
      fireEvent.click(trigger);
      fireEvent.mouseDown(outside);
      expect(screen.queryByRole("menu")).toBeNull();
      // The click owns the focus now; yanking it back to the trigger would
      // fight the person who made it.
      expect(document.activeElement).not.toBe(trigger);
    } finally {
      outside.remove();
    }
  });
});

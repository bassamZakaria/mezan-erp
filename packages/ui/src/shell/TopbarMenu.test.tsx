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

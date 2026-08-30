// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirmAction } from "./use-confirm-action";

function Harness({ onConfirm }: { onConfirm: () => void | Promise<void> }) {
  const { ask, dialog } = useConfirmAction();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          ask({
            title: "حذف الإجازة",
            consequence: "سيُحذف يوم الإجازة من التقويم ولن يظهر في كشوف الحضور.",
            confirmLabel: "حذف",
            onConfirm,
          })
        }
      >
        احذف
      </button>
      {dialog}
    </>
  );
}

describe("useConfirmAction", () => {
  it("destroys nothing until the person confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByText("احذف"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("says what the action will do, not merely 'are you sure'", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={vi.fn()} />);
    await user.click(screen.getByText("احذف"));

    expect(screen.getByText("حذف الإجازة")).toBeInTheDocument();
    expect(
      screen.getByText("سيُحذف يوم الإجازة من التقويم ولن يظهر في كشوف الحضور."),
    ).toBeInTheDocument();
  });

  it("runs the action once the person confirms, and closes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "حذف" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("runs nothing when the person cancels", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByText("احذف"));
    const cancel = screen
      .getAllByRole("button")
      .find((b) => b.textContent !== null && b.textContent !== "حذف" && b.textContent !== "احذف");
    await user.click(cancel as HTMLElement);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("awaits an async action without leaving the dialog open", async () => {
    const user = userEvent.setup();
    let resolved = false;
    render(
      <Harness
        onConfirm={async () => {
          await Promise.resolve();
          resolved = true;
        }}
      />,
    );

    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "حذف" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolved).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks again for a second action rather than reusing the first answer", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await user.click(screen.getByText("احذف"));
    await user.click(screen.getByRole("button", { name: "حذف" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText("احذف"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

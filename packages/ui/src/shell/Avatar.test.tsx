// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  it("shows the initials on a disc when there is no photo", () => {
    render(<Avatar user={{ name: "محمد الشهابي", initials: "م.ش", photoUrl: null }} size={30} />);
    expect(screen.getByText("م.ش")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders the photo instead of initials when photoUrl is set, with an empty alt", () => {
    const { container } = render(
      <Avatar user={{ name: "محمد الشهابي", initials: "م.ش", photoUrl: "data:image/png;base64,abc" }} size={30} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc");
    expect(img).toHaveAttribute("alt", "");
    expect(screen.queryByText("م.ش")).toBeNull();
  });

  it("sizes the disc square, from the size prop", () => {
    render(<Avatar user={{ name: "س", initials: "س", photoUrl: null }} size={44} />);
    const disc = screen.getByText("س");
    expect(disc).toHaveStyle({ width: "44px", height: "44px" });
  });

  it("uses the smaller type size below 36px", () => {
    render(<Avatar user={{ name: "س", initials: "س", photoUrl: null }} size={24} />);
    expect(screen.getByText("س").className).toContain("text-[11px]");
  });

  it("uses the larger type size at or above 36px", () => {
    render(<Avatar user={{ name: "س", initials: "س", photoUrl: null }} size={36} />);
    expect(screen.getByText("س").className).toContain("text-sm");
  });
});

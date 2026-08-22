// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App";

function login() {
  "1234".split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
  fireEvent.click(screen.getByRole("button", { name: "دخول" }));
}

describe("App", () => {
  it("shows the login screen first, and لوحة التحكم is the landing screen after signing in", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();

    login();

    expect(screen.getByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
    // The top nav "لوحة التحكم" sidebar entry marks itself current when it's the active screen.
    expect(screen.getByRole("button", { name: "لوحة التحكم" })).toHaveAttribute("aria-current", "page");
    // The shell surfaces the actual tenant name, not just the static "ميزان" product wordmark.
    expect(screen.getByText("Cyag")).toBeInTheDocument();
  });

  it("routes to another screen and back to لوحة التحكم via the sidebar top item", () => {
    render(<App />);
    login();

    fireEvent.click(screen.getByRole("button", { name: "دليل الحسابات" }));
    expect(screen.queryByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "لوحة التحكم" }));
    expect(screen.getByRole("heading", { name: "مرحباً، محمد · طاب يومك" })).toBeInTheDocument();
  });

  it("reaches the first-run wizard from the login screen and can cancel back to it", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي" }));
    expect(screen.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
  });
});

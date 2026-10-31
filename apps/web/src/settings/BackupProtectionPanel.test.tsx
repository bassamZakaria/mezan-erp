// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackupProtectionPanel } from "./BackupProtectionPanel";
import { BackupFailureCode, RecoveryMode, type RecoveryStatus } from "./backup-bridge";
import { renderWithProviders } from "../data/test-support";

const PROTECTED: RecoveryStatus = {
  mode: RecoveryMode.Passphrase,
  setAt: "2026-10-01T09:00:00.000Z",
  keyCardAvailable: false,
  keyStoreAvailable: true,
};

function installBridge(setRecovery: (...args: unknown[]) => Promise<unknown>) {
  (globalThis as { mezan?: unknown }).mezan = { backup: { setRecovery: vi.fn(setRecovery) } };
  return (globalThis as unknown as { mezan: { backup: { setRecovery: ReturnType<typeof vi.fn> } } }).mezan.backup.setRecovery;
}

afterEach(() => {
  delete (globalThis as { mezan?: unknown }).mezan;
});

async function fillReplacement(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "تغيير كلمة السر أو الطريقة" }));
  await user.type(screen.getByLabelText(/كلمة سر الاسترداد/), "a long new passphrase");
  await user.type(screen.getByLabelText(/أعد كتابة كلمة السر/), "a long new passphrase");
  await user.click(screen.getByRole("checkbox"));
}

describe("replacing the backup protection", () => {
  it("asks for the current sign-in password, not a 6-digit PIN, and sends it to the main process", async () => {
    const setRecovery = installBridge(async () => ({ ok: true, recovery: PROTECTED }));
    const user = userEvent.setup();
    renderWithProviders(<BackupProtectionPanel sessionToken="TOKEN" recovery={PROTECTED} onSaved={() => undefined} />);

    await fillReplacement(user);
    const save = screen.getByRole("button", { name: "احفظ التغيير" });
    expect(save).toBeDisabled();

    const password = screen.getByLabelText(/كلمة المرور الحالية/);
    expect(password).toHaveAttribute("type", "password");
    expect(password).not.toHaveAttribute("maxlength");
    await user.type(password, "Cyag@2026");
    await user.click(save);

    await waitFor(() =>
      expect(setRecovery).toHaveBeenCalledWith("TOKEN", {
        mode: RecoveryMode.Passphrase,
        passphrase: "a long new passphrase",
        password: "Cyag@2026",
      }),
    );
  });

  it("clears the password field when the main process says it is wrong", async () => {
    installBridge(async () => ({
      ok: false,
      code: BackupFailureCode.WrongPassword,
      message: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
      keyCardAvailable: false,
      keyStoreAvailable: true,
    }));
    const user = userEvent.setup();
    renderWithProviders(<BackupProtectionPanel sessionToken="TOKEN" recovery={PROTECTED} onSaved={() => undefined} />);

    await fillReplacement(user);
    await user.type(screen.getByLabelText(/كلمة المرور الحالية/), "wrong");
    await user.click(screen.getByRole("button", { name: "احفظ التغيير" }));

    expect(await screen.findByText("البريد الإلكتروني أو كلمة المرور غير صحيحة.")).toBeInTheDocument();
    expect(screen.getByLabelText(/كلمة المرور الحالية/)).toHaveValue("");
  });
});

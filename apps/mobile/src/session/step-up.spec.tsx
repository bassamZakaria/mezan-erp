/// <reference types="jest" />
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError, ApiFailure } from "@/api/errors";
import { StepUpOverlay } from "@/components/step-up-overlay";
import { STEP_UP_REQUIRED, withStepUp } from "./step-up";

const refusal = () => new ApiError(ApiFailure.Forbidden, 403, "تغيّر عنوان اتصالك منذ تسجيل الدخول.", null, STEP_UP_REQUIRED);

describe("a request the server answers by asking for the password again", () => {
  it("is sent once more after the password is confirmed, and its answer handed back", async () => {
    let sends = 0;
    const send = async () => {
      sends += 1;
      if (sends === 1) throw refusal();
      return "saved";
    };
    const asked: string[] = [];

    const answer = await withStepUp(send, async (message) => {
      asked.push(message);
      return true;
    });

    expect(answer).toBe("saved");
    expect(sends).toBe(2);
    expect(asked).toEqual(["تغيّر عنوان اتصالك منذ تسجيل الدخول."]);
  });

  it("is not sent again when the person cancels, and is never asked about twice", async () => {
    let sends = 0;
    const always = async () => {
      sends += 1;
      throw refusal();
    };

    await expect(withStepUp(always, async () => false)).rejects.toBeInstanceOf(ApiError);
    expect(sends).toBe(1);

    sends = 0;
    let asks = 0;
    await expect(withStepUp(always, async () => ((asks += 1), true))).rejects.toBeInstanceOf(ApiError);
    expect(sends).toBe(2);
    expect(asks).toBe(1);
  });

  it("leaves every other refusal alone", async () => {
    const forbidden = new ApiError(ApiFailure.Forbidden, 403, "ليست لديك صلاحية", null, "FORBIDDEN");
    let asks = 0;
    await expect(withStepUp(async () => Promise.reject(forbidden), async () => ((asks += 1), true))).rejects.toBe(forbidden);
    expect(asks).toBe(0);
  });
});

describe("the password prompt", () => {
  it("confirms the password with the server, shows its refusal, and closes only when the password is accepted", async () => {
    const passwords: string[] = [];
    const confirm = jest.fn(async (password: string) => {
      passwords.push(password);
      return passwords.length === 1 ? "كلمة المرور غير صحيحة." : null;
    });
    const cancel = jest.fn();
    await render(<StepUpOverlay message="تغيّر عنوان اتصالك منذ تسجيل الدخول." onConfirm={confirm} onCancel={cancel} />);

    expect(screen.getByText("تغيّر عنوان اتصالك منذ تسجيل الدخول.")).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("step-up-password"), "wrong-password"));
    await act(async () => fireEvent.press(screen.getByTestId("step-up-confirm")));
    expect(screen.getByText("كلمة المرور غير صحيحة.")).toBeTruthy();

    await act(async () => fireEvent.changeText(screen.getByTestId("step-up-password"), "Cyag@2026"));
    await act(async () => fireEvent.press(screen.getByTestId("step-up-confirm")));
    expect(passwords).toEqual(["wrong-password", "Cyag@2026"]);

    await act(async () => fireEvent.press(screen.getByTestId("step-up-cancel")));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

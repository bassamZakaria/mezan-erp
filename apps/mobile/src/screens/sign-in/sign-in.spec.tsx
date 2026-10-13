/// <reference types="jest" />
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError, ApiFailure } from "@/api/errors";
import { SignIn } from "./index";

const mockReplace = jest.fn();
const mockSignIn = jest.fn();
const mockUnlockAccount = jest.fn();

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "ar" }] }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/legal-links", () => ({ LegalLinks: () => null }));
jest.mock("@/session/SessionProvider", () => ({
  useSession: () => ({ connection: { baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg" }, signIn: mockSignIn, unlockAccount: mockUnlockAccount }),
}));

const LOCKED_WITH_CODE = "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. أُرسل رمز فكّ القفل إلى بريد مديري النظام: أدخله هنا، أو اطلب من مدير النظام فكّ القفل من شاشة المستخدمين.";
const LOCKED = "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. اطلب من مدير النظام فكّ القفل من شاشة المستخدمين، أو سجّل الدخول من جهاز الخادم نفسه.";
const AUDIT = "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.";

const refusal = (failure: ApiFailure, status: number, message: string | null, code: string, detail: { retryAfterSeconds?: number; unlockByCode?: boolean } = {}) =>
  new ApiError(failure, status, message, null, code, detail);

async function submitPin(pin = "123456") {
  await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-pin"), pin));
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
}

const submitIsDisabled = () => screen.getByTestId("sign-in-submit").props.accessibilityState?.disabled === true;

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockReset();
  mockSignIn.mockReset();
  mockUnlockAccount.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the sign-in screen when the server refuses", () => {
  it("opens the app on a correct PIN", async () => {
    mockSignIn.mockResolvedValue(undefined);
    await render(<SignIn />);
    await submitPin();

    expect(mockSignIn).toHaveBeenCalledWith({ baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg", pin: "123456" });
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
  });

  it("says a wrong PIN is wrong, and nothing about a lock or a wait", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Unauthorized, 401, "اسم المستخدم أو رمز PIN غير صحيح.", "INVALID_CREDENTIALS"));
    await render(<SignIn />);
    await submitPin();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("اسم المستخدم أو رمز PIN غير صحيح.");
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
    expect(screen.getByText("دخول")).toBeTruthy();
  });

  it("says the account is locked and offers no code field when no code was mailed", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED, "ACCOUNT_LOCKED", { unlockByCode: false }));
    await render(<SignIn />);
    await submitPin();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe(LOCKED);
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
  });

  it("offers the mailed code a place, sends it for this account, and confirms the unlock in Arabic", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED_WITH_CODE, "ACCOUNT_LOCKED", { unlockByCode: true }));
    mockUnlockAccount.mockResolvedValue(undefined);
    await render(<SignIn />);
    await submitPin();
    expect(screen.getByTestId("sign-in-failure").props.children).toBe(LOCKED_WITH_CODE);

    expect(screen.getByTestId("sign-in-unlock-submit").props.accessibilityState?.disabled).toBe(true);
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-unlock-code"), " abcdefgh23456723 "));
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-unlock-submit")));

    expect(mockUnlockAccount).toHaveBeenCalledWith({ baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg", code: "abcdefgh23456723" });
    expect(screen.getByTestId("sign-in-notice").props.children).toBe("تم فكّ قفل الحساب. أدخل الرقم السري للدخول.");
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
  });

  it("shows the server's refusal of a wrong code and keeps the field", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED_WITH_CODE, "ACCOUNT_LOCKED", { unlockByCode: true }));
    mockUnlockAccount.mockRejectedValue(refusal(ApiFailure.Refused, 400, "رمز فكّ القفل غير صحيح أو انتهت صلاحيته.", "INVALID_UNLOCK_CODE"));
    await render(<SignIn />);
    await submitPin();
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-unlock-code"), "AAAAAAAAAAAAAAAA"));
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-unlock-submit")));

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("رمز فكّ القفل غير صحيح أو انتهت صلاحيته.");
    expect(screen.getByTestId("sign-in-unlock-code")).toBeTruthy();
  });

  it("holds the button for the seconds a 429 names, counts them down, and lets the person try again when they are over", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Throttled, 429, "محاولات دخول كثيرة. حاول بعد 3 ثانية.", "TOO_MANY_ATTEMPTS", { retryAfterSeconds: 3 }));
    await render(<SignIn />);
    await submitPin();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("محاولات دخول كثيرة. حاول بعد 3 ثانية.");
    expect(screen.getByText("الحساب مقفل — بعد 3 ث")).toBeTruthy();
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-pin"), "123456"));
    expect(submitIsDisabled()).toBe(true);
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(mockSignIn).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.getByText("الحساب مقفل — بعد 2 ث")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(2000));
    expect(screen.getByText("دخول")).toBeTruthy();
    expect(submitIsDisabled()).toBe(false);
  });

  it("says the server is busy, not that the account is locked, for a 503 that names a wait", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Unavailable, 503, "الخادم مشغول الآن بطلبات دخول أخرى، ولم تُحتسب هذه المحاولة. أعد المحاولة بعد ثوانٍ.", "SIGN_IN_BUSY", { retryAfterSeconds: 2 }));
    await render(<SignIn />);
    await submitPin();

    expect(screen.getByTestId("sign-in-failure").props.children).toContain("الخادم مشغول الآن");
    expect(screen.getByText("الخادم مشغول — أعد المحاولة بعد 2 ث")).toBeTruthy();
    expect(screen.queryByText(/الحساب مقفل/)).toBeNull();
  });

  it("says the audit log could not record the sign-in, holds nothing and offers no code", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Unavailable, 503, AUDIT, "AUDIT_UNAVAILABLE"));
    await render(<SignIn />);
    await submitPin();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe(AUDIT);
    expect(screen.getByText("دخول")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
  });

  it("says the server could not be reached when there is no network, in words of its own", async () => {
    mockSignIn.mockRejectedValue(new ApiError(ApiFailure.Network, null, null, null));
    await render(<SignIn />);
    await submitPin();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("تعذّر الوصول إلى الخادم. تحقّق من الاتصال ومن عنوان الخادم.");
  });
});

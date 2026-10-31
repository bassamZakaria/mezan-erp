/// <reference types="jest" />
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError, ApiFailure } from "@/api/errors";
import { SignIn } from "./index";

const mockReplace = jest.fn();
const mockSignIn = jest.fn();
const mockUnlockAccount = jest.fn();
const mockAcknowledge = jest.fn();
let mockSessionEnded: string | null = null;

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageCode: "ar" }] }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock("@/components/legal-links", () => ({ LegalLinks: () => null }));
jest.mock("@/session/SessionProvider", () => ({
  SessionEnded: { Displaced: "displaced", Expired: "expired", PasswordChangeRequired: "password-change-required" },
  useSession: () => ({ connection: { baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg" }, signIn: mockSignIn, unlockAccount: mockUnlockAccount, sessionEnded: mockSessionEnded, acknowledgeSessionEnded: mockAcknowledge }),
}));

const LOCKED_WITH_CODE = "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. أُرسل رمز فكّ القفل إلى بريد مديري النظام: أدخله هنا، أو اطلب من مدير النظام فكّ القفل من شاشة المستخدمين.";
const LOCKED = "تم قفل هذا الحساب بعد محاولات دخول فاشلة متكررة. اطلب من مدير النظام فكّ القفل من شاشة المستخدمين، أو سجّل الدخول من جهاز الخادم نفسه.";
const AUDIT = "تعذّر تسجيل العملية في سجل التدقيق، فلم يُحفظ أي تغيير. حاول مرة أخرى.";

const refusal = (failure: ApiFailure, status: number, message: string | null, code: string, detail: { retryAfterSeconds?: number; unlockByCode?: boolean } = {}) =>
  new ApiError(failure, status, message, null, code, detail);

async function submitPassword(password = "Cyag@2026") {
  await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-password"), password));
  await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
}

const submitIsDisabled = () => screen.getByTestId("sign-in-submit").props.accessibilityState?.disabled === true;

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockReset();
  mockSignIn.mockReset();
  mockUnlockAccount.mockReset();
  mockAcknowledge.mockReset();
  mockSessionEnded = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the sign-in screen after the server ended the session", () => {
  it("says another user signed in on this device when that is why the session ended", async () => {
    mockSessionEnded = "displaced";
    await render(<SignIn />);

    expect(screen.getByTestId("sign-in-session-ended").props.children).toBe("سجّل مستخدم آخر الدخول على هذا الجهاز، فانتهت جلستك هنا. سجّل الدخول من جديد للمتابعة.");
  });

  it("tells a person whose password is still temporary to change it on the website first", async () => {
    mockSessionEnded = "password-change-required";
    await render(<SignIn />);

    expect(screen.getByTestId("sign-in-session-ended").props.children).toBe("غيّر كلمة المرور المؤقتة من موقع ميزان أولاً، ثم سجّل الدخول من جديد.");
  });

  it("says the session ended when it simply expired", async () => {
    mockSessionEnded = "expired";
    await render(<SignIn />);

    expect(screen.getByTestId("sign-in-session-ended").props.children).toBe("انتهت الجلسة. سجّل الدخول من جديد.");
  });

  it("says nothing of the kind when the person signed out themself", async () => {
    await render(<SignIn />);

    expect(screen.queryByTestId("sign-in-session-ended")).toBeNull();
  });

  it("takes the notice down once the person signs in again", async () => {
    mockSessionEnded = "displaced";
    mockSignIn.mockResolvedValue(undefined);
    await render(<SignIn />);
    await submitPassword();

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
  });
});

describe("the sign-in screen when the server refuses", () => {
  it("opens the app on a correct password", async () => {
    mockSignIn.mockResolvedValue(undefined);
    await render(<SignIn />);
    await submitPassword();

    expect(mockSignIn).toHaveBeenCalledWith({ baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg", password: "Cyag@2026" });
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)");
  });

  it("says a wrong password is wrong, and nothing about a lock or a wait", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Unauthorized, 401, "البريد الإلكتروني أو كلمة المرور غير صحيحة.", "INVALID_CREDENTIALS"));
    await render(<SignIn />);
    await submitPassword();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("البريد الإلكتروني أو كلمة المرور غير صحيحة.");
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
    expect(screen.getByText("دخول")).toBeTruthy();
  });

  it("says the account is locked and offers no code field when no code was mailed", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED, "ACCOUNT_LOCKED", { unlockByCode: false }));
    await render(<SignIn />);
    await submitPassword();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe(LOCKED);
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
  });

  it("offers the mailed code a place, sends it for this account, and confirms the unlock in Arabic", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED_WITH_CODE, "ACCOUNT_LOCKED", { unlockByCode: true }));
    mockUnlockAccount.mockResolvedValue(undefined);
    await render(<SignIn />);
    await submitPassword();
    expect(screen.getByTestId("sign-in-failure").props.children).toBe(LOCKED_WITH_CODE);

    expect(screen.getByTestId("sign-in-unlock-submit").props.accessibilityState?.disabled).toBe(true);
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-unlock-code"), " abcdefgh23456723 "));
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-unlock-submit")));

    expect(mockUnlockAccount).toHaveBeenCalledWith({ baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg", code: "abcdefgh23456723" });
    expect(screen.getByTestId("sign-in-notice").props.children).toBe("تم فكّ قفل الحساب. أدخل كلمة المرور للدخول.");
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
  });

  it("shows the server's refusal of a wrong code and keeps the field", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED_WITH_CODE, "ACCOUNT_LOCKED", { unlockByCode: true }));
    mockUnlockAccount.mockRejectedValue(refusal(ApiFailure.Refused, 400, "رمز فكّ القفل غير صحيح أو انتهت صلاحيته.", "INVALID_UNLOCK_CODE"));
    await render(<SignIn />);
    await submitPassword();
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-unlock-code"), "AAAAAAAAAAAAAAAA"));
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-unlock-submit")));

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("رمز فكّ القفل غير صحيح أو انتهت صلاحيته.");
    expect(screen.getByTestId("sign-in-unlock-code")).toBeTruthy();
  });

  it("holds the unlock button too when the code was refused for too many attempts, for the seconds named", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Locked, 423, LOCKED_WITH_CODE, "ACCOUNT_LOCKED", { unlockByCode: true }));
    mockUnlockAccount.mockRejectedValue(refusal(ApiFailure.Throttled, 429, "محاولات دخول كثيرة. حاول بعد 2 ثانية.", "TOO_MANY_ATTEMPTS", { retryAfterSeconds: 2 }));
    await render(<SignIn />);
    await submitPassword();
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-unlock-code"), "AAAAAAAAAAAAAAAA"));
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-unlock-submit")));

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("محاولات دخول كثيرة.");
    expect(screen.getByTestId("sign-in-unlock-submit").props.accessibilityState?.disabled).toBe(true);
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-unlock-submit")));
    expect(mockUnlockAccount).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(2000));
    expect(screen.getByTestId("sign-in-unlock-submit").props.accessibilityState?.disabled).toBe(false);
  });

  it("holds the button for the seconds a 429 names, counts them down, and lets the person try again when they are over", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Throttled, 429, "محاولات دخول كثيرة. حاول بعد 3 ثانية.", "TOO_MANY_ATTEMPTS", { retryAfterSeconds: 3 }));
    await render(<SignIn />);
    await submitPassword();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("محاولات دخول كثيرة.");
    expect(screen.getByText("حاول بعد 3 ثوانٍ")).toBeTruthy();
    expect(screen.queryByText(/الحساب مقفل|\d ث$/)).toBeNull();
    await act(async () => fireEvent.changeText(screen.getByTestId("sign-in-password"), "Cyag@2026"));
    expect(submitIsDisabled()).toBe(true);
    await act(async () => fireEvent.press(screen.getByTestId("sign-in-submit")));
    expect(mockSignIn).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(1000));
    expect(screen.getByText("حاول بعد ثانيتين")).toBeTruthy();
    await act(async () => jest.advanceTimersByTime(2000));
    expect(screen.getByText("دخول")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-failure")).toBeNull();
    expect(submitIsDisabled()).toBe(false);
  });

  it("says the server is busy, not that the account is locked, for a 503 that names a wait", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Unavailable, 503, "الخادم مشغول الآن بطلبات دخول أخرى، ولم تُحتسب هذه المحاولة. أعد المحاولة بعد ثوانٍ.", "SIGN_IN_BUSY", { retryAfterSeconds: 2 }));
    await render(<SignIn />);
    await submitPassword();

    expect(screen.getByTestId("sign-in-failure").props.children).toContain("الخادم مشغول الآن");
    expect(screen.getByText("الخادم مشغول — أعد المحاولة بعد ثانيتين")).toBeTruthy();
    expect(screen.queryByText(/الحساب مقفل/)).toBeNull();
  });

  it("says the audit log could not record the sign-in, holds nothing and offers no code", async () => {
    mockSignIn.mockRejectedValue(refusal(ApiFailure.Unavailable, 503, AUDIT, "AUDIT_UNAVAILABLE"));
    await render(<SignIn />);
    await submitPassword();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe(AUDIT);
    expect(screen.getByText("دخول")).toBeTruthy();
    expect(screen.queryByTestId("sign-in-unlock-code")).toBeNull();
  });

  it("says the server could not be reached when there is no network, in words of its own", async () => {
    mockSignIn.mockRejectedValue(new ApiError(ApiFailure.Network, null, null, null));
    await render(<SignIn />);
    await submitPassword();

    expect(screen.getByTestId("sign-in-failure").props.children).toBe("تعذّر الوصول إلى الخادم. تحقّق من الاتصال ومن عنوان الخادم.");
  });
});

/// <reference types="jest" />
import { PasswordChangeRefusal } from "@mezan/contracts";
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ApiError, ApiFailure } from "@/api/errors";
import { SessionEnded, SessionProvider, useSession } from "./SessionProvider";

const mockApiRequest = jest.fn();
const mockClearSession = jest.fn(async () => undefined);

jest.mock("@/components/step-up-overlay", () => ({ StepUpOverlay: () => null }));
jest.mock("@/api/query-cache", () => ({ forgetCachedReads: async () => undefined }));
jest.mock("./device-lock", () => ({ deviceCanConfirmOwner: async () => false, confirmDeviceOwner: async () => true }));
jest.mock("./storage", () => ({
  loadSession: async () => ({ token: "t", deviceSecret: "d", userId: "u-1", permissions: ["*"], branchScope: "*", warehouseScope: "*" }),
  loadConnection: async () => ({ baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg" }),
  saveSession: async () => undefined,
  saveConnection: async () => undefined,
  clearSession: () => mockClearSession(),
}));
jest.mock("@/api/client", () => ({
  HttpMethod: { Get: "GET", Post: "POST" },
  ScopeAll: { Every: "*" },
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

let ask: () => Promise<unknown> = async () => undefined;
let signOutByHand: () => Promise<void> = async () => undefined;
let signInWith: (password: string) => Promise<boolean> = async () => false;

function Probe() {
  const { ready, session, sessionEnded, request, signOut, signIn } = useSession();
  signInWith = (password) => signIn({ baseUrl: "https://shop.example/api", tenantCode: "acme", email: "owner@shop.eg", password });
  ask = () => request("/customers").catch((error: unknown) => error);
  signOutByHand = signOut;
  return <Text testID="state">{`${ready ? "ready" : "loading"}|${session ? "signed-in" : "signed-out"}|${sessionEnded ?? "none"}`}</Text>;
}

async function mounted() {
  await render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await act(async () => undefined);
  expect(screen.getByTestId("state").props.children).toBe("ready|signed-in|none");
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockClearSession.mockClear();
});

describe("a session the server ended under the app", () => {
  it("is signed out saying another user signed in on this device, when the server says so", async () => {
    await mounted();
    mockApiRequest.mockRejectedValue(new ApiError(ApiFailure.Unauthorized, 401, "سجّل مستخدم آخر الدخول على هذا الجهاز.", null, "SESSION_DISPLACED"));

    await act(async () => void (await ask()));

    expect(screen.getByTestId("state").props.children).toBe(`ready|signed-out|${SessionEnded.Displaced}`);
    expect(mockClearSession).toHaveBeenCalledTimes(1);
  });

  it("is signed out saying the session ended, for any other 401", async () => {
    await mounted();
    mockApiRequest.mockRejectedValue(new ApiError(ApiFailure.Unauthorized, 401, "انتهت الجلسة.", null, "SESSION_EXPIRED"));

    await act(async () => void (await ask()));

    expect(screen.getByTestId("state").props.children).toBe(`ready|signed-out|${SessionEnded.Expired}`);
  });

  it("is signed out saying the temporary password must be changed on the website, on PASSWORD_CHANGE_REQUIRED", async () => {
    await mounted();
    mockApiRequest.mockRejectedValue(new ApiError(ApiFailure.Forbidden, 403, "غيّر كلمة المرور", null, PasswordChangeRefusal.Required));

    await act(async () => void (await ask()));

    expect(screen.getByTestId("state").props.children).toBe(`ready|signed-out|${SessionEnded.PasswordChangeRequired}`);
  });

  it("turns away a sign-in that still holds a temporary password, and ends that session on the server", async () => {
    await mounted();
    await act(async () => void (await signOutByHand()));
    mockApiRequest.mockImplementation(async (_credentials: unknown, path: string) =>
      path === "/auth/login" ? { token: "temporary-token-0123456789", deviceSecret: "temporary-device-secret", mustChangePassword: true, userId: "u-1", permissions: [], branchScope: "*", warehouseScope: "*" } : {},
    );

    let signedIn: boolean | undefined;
    await act(async () => void (signedIn = await signInWith("Temp@2026x")));

    expect(signedIn).toBe(false);
    expect(mockApiRequest.mock.calls.map((call) => call[1])).toEqual(["/auth/login", "/auth/logout"]);
    expect(mockApiRequest.mock.calls[1]?.[0]).toMatchObject({ token: "temporary-token-0123456789", deviceSecret: "temporary-device-secret" });
    expect(screen.getByTestId("state").props.children).toBe(`ready|signed-out|${SessionEnded.PasswordChangeRequired}`);
  });

  it("says nothing after a sign-out the person asked for, or a refusal that is not a 401", async () => {
    await mounted();
    mockApiRequest.mockRejectedValue(new ApiError(ApiFailure.Forbidden, 403, "ليست لديك صلاحية", null, "FORBIDDEN"));
    await act(async () => void (await ask()));
    expect(screen.getByTestId("state").props.children).toBe("ready|signed-in|none");

    await act(async () => signOutByHand());
    expect(screen.getByTestId("state").props.children).toBe("ready|signed-out|none");
  });
});

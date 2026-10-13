/// <reference types="jest" />
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

function Probe() {
  const { ready, session, sessionEnded, request, signOut } = useSession();
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

  it("says nothing after a sign-out the person asked for, or a refusal that is not a 401", async () => {
    await mounted();
    mockApiRequest.mockRejectedValue(new ApiError(ApiFailure.Forbidden, 403, "ليست لديك صلاحية", null, "FORBIDDEN"));
    await act(async () => void (await ask()));
    expect(screen.getByTestId("state").props.children).toBe("ready|signed-in|none");

    await act(async () => signOutByHand());
    expect(screen.getByTestId("state").props.children).toBe("ready|signed-out|none");
  });
});

/// <reference types="jest" />
import type { SessionDTO } from "@mezan/contracts";
import { clearSession, loadSession, saveSession } from "./storage";

const mockKeystore = new Map<string, string>();
const mockPlain = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "this-device-only",
  setItemAsync: async (key: string, value: string) => void mockKeystore.set(key, value),
  getItemAsync: async (key: string) => mockKeystore.get(key) ?? null,
  deleteItemAsync: async (key: string) => void mockKeystore.delete(key),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    setItem: async (key: string, value: string) => void mockPlain.set(key, value),
    getItem: async (key: string) => mockPlain.get(key) ?? null,
    removeItem: async (key: string) => void mockPlain.delete(key),
  },
}));

const SESSION: SessionDTO = {
  userId: "u-1", nameAr: "المالك", nameEn: null, email: "owner@shop.eg", isCompanyAdmin: true, permissions: ["*"], roleCode: null, mustChangePassword: false,
  photoUrl: null, branchScope: "*", warehouseScope: "*", tenantName: "المنشأة", token: "the-session-token", deviceSecret: "the-device-secret",
};

beforeEach(() => {
  mockKeystore.clear();
  mockPlain.clear();
});

describe("where the phone keeps a signed-in session", () => {
  it("keeps the token and the device secret in the keystore alone, and neither beside the profile", async () => {
    await saveSession(SESSION);

    expect([...mockKeystore.values()].sort()).toEqual(["the-device-secret", "the-session-token"]);
    const beside = [...mockPlain.values()].join("\n");
    expect(beside).toContain("owner@shop.eg");
    expect(beside).not.toContain("the-device-secret");
    expect(beside).not.toContain("the-session-token");
    expect(await loadSession()).toMatchObject({ token: "the-session-token", deviceSecret: "the-device-secret", userId: "u-1" });
  });

  it("drops a device secret left by an earlier session when the next one has none, and forgets everything on sign-out", async () => {
    await saveSession(SESSION);
    const { deviceSecret: _dropped, ...addressBound } = SESSION;
    await saveSession(addressBound);

    expect([...mockKeystore.values()]).toEqual(["the-session-token"]);
    expect((await loadSession())?.deviceSecret).toBeUndefined();

    await clearSession();
    expect(mockKeystore.size).toBe(0);
    expect(await loadSession()).toBeNull();
  });
});

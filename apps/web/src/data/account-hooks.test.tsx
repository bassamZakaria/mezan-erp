// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import type { Session } from "./session";
import type { Transport } from "./transport";
import {
  ApiError,
  useChangePassword,
  useProfile,
  useProfileActivity,
  useUpdateProfile,
} from "./account-hooks";

function makeWrapper(transport: Transport, session: Session | null = testAdminSession) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={session}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { Wrapper, queryClient };
}

describe("useProfile", () => {
  it("requests /profile and returns the profile", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /profile": (_init, path) => {
        seenPath = path;
        return { body: { id: "USER-ADMIN", nameAr: "محمد" } };
      },
    });
    const { result } = renderHook(() => useProfile(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/profile");
    expect(result.current.data).toEqual({ id: "USER-ADMIN", nameAr: "محمد" });
  });

  it("is disabled (no request) when there is no session", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /profile": () => {
        called = true;
        return { body: {} };
      },
    });
    renderHook(() => useProfile(), { wrapper: makeWrapper(transport, null).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
  });

  it("surfaces a failure as an ApiError with the response status", async () => {
    const transport = stubTransport({ "GET /profile": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useProfile(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.status).toBe(500);
  });
});

describe("useUpdateProfile", () => {
  it("sends the edited fields and invalidates ['profile'] on success", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PUT /profile": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { id: "USER-ADMIN", nameAr: "محمد الجديد" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: Wrapper });

    result.current.mutate({ nameAr: "محمد الجديد" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(seenBody).toEqual({ nameAr: "محمد الجديد" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["profile"] });
  });

  it("surfaces a validation refusal as an ApiError carrying the server's message", async () => {
    const transport = stubTransport({
      "PUT /profile": () => ({ status: 400, body: { message: "البريد الإلكتروني غير صالح" } }),
    });
    const { result } = renderHook(() => useUpdateProfile(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ email: "x" } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("البريد الإلكتروني غير صالح");
  });
});

describe("useChangePassword", () => {
  it("sends the password change body", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /profile/change-password": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: {} };
      },
    });
    const { result } = renderHook(() => useChangePassword(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ currentPassword: "old", newPassword: "newpass123" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ currentPassword: "old", newPassword: "newpass123" });
  });

  it("surfaces a wrong-current-password refusal", async () => {
    const transport = stubTransport({
      "POST /profile/change-password": () => ({ status: 400, body: { message: "كلمة المرور الحالية غير صحيحة" } }),
    });
    const { result } = renderHook(() => useChangePassword(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ currentPassword: "wrong", newPassword: "x" } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("كلمة المرور الحالية غير صحيحة");
  });
});

describe("useProfileActivity", () => {
  it("requests /profile/activity and returns the audit rows", async () => {
    const transport = stubTransport({
      "GET /profile/activity": () => ({ body: [{ id: "EV-1", action: "LOGIN" }] }),
    });
    const { result } = renderHook(() => useProfileActivity(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "EV-1", action: "LOGIN" }]);
  });

  it("returns an empty array cleanly when there is no activity yet", async () => {
    const transport = stubTransport({ "GET /profile/activity": () => ({ body: [] }) });
    const { result } = renderHook(() => useProfileActivity(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

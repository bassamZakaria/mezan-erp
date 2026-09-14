// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PlatformUserDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

const owner: PlatformUserDTO = {
  id: "PU-1",
  email: "root@mezan.example",
  role: "owner",
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const support: PlatformUserDTO = {
  id: "PU-2",
  email: "support@mezan.example",
  role: "support",
  status: "active",
  createdAt: "2026-01-02T00:00:00.000Z",
};

describe("OperatorsPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("lists operators with email, role and status", async () => {
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/users",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({ "GET /users": () => ({ body: [owner, support] }) }),
    });
    expect(await screen.findByText("root@mezan.example")).toBeInTheDocument();
    expect(screen.getByText("support@mezan.example")).toBeInTheDocument();
  });

  it("creates an operator via the form", async () => {
    let posted: unknown = null;
    const users = [owner];
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/users",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({
        "GET /users": () => ({ body: users }),
        "POST /users": (init) => {
          posted = JSON.parse(String(init?.body));
          users.push(support);
          return { status: 201, body: support };
        },
      }),
    });

    await screen.findByText("root@mezan.example");
    fireEvent.click(screen.getByRole("button", { name: "مشغّل جديد" }));
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "support@mezan.example" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور المؤقتة (12 حرفاً على الأقل)"), { target: { value: "temporary-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء" }));

    await waitFor(() =>
      expect(posted).toEqual({ email: "support@mezan.example", password: "temporary-pass-1", role: "support" }),
    );
    expect(await screen.findByText("support@mezan.example")).toBeInTheDocument();
  });

  it("deactivates an operator", async () => {
    const users = [support];
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/users",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({
        "GET /users": () => ({ body: users }),
        "POST /users/PU-2/deactivate": () => {
          const current = users[0];
          if (!current) throw new Error("missing user");
          users[0] = { ...current, status: "inactive" };
          return { body: users[0] };
        },
      }),
    });
    await screen.findByText("support@mezan.example");
    fireEvent.click(screen.getByRole("button", { name: "تعطيل" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "تعطيل" })).not.toBeInTheDocument());
  });

  it("support role sees no write buttons", async () => {
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/users",
      initialSession: supportSession,
      transport: stubPlatformTransport({ "GET /users": () => ({ body: [owner, support] }) }),
    });
    await screen.findByText("root@mezan.example");
    expect(screen.queryByRole("button", { name: "مشغّل جديد" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعطيل" })).not.toBeInTheDocument();
  });
});

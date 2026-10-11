import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, NotificationDispatcher, type Notification } from "@mezan/domain";
import { createSqliteNotificationStore } from "@mezan/persistence";
import { createBackend, type BackendHandle, type CreateBackendOptions } from "./create-backend.js";
import { SEED_ADMIN_USER_ID } from "./seed.js";
import { raced } from "./test/raced.js";

const handles: BackendHandle[] = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) {
    await handle.drain();
    handle.close();
  }
});

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const JSON_BODY = { "content-type": "application/json" };

async function open(options: Partial<CreateBackendOptions> = {}) {
  const handle = await createBackend({ dbPath: ":memory:", ...options });
  handles.push(handle);
  const send = async (method: string, path: string, body: unknown, headers: Record<string, string>): Promise<Answer> => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  };
  const bearer = (token: string) => ({ ...JSON_BODY, authorization: `Bearer ${token}` });
  const adminToken = handle.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const anonymous = (method: string, path: string, body?: unknown) => send(method, path, body, JSON_BODY);
  const admin = (method: string, path: string, body?: unknown) => send(method, path, body, bearer(adminToken));
  const as = (token: string) => (method: string, path: string, body?: unknown) => send(method, path, body, bearer(token));
  return { handle, anonymous, admin, as };
}

const statuses = (answers: readonly Answer[]) => answers.map((answer) => answer.status).sort();

interface ListedUser {
  readonly id: string;
  readonly email: string;
  readonly isCompanyAdmin: boolean;
  readonly status: string;
}

describe("a first-run claim sent by three callers at once", () => {
  it("makes one company admin and refuses the other two", async () => {
    const t = await open();
    const claim = (racer: number) =>
      t.anonymous("POST", "/bootstrap/admin", { nameAr: `مالك ${racer}`, nameEn: `Owner ${racer}`, email: `owner${racer}@example.eg`, pin: "246810" });

    await raced(claim, async (answers) => {
      expect(statuses(answers)).toEqual([201, 409, 409]);
      const users = (await t.admin("GET", "/users")).body as ListedUser[] | { items: ListedUser[] };
      const listed = Array.isArray(users) ? users : users.items;
      expect(listed.filter((user) => user.id !== SEED_ADMIN_USER_ID)).toHaveLength(1);
    });

    expect((await claim(9)).status).toBe(409);
  });
});

const clerk = (id: string, email: string) => ({
  id,
  nameAr: "أمين الخزنة",
  nameEn: "Cashier",
  email,
  phone: null,
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: "*",
  warehouseScope: "*",
  status: "active",
  password: "first-password",
  pin: "135790",
  acknowledge: true,
  reason: "مالك المنشأة يدير كل شيء بنفسه",
});

async function listedUsers(t: Awaited<ReturnType<typeof open>>): Promise<ListedUser[]> {
  const users = (await t.admin("GET", "/users")).body as ListedUser[] | { items: ListedUser[] };
  return Array.isArray(users) ? users : users.items;
}

async function signedInClerk() {
  const t = await open();
  const made = await t.admin("POST", "/users", clerk("clerk-1", "clerk@example.eg"));
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const signIn = (pin: string) => t.anonymous("POST", "/auth/login", { username: "clerk@example.eg", pin });
  const session = await signIn("135790");
  expect(session.status, JSON.stringify(session.body)).toBe(200);
  return { ...t, signIn, clerk: t.as((session.body as { token: string }).token) };
}

describe("a user created by three administrators at once", () => {
  it("creates the address once and refuses the other two", async () => {
    const t = await open();

    await raced(
      (racer) => t.admin("POST", "/users", clerk(`clerk-${racer}`, "shared@example.eg")),
      async (answers) => {
        expect(statuses(answers)).toEqual([201, 409, 409]);
        expect((await listedUsers(t)).filter((user) => user.email === "shared@example.eg")).toHaveLength(1);
      },
    );
  });
});

describe("a credential changed three times at once from the same current password", () => {
  it("accepts one new password and refuses the two that no longer know the current one", async () => {
    const t = await signedInClerk();
    const change = (racer: number) => t.clerk("POST", "/profile/change-password", { currentPassword: "first-password", newPassword: `next-password-${racer}` });

    const answers = await raced(change, (got) => expect(statuses(got)).toEqual([204, 401, 401]));

    const winner = answers.findIndex((answer) => answer.status === 204);
    const again = await t.clerk("POST", "/profile/change-password", { currentPassword: `next-password-${winner}`, newPassword: "settled-password" });
    expect(again.status, JSON.stringify(again.body)).toBe(204);
  });

  it("sets one new PIN when three are sent together, and that PIN signs in", async () => {
    const t = await signedInClerk();
    const pins = ["111111", "222222", "333333"];
    const change = (racer: number) => t.clerk("POST", "/profile/change-pin", { currentPassword: "first-password", newPin: pins[racer] });

    await raced(change, (got) => expect(statuses(got)).toEqual([204, 204, 204]));

    const signedIn = await Promise.all(pins.map((pin) => t.signIn(pin)));
    expect(signedIn.filter((answer) => answer.status === 200)).toHaveLength(1);
    expect((await t.signIn("135790")).status).toBe(401);
  });
});

describe("a user erased by three requests at once", () => {
  it("erases once, answers the other two as already erased, and records one erasure", async () => {
    const t = await open();
    const made = await t.admin("POST", "/users", { ...clerk("leaver-1", "leaver@example.eg"), isCompanyAdmin: false, roleId: "ROLE-ADMIN" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const leaver = (made.body as { id: string }).id;
    const erase = () => t.admin("POST", `/users/${leaver}/erase`, { confirmEmail: "leaver@example.eg", reason: "طلب محو البيانات" });

    await raced(erase, async (answers) => {
      expect(statuses(answers)).toEqual([200, 200, 200]);
      const fresh = answers.filter((answer) => (answer.body as { alreadyErased: boolean }).alreadyErased === false);
      expect(fresh).toHaveLength(1);
      const trail = (await t.admin("GET", "/audit?stream=security&action=PERSONAL_DATA_ERASED")).body;
      expect(JSON.stringify(trail).match(/PERSONAL_DATA_ERASED/g) ?? []).toHaveLength(1);
    });
  });
});

describe("the notification queue drained by three requests at once", () => {
  it("hands each message to the mail server once and records each as sent", async () => {
    const notifications = createSqliteNotificationStore(":memory:");
    const queued = (id: string): Notification => ({
      id,
      ruleId: null,
      recipientUserId: "user-1",
      eventCode: "SALES_INVOICE_CONFIRMED",
      title: "فاتورة جديدة",
      body: "تم تأكيد الفاتورة",
      priority: "normal",
      channels: ["in_app", "email"],
      channelStatus: { in_app: "delivered", email: "queued" },
      status: "unread",
      payload: {},
      createdAt: "2026-09-14T12:00:00.000Z",
      readAt: null,
    });
    for (const id of ["n1", "n2", "n3", "n4"]) await notifications.save(queued(id));
    const handed: string[] = [];
    const drain = () =>
      new NotificationDispatcher({
        notifications,
        recipientEmail: async () => "owner@example.eg",
        now: () => "2026-09-14T12:05:00.000Z",
        transports: [
          {
            channel: "email",
            async send(notification) {
              handed.push(notification.id);
              await new Promise<void>((resolve) => setImmediate(resolve));
              return { kind: "sent" };
            },
          },
        ],
      }).drain();

    await raced(drain, async (results) => {
      expect([...handed].sort()).toEqual(["n1", "n2", "n3", "n4"]);
      expect(results.reduce((total, result) => total + result.sent, 0)).toBe(4);
      const stored = await Promise.all(["n1", "n2", "n3", "n4"].map((id) => notifications.findById(id)));
      expect(stored.map((row) => row?.channelStatus)).toEqual(Array(4).fill({ in_app: "delivered", email: "sent" }));
    });
    notifications.close();
  });
});

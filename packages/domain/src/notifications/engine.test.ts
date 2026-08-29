import { describe, expect, it } from "vitest";
import { EventBus } from "../events/event-bus.js";
import type { Role, RoleRepository } from "../roles/role.js";
import type { User, UserRepository } from "../users/user.js";
import { NotificationRulesEngine } from "./engine.js";
import { saveNotificationRule } from "./save-rule.js";
import type {
  Notification,
  NotificationListFilter,
  NotificationRepository,
  NotificationRule,
  NotificationRuleListFilter,
  NotificationRuleRepository,
} from "./types.js";

class FakeNotificationRuleRepository implements NotificationRuleRepository {
  private readonly rows = new Map<string, NotificationRule>();
  async save(rule: NotificationRule): Promise<void> {
    this.rows.set(rule.id, rule);
  }
  async update(rule: NotificationRule): Promise<void> {
    this.rows.set(rule.id, rule);
  }
  async findById(id: string): Promise<NotificationRule | null> {
    return this.rows.get(id) ?? null;
  }
  async list(filter: NotificationRuleListFilter = {}): Promise<readonly NotificationRule[]> {
    return [...this.rows.values()].filter(
      (r) => (filter.active === undefined || r.active === filter.active) && (filter.eventCode === undefined || r.eventCode === filter.eventCode),
    );
  }
  async listActiveByEventCode(eventCode: string): Promise<readonly NotificationRule[]> {
    return [...this.rows.values()].filter((r) => r.active && r.eventCode === eventCode);
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}

class FakeNotificationRepository implements NotificationRepository {
  readonly rows: Notification[] = [];
  async save(notification: Notification): Promise<void> {
    this.rows.push(notification);
  }
  async findById(id: string): Promise<Notification | null> {
    return this.rows.find((n) => n.id === id) ?? null;
  }
  async listForUser(userId: string, filter: NotificationListFilter = {}): Promise<readonly Notification[]> {
    let rows = this.rows.filter((n) => n.recipientUserId === userId);
    if (filter.status) rows = rows.filter((n) => n.status === filter.status);
    if (filter.limit) rows = rows.slice(0, filter.limit);
    return rows;
  }
  async countUnread(userId: string): Promise<number> {
    return this.rows.filter((n) => n.recipientUserId === userId && n.status === "unread").length;
  }
  async markRead(id: string, userId: string, readAt: string): Promise<void> {
    const row = this.rows.find((n) => n.id === id && n.recipientUserId === userId);
    if (row) {
      (row as { status: string }).status = "read";
      (row as { readAt: string | null }).readAt = readAt;
    }
  }
  async markAllRead(userId: string, readAt: string): Promise<void> {
    for (const row of this.rows) {
      if (row.recipientUserId === userId) {
        (row as { status: string }).status = "read";
        (row as { readAt: string | null }).readAt = readAt;
      }
    }
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: overrides.id ?? "user-1",
    nameAr: "مستخدم تجريبي",
    nameEn: null,
    email: `${overrides.id ?? "user-1"}@test.local`,
    phone: null,
    passwordHash: "hash",
    pinHash: null,
    roleId: overrides.roleId ?? null,
    isCompanyAdmin: overrides.isCompanyAdmin ?? false,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: overrides.status ?? "active",
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: overrides.id ?? "role-sales",
    code: "SALES",
    name: "مندوب مبيعات",
    description: "",
    permissions: overrides.permissions ?? [],
    isSystem: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

class FakeUserRepository implements UserRepository {
  constructor(private readonly users: User[]) {}
  async save(): Promise<void> {}
  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async findByEmail(): Promise<User | null> {
    return null;
  }
  async list(): Promise<readonly User[]> {
    return this.users;
  }
}

class FakeRoleRepository implements RoleRepository {
  constructor(private readonly roles: Role[]) {}
  async save(): Promise<void> {}
  async findById(id: string): Promise<Role | null> {
    return this.roles.find((r) => r.id === id) ?? null;
  }
  async findByCode(): Promise<Role | null> {
    return null;
  }
  async list(): Promise<readonly Role[]> {
    return this.roles;
  }
  async delete(): Promise<void> {}
}

let idCounter = 0;

describe("NotificationRulesEngine", () => {
  it("notifies every active user holding the target permission (recipientType: permission)", async () => {
    const salesRole = makeRole({ id: "role-sales", permissions: ["sales.invoice.view"] });
    const hrRole = makeRole({ id: "role-hr", code: "HR", permissions: ["hr.employee.view"] });
    const users = [
      makeUser({ id: "u-sales", roleId: "role-sales" }),
      makeUser({ id: "u-hr", roleId: "role-hr" }),
      makeUser({ id: "u-admin", isCompanyAdmin: true, roleId: null }),
      makeUser({ id: "u-inactive", roleId: "role-sales", status: "inactive" }),
    ];

    const rules = new FakeNotificationRuleRepository();
    await saveNotificationRule(
      {
        id: "rule-1",
        name: "فاتورة مبيعات مؤكدة",
        eventCode: "SALES_INVOICE_CONFIRMED",
        condition: null,
        recipientType: "permission",
        recipientValue: "sales.invoice.view",
        priority: "normal",
        channels: ["in_app"],
        titleAr: null,
        bodyAr: null,
        active: true,
      },
      rules,
    );

    const notifications = new FakeNotificationRepository();
    const engine = new NotificationRulesEngine({
      rules,
      notifications,
      users: new FakeUserRepository(users),
      roles: new FakeRoleRepository([salesRole, hrRole]),
      generateId: () => `n-${++idCounter}`,
      now: () => "2026-08-23T10:00:00.000Z",
    });

    await engine.handle({
      code: "SALES_INVOICE_CONFIRMED",
      occurredAt: "2026-08-23T10:00:00.000Z",
      payload: { documentNumber: "INV-000123", customerName: "شركة الأمل للتجارة", amount: "1150.00" },
    });

    const recipients = notifications.rows.map((n) => n.recipientUserId).sort();
    expect(recipients).toEqual(["u-admin", "u-sales"]); // company admin bypasses the permission system; hr/inactive don't hold it
    expect(notifications.rows[0]?.title).toBe("تم تأكيد فاتورة مبيعات");
    expect(notifications.rows[0]?.body).toContain("INV-000123");
    expect(notifications.rows[0]?.channelStatus).toEqual({ in_app: "delivered" });
    expect(notifications.rows[0]?.status).toBe("unread");
  });

  it("wires directly to a real EventBus via subscribeAll", async () => {
    const rules = new FakeNotificationRuleRepository();
    await saveNotificationRule(
      {
        id: "rule-low-stock",
        name: "نقص مخزون",
        eventCode: "LOW_STOCK_DETECTED",
        condition: null,
        recipientType: "user",
        recipientValue: "u-1",
        priority: "high",
        channels: ["in_app", "email"],
        titleAr: null,
        bodyAr: null,
        active: true,
      },
      rules,
    );
    const notifications = new FakeNotificationRepository();
    const engine = new NotificationRulesEngine({
      rules,
      notifications,
      users: new FakeUserRepository([makeUser({ id: "u-1" })]),
      roles: new FakeRoleRepository([]),
      generateId: () => `n-${++idCounter}`,
    });

    const bus = new EventBus();
    bus.subscribeAll((event) => {
      void engine.handle(event);
    });
    bus.publish("LOW_STOCK_DETECTED", { itemName: "برغي 5مم" });

    // handle() is async; the fire-and-forget subscribeAll call above needs a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0]?.recipientUserId).toBe("u-1");
    expect(notifications.rows[0]?.channelStatus).toEqual({ in_app: "delivered", email: "queued" });
  });

  it("skips a rule whose condition does not match, and applies a custom Arabic template when it does", async () => {
    const rules = new FakeNotificationRuleRepository();
    await saveNotificationRule(
      {
        id: "rule-big-invoice",
        name: "فاتورة كبيرة",
        eventCode: "SALES_INVOICE_CONFIRMED",
        condition: { field: "amount", operator: "gt", value: "1000" },
        recipientType: "user",
        recipientValue: "u-1",
        priority: "urgent",
        channels: ["in_app"],
        titleAr: "فاتورة كبيرة: {{documentNumber}}",
        bodyAr: "بقيمة {{amount}} للعميل {{customerName}}",
        active: true,
      },
      rules,
    );
    const notifications = new FakeNotificationRepository();
    const engine = new NotificationRulesEngine({
      rules,
      notifications,
      users: new FakeUserRepository([makeUser({ id: "u-1" })]),
      roles: new FakeRoleRepository([]),
      generateId: () => `n-${++idCounter}`,
    });

    await engine.handle({
      code: "SALES_INVOICE_CONFIRMED",
      occurredAt: "2026-08-23T10:00:00.000Z",
      payload: { documentNumber: "INV-000001", customerName: "عميل صغير", amount: "50.00" },
    });
    expect(notifications.rows).toHaveLength(0);

    await engine.handle({
      code: "SALES_INVOICE_CONFIRMED",
      occurredAt: "2026-08-23T10:05:00.000Z",
      payload: { documentNumber: "INV-000002", customerName: "عميل كبير", amount: "5000.00" },
    });
    expect(notifications.rows).toHaveLength(1);
    expect(notifications.rows[0]?.title).toBe("فاتورة كبيرة: INV-000002");
    expect(notifications.rows[0]?.body).toBe("بقيمة 5000.00 للعميل عميل كبير");
  });

  it("ignores an inactive rule and a rule for a different event code", async () => {
    const rules = new FakeNotificationRuleRepository();
    await saveNotificationRule(
      {
        id: "rule-inactive",
        name: "غير مفعّلة",
        eventCode: "SALES_INVOICE_CONFIRMED",
        condition: null,
        recipientType: "user",
        recipientValue: "u-1",
        priority: "normal",
        channels: ["in_app"],
        titleAr: null,
        bodyAr: null,
        active: false,
      },
      rules,
    );
    const notifications = new FakeNotificationRepository();
    const engine = new NotificationRulesEngine({
      rules,
      notifications,
      users: new FakeUserRepository([makeUser({ id: "u-1" })]),
      roles: new FakeRoleRepository([]),
      generateId: () => `n-${++idCounter}`,
    });

    await engine.handle({ code: "SALES_INVOICE_CONFIRMED", occurredAt: "now", payload: {} });
    await engine.handle({ code: "PURCHASE_ORDER_CONFIRMED", occurredAt: "now", payload: {} });
    expect(notifications.rows).toHaveLength(0);
  });
});

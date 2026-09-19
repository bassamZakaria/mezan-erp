import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import {
  assertPosPaymentMethodDeletable,
  createPosPaymentMethod,
  updatePosPaymentMethod,
  type PosPaymentMethod,
  type PosPaymentMethodRepository,
  type PosTerminalRepository,
  type TreasuryAccountRepository,
} from "@mezan/domain";
import { createPosPaymentMethodSchema, updatePosPaymentMethodSchema, type PosPaymentMethodDTO } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "../permission-gate.js";
import { posDomainError, readJson, validationError } from "./http.js";

export interface PosPaymentMethodsRoutesDeps {
  readonly paymentMethods: PosPaymentMethodRepository;
  readonly terminals: PosTerminalRepository;
  readonly treasuryAccounts: TreasuryAccountRepository;
}

/** طرق الدفع في نقاط البيع — `/pos/payment-methods`. CASH and CARD are built in and never deleted. */
export function createPosPaymentMethodsRoutes(deps: PosPaymentMethodsRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function usage(activeOnly = false): Promise<Map<string, string[]>> {
    const byMethod = new Map<string, string[]>();
    for (const terminal of await deps.terminals.list()) {
      if (activeOnly && !terminal.active) continue;
      for (const entry of terminal.methods) byMethod.set(entry.methodId, [...(byMethod.get(entry.methodId) ?? []), terminal.code]);
    }
    return byMethod;
  }

  async function serialize(methods: readonly PosPaymentMethod[]): Promise<PosPaymentMethodDTO[]> {
    const used = await usage();
    return methods.map((m) => ({ ...m, usedBy: used.get(m.id) ?? [] }));
  }

  async function defaultAccountProblem(method: PosPaymentMethod): Promise<string | null> {
    if (method.defaultTreasuryAccountId === null) return null;
    const account = await deps.treasuryAccounts.findById(method.defaultTreasuryAccountId);
    if (!account) return "الحساب الافتراضي غير موجود";
    if (account.status !== "active") return "الحساب الافتراضي غير نشط";
    if (method.accountType !== null && account.type !== method.accountType) {
      return `الحساب الافتراضي يجب أن يكون ${method.accountType === "bank" ? "بنكياً" : "نقدياً"}`;
    }
    return null;
  }

  app.get("/", gate("pos.terminal.view"), async (c) => {
    const status = c.req.query("status");
    let rows = await deps.paymentMethods.list();
    if (status === "active") rows = rows.filter((m) => m.active);
    return c.json(await serialize(rows));
  });

  app.post("/", gate("pos.settings.edit"), async (c) => {
    const parsed = createPosPaymentMethodSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      const method = createPosPaymentMethod({ id: `PM-${randomUUID()}`, ...parsed.data });
      if (await deps.paymentMethods.findByCode(method.code)) {
        return c.json({ error: "DUPLICATE_POS_PAYMENT_METHOD_CODE", message: `الكود «${method.code}» مستخدم لطريقة أخرى` }, 409);
      }
      const problem = await defaultAccountProblem(method);
      if (problem) return c.json({ error: "INVALID_POS_PAYMENT_METHOD", message: problem }, 422);
      await deps.paymentMethods.save(method);
      const [dto] = await serialize([method]);
      return c.json(dto, 201);
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  app.put("/:id", gate("pos.settings.edit"), async (c) => {
    const current = await deps.paymentMethods.findById(c.req.param("id"));
    if (!current) return c.json({ error: "NOT_FOUND", message: "طريقة الدفع غير موجودة" }, 404);
    const parsed = updatePosPaymentMethodSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    try {
      const next = updatePosPaymentMethod(current, parsed.data);
      const problem = await defaultAccountProblem(next);
      if (problem) return c.json({ error: "INVALID_POS_PAYMENT_METHOD", message: problem }, 422);
      if (current.active && !next.active) {
        const usedBy = (await usage(true)).get(current.id) ?? [];
        if (usedBy.length > 0) {
          return c.json(
            {
              error: "POS_PAYMENT_METHOD_IN_USE",
              message: `الطريقة مفعّلة على الأجهزة ${usedBy.join("، ")} — أزلها من إعدادات تلك الأجهزة أولاً`,
            },
            409,
          );
        }
      }
      await deps.paymentMethods.save(next);
      const [dto] = await serialize([next]);
      return c.json(dto);
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  app.delete("/:id", gate("pos.settings.edit"), async (c) => {
    const current = await deps.paymentMethods.findById(c.req.param("id"));
    if (!current) return c.json({ error: "NOT_FOUND", message: "طريقة الدفع غير موجودة" }, 404);
    try {
      assertPosPaymentMethodDeletable(current, (await usage()).get(current.id) ?? []);
      await deps.paymentMethods.delete(current.id);
      return c.body(null, 204);
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  return app;
}

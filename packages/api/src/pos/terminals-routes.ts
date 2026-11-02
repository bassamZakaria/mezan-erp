import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  assertPosTerminalReferences,
  buildPosTerminal,
  effectiveEtaDevice,
  posTerminalIssues,
  recordSensitiveEvent,
  type AuditSink,
  type BranchEtaDevice,
  type BranchRepository,
  type PosPaymentMethod,
  type PosPaymentMethodRepository,
  type PosTerminal,
  type PosTerminalReferenceAccount,
  type PosTerminalRepository,
  type TreasuryAccountRepository,
  type WarehouseRepository,
} from "@mezan/domain";
import { createPosTerminalSchema, updatePosTerminalSchema, type PosTerminalDTO } from "@mezan/contracts";
import {
  branchScopeOf,
  createPermissionGate,
  getAuthContext,
  withinScope,
  type AuthContextResolver,
} from "../permission-gate.js";
import { atomically, type ConfigTransactor } from "../config-transactor.js";
import { posDomainError, readJson, validationError } from "./http.js";

export interface PosTerminalsRoutesDeps {
  readonly terminals: PosTerminalRepository;
  readonly paymentMethods: PosPaymentMethodRepository;
  readonly branches: BranchRepository;
  readonly warehouses: WarehouseRepository;
  readonly treasuryAccounts: TreasuryAccountRepository;
  /** The branch's registered device (the ETA branch mapping), the fallback DEC-25 keeps. */
  readonly branchEtaDevices: () => Promise<ReadonlyMap<string, BranchEtaDevice>>;
  readonly audit?: AuditSink;
  /**
   * The boundary the audit row shares with the write it records — see
   * {@link ConfigTransactor}. The terminal row, its ETA device secrets and
   * the audit row are one change: a secret stored without the row that says
   * whose till now talks to the tax authority is exactly what this covers.
   */
  readonly transactor?: ConfigTransactor;
}

/**
 * الأجهزة — `/pos/terminals`. A terminal binds a till to a branch, a warehouse,
 * its own cash drawer, the tenders it accepts and the device the tax authority
 * knows it by. Every reference is checked against the real record.
 */
export function createPosTerminalsRoutes(deps: PosTerminalsRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  async function serialize(terminals: readonly PosTerminal[]): Promise<PosTerminalDTO[]> {
    const [devices, accounts, methods] = await Promise.all([
      deps.branchEtaDevices(),
      deps.treasuryAccounts.list(),
      deps.paymentMethods.list(),
    ]);
    const refs = {
      accounts: new Map<string, PosTerminalReferenceAccount>(
        accounts.map((a) => [a.id, { id: a.id, type: a.type, branchId: a.branchId, status: a.status }]),
      ),
      methods: new Map<string, PosPaymentMethod>(methods.map((m) => [m.id, m])),
    };
    return terminals.map((t) => {
      const branch = devices.get(t.branchId) ?? null;
      return { ...t, methods: [...t.methods], etaDevice: effectiveEtaDevice(t, branch), issues: posTerminalIssues(t, branch, refs) };
    });
  }

  async function findByIdOrCode(key: string): Promise<PosTerminal | null> {
    return (await deps.terminals.findById(key)) ?? (await deps.terminals.findByCode(key.toUpperCase()));
  }

  async function checkReferences(terminal: PosTerminal): Promise<void> {
    const [branch, warehouse, accounts, methods, terminals] = await Promise.all([
      deps.branches.findById(terminal.branchId),
      deps.warehouses.findById(terminal.warehouseId),
      deps.treasuryAccounts.list(),
      deps.paymentMethods.list(),
      deps.terminals.list(),
    ]);
    const others = terminals.filter((t) => t.id !== terminal.id);
    assertPosTerminalReferences(terminal, {
      branchExists: branch !== null,
      warehouse: warehouse ? { branchId: warehouse.branchId, active: warehouse.active } : null,
      accounts: new Map<string, PosTerminalReferenceAccount>(
        accounts.map((a) => [a.id, { id: a.id, type: a.type, branchId: a.branchId, status: a.status }]),
      ),
      methods: new Map<string, PosPaymentMethod>(methods.map((m) => [m.id, m])),
      drawerSharedWith: others.filter((t) => t.active && t.drawerTreasuryAccountId === terminal.drawerTreasuryAccountId).map((t) => t.code),
      serialTakenBy:
        terminal.etaDeviceSerial === null ? null : (others.find((t) => t.etaDeviceSerial === terminal.etaDeviceSerial)?.code ?? null),
    });
  }

  async function record(c: Context, terminal: PosTerminal, action: "CREATE" | "UPDATE", secretChanged: boolean, before?: PosTerminal) {
    if (!deps.audit) return;
    await recordSensitiveEvent(deps.audit, {
      module: "pos",
      entityType: "POS_TERMINAL",
      entityId: terminal.id,
      action,
      actor: getAuthContext(c)?.userId ?? "system",
      branchId: terminal.branchId,
      severity: secretChanged || (before && before.etaDeviceSerial !== terminal.etaDeviceSerial) ? "WARNING" : "INFO",
      details: {
        code: terminal.code,
        active: terminal.active,
        drawerTreasuryAccountId: terminal.drawerTreasuryAccountId,
        etaDeviceSerial: terminal.etaDeviceSerial,
        etaDeviceSecretsChanged: secretChanged,
        ...(before
          ? {
              previousDrawerTreasuryAccountId: before.drawerTreasuryAccountId,
              previousEtaDeviceSerial: before.etaDeviceSerial,
              previousActive: before.active,
            }
          : {}),
      },
    });
  }

  app.get("/", gate("pos.terminal.view"), async (c) => {
    const status = c.req.query("status");
    const branchId = c.req.query("branchId");
    let rows = withinScope(await deps.terminals.list(), branchScopeOf(c), (t) => t.branchId);
    if (status === "active") rows = rows.filter((t) => t.active);
    if (status === "inactive") rows = rows.filter((t) => !t.active);
    if (branchId) rows = rows.filter((t) => t.branchId === branchId);
    return c.json(await serialize(rows));
  });

  app.get("/:id", gate("pos.terminal.view"), async (c) => {
    const terminal = await findByIdOrCode(c.req.param("id"));
    if (!terminal || withinScope([terminal], branchScopeOf(c), (t) => t.branchId).length === 0) {
      return c.json({ error: "NOT_FOUND", message: "الجهاز غير موجود", messageEn: "The terminal does not exist" }, 404);
    }
    const [dto] = await serialize([terminal]);
    return c.json(dto);
  });

  app.post("/", gate("pos.terminal.manage"), async (c) => {
    const parsed = createPosTerminalSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    const { etaPosClientSecret, etaPosPresharedKey, ...input } = parsed.data;
    try {
      const terminal = buildPosTerminal(randomUUID(), input);
      if (secretWithoutDevice(terminal, etaPosClientSecret, etaPosPresharedKey)) return refuseSecretWithoutDevice(c);
      if (!branchInScope(c, terminal.branchId)) return refuseBranch(c);
      if (await deps.terminals.findByCode(terminal.code)) {
        return c.json({ error: "DUPLICATE_POS_TERMINAL_CODE", message: `كود الجهاز «${terminal.code}» مستخدم بالفعل`, messageEn: `Terminal code "${terminal.code}" is already in use` }, 409);
      }
      await checkReferences(terminal);
      await atomically(deps.transactor, async () => {
        await deps.terminals.save(terminal);
        const secretChanged = await storeSecrets(terminal, etaPosClientSecret, etaPosPresharedKey);
        await record(c, terminal, "CREATE", secretChanged);
      });
      const saved = (await deps.terminals.findById(terminal.id)) ?? terminal;
      const [dto] = await serialize([saved]);
      return c.json(dto, 201);
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  app.put("/:id", gate("pos.terminal.manage"), async (c) => {
    const current = await findByIdOrCode(c.req.param("id"));
    if (!current || withinScope([current], branchScopeOf(c), (t) => t.branchId).length === 0) {
      return c.json({ error: "NOT_FOUND", message: "الجهاز غير موجود", messageEn: "The terminal does not exist" }, 404);
    }
    const parsed = updatePosTerminalSchema.safeParse(await readJson(c));
    if (!parsed.success) return validationError(c, parsed.error);
    const { etaPosClientSecret, etaPosPresharedKey, ...input } = parsed.data;
    try {
      const next = buildPosTerminal(current.id, input, current);
      if (secretWithoutDevice(next, etaPosClientSecret, etaPosPresharedKey)) return refuseSecretWithoutDevice(c);
      if (!branchInScope(c, next.branchId)) return refuseBranch(c);
      if (next.code !== current.code && (await deps.terminals.findByCode(next.code))) {
        return c.json({ error: "DUPLICATE_POS_TERMINAL_CODE", message: `كود الجهاز «${next.code}» مستخدم بالفعل`, messageEn: `Terminal code "${next.code}" is already in use` }, 409);
      }
      await checkReferences(next);
      await atomically(deps.transactor, async () => {
        await deps.terminals.save(next);
        const secretChanged = await storeSecrets(next, etaPosClientSecret, etaPosPresharedKey);
        await record(c, next, "UPDATE", secretChanged, current);
      });
      const saved = (await deps.terminals.findById(next.id)) ?? next;
      const [dto] = await serialize([saved]);
      return c.json(dto);
    } catch (err) {
      return posDomainError(c, err);
    }
  });

  function branchInScope(c: Context, branchId: string): boolean {
    const scope = branchScopeOf(c);
    return !scope || scope.includes(branchId);
  }

  function refuseBranch(c: Context): Response {
    return c.json({ error: "BRANCH_OUT_OF_SCOPE", message: "لا يمكنك إضافة جهاز في فرع خارج نطاق صلاحياتك", messageEn: "You cannot add a terminal in a branch outside your permissions" }, 403);
  }

  function secretWithoutDevice(terminal: PosTerminal, ...secrets: (string | undefined)[]): boolean {
    return terminal.etaDeviceSerial === null && secrets.some((v) => (v?.trim() ?? "") !== "");
  }

  function refuseSecretWithoutDevice(c: Context): Response {
    return c.json(
      { error: "INVALID_POS_TERMINAL", message: "أسرار جهاز الفاتورة الإلكترونية لا تُحفظ إلا مع الرقم التسلسلي للجهاز", messageEn: "E-invoice terminal secrets can only be saved together with the terminal serial number" },
      422,
    );
  }

  async function storeSecrets(terminal: PosTerminal, secret: string | undefined, presharedKey: string | undefined): Promise<boolean> {
    if (terminal.etaDeviceSerial === null) return false;
    let changed = false;
    if ((secret?.trim() ?? "") !== "") {
      await deps.terminals.setEtaPosClientSecret(terminal.id, (secret as string).trim());
      changed = true;
    }
    if ((presharedKey?.trim() ?? "") !== "") {
      await deps.terminals.setEtaPosPresharedKey(terminal.id, (presharedKey as string).trim());
      changed = true;
    }
    return changed;
  }


  return app;
}

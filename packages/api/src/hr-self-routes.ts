import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  ATTACHMENT_MAX_BYTES,
  ClockPunchRefusedError,
  ClockRefusalCode,
  DEFAULT_PRINT_TEMPLATE_CONFIG,
  InvalidAttendanceEntryError,
  InvalidEmployeeAdvanceError,
  InvalidLeaveRequestError,
  InvalidLeaveRequestTransitionError,
  Money,
  PendingAdvanceExistsError,
  Qty,
  SELFIE_MIME_TYPES,
  assertMayClock,
  cancelLeaveRequest,
  correctAttendance,
  createAttachment,
  createLeaveRequest,
  isOnApprovedLeave,
  planClockPunch,
  recordAttendance,
  releaseLeaveBalance,
  requestEmployeeAdvance,
  selfieBytesMatchMime,
  unverifiedStatutoryTableCodes,
  type AttachmentRepository,
  type AttendanceEntry,
  type AttendanceRepository,
  type AuditSink,
  type ClockCredentialRepository,
  type DepartmentRepository,
  type Employee,
  type EmployeeAdvanceRepository,
  type EmployeeRepository,
  type HolidayRepository,
  type JobTitleRepository,
  type LeaveBalanceRepository,
  type LeaveRequest,
  type LeaveRequestRepository,
  type PayrollRun,
  type PayrollRunRepository,
  type PayslipRepository,
  type PrintTemplateConfigRepository,
  type SettingsRepository,
  type StatutoryOverrideRepository,
  type User,
  type UserRepository,
  type WebauthnChallengeRepository,
} from "@mezan/domain";
import {
  ClockChallengePurposeDTO,
  SelfClockActionDTO,
  clockChallengeRequestSchema,
  clockCredentialRegistrationSchema,
  selfClockPunchSchema,
  selfCreateAdvanceSchema,
  selfCreateLeaveRequestSchema,
  type SelfClockPunchDTO,
  type SelfEmployeeDTO,
} from "@mezan/contracts";
import { createAnyPermissionGate, createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import { serializeAttendance } from "./hr-time-leave-routes.js";
import { serializeAdvance, serializePayslip } from "./hr-payroll-routes.js";
import { tenantClock } from "./tenant-day.js";
import { atomically, type ConfigTransactor } from "./config-transactor.js";
import {
  InMemoryChallengeStore,
  CHALLENGE_TTL_MS,
  WEBAUTHN_ALGORITHMS,
  assertionSignatureValid,
  authenticatorDataAcceptable,
  clientDataMatches,
  fromBase64Url,
  importPublicKey,
  readAuthenticatorData,
  relyingPartyOf,
  toBase64Url,
} from "./hr-self-webauthn.js";

export interface HrSelfRoutesDeps {
  readonly users: Pick<UserRepository, "findById">;
  readonly employees: Pick<EmployeeRepository, "findById">;
  readonly departments: Pick<DepartmentRepository, "findById">;
  readonly jobTitles: Pick<JobTitleRepository, "findById">;
  readonly holidays: Pick<HolidayRepository, "list">;
  readonly leaveRequests: LeaveRequestRepository;
  readonly numbering: { next(code: string): Promise<{ readonly formatted: string }> };
  /** The transaction a create shares with the number it mints, so a refused create — a taken id included — spends no number. */
  readonly transactor?: ConfigTransactor;
  readonly attendance?: AttendanceRepository;
  readonly leaveBalances?: Pick<LeaveBalanceRepository, "find" | "update">;
  readonly advances?: EmployeeAdvanceRepository;
  readonly runs?: Pick<PayrollRunRepository, "findById" | "list">;
  readonly payslips?: Pick<PayslipRepository, "findById" | "listByEmployeeId">;
  readonly attachments?: AttachmentRepository;
  readonly clockCredentials?: ClockCredentialRepository;
  /** DB-backed by default (`create-backend.ts`); a caller with no persistence at hand may omit it, falling back to an in-process store. */
  readonly challenges?: WebauthnChallengeRepository;
  readonly printTemplates?: Pick<PrintTemplateConfigRepository, "get">;
  readonly tenantSettings?: Pick<SettingsRepository, "get">;
  readonly statutoryOverrides?: Pick<StatutoryOverrideRepository, "list">;
  readonly audit?: AuditSink;
}

const SELF_PERMISSIONS = ["hr.self.leave", "hr.self.payslip", "hr.self.advance", "hr.self.attendance", "hr.self.clock"] as const;

/** Only a posted run's payslip is the employee's: a draft or محتسب figure can still change. */
const RELEASED_RUN_STATUSES: readonly PayrollRun["status"][] = ["approved", "disbursed"];

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function refusal(c: Context, err: ClockPunchRefusedError): Response {
  return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, err.status);
}

function notLinked(c: Context): Response {
  return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.NotLinked));
}

function domainRefusal(c: Context, err: { readonly code: string; readonly message: string; readonly messageEn?: string }, status: 409 | 422): Response {
  return c.json({ error: err.code, message: err.message, ...(err.messageEn ? { messageEn: err.messageEn } : {}) }, status);
}

function bilingual(c: Context, status: 400 | 404 | 409 | 422, error: string, message: string, messageEn: string): Response {
  return c.json({ error, message, messageEn }, status);
}

function lastDayOf(month: string): string {
  const [year, monthPart] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year ?? 1970, monthPart ?? 1, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function createHrSelfRoutes(deps: HrSelfRoutesDeps, resolveAuthContext: AuthContextResolver): Hono {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);
  const gateAny = createAnyPermissionGate(resolveAuthContext);
  const challenges: WebauthnChallengeRepository = deps.challenges ?? new InMemoryChallengeStore();

  async function caller(c: Context): Promise<{ user: User; employee: Employee } | null> {
    const ctx = getAuthContext(c);
    if (!ctx) return null;
    const user = await deps.users.findById(ctx.userId);
    if (!user?.employeeId) return null;
    const employee = await deps.employees.findById(user.employeeId);
    return employee ? { user: user as User, employee } : null;
  }

  async function selfEmployee(employee: Employee): Promise<SelfEmployeeDTO> {
    const [department, jobTitle] = await Promise.all([
      employee.departmentId ? deps.departments.findById(employee.departmentId) : Promise.resolve(null),
      employee.jobTitleId ? deps.jobTitles.findById(employee.jobTitleId) : Promise.resolve(null),
    ]);
    return {
      id: employee.id,
      code: employee.code,
      firstName: employee.firstName,
      lastName: employee.lastName,
      firstNameAr: employee.firstNameAr,
      lastNameAr: employee.lastNameAr,
      departmentName: department?.name ?? null,
      departmentNameAr: department?.nameAr ?? null,
      jobTitleName: jobTitle?.name ?? null,
      jobTitleNameAr: jobTitle?.nameAr ?? null,
      branchId: employee.branchId,
      hireDate: employee.hireDate,
      status: employee.status,
      requireSelfieAtClockIn: employee.requireSelfieAtClockIn,
      requireBiometricAtClockIn: employee.requireBiometricAtClockIn,
    };
  }

  app.get("/self/profile", gateAny(...SELF_PERMISSIONS), async (c) => {
    const me = await caller(c);
    if (!me) return c.json({ employeeId: null, employee: null });
    return c.json({ employeeId: me.employee.id, employee: await selfEmployee(me.employee) });
  });

  // --- My leave -------------------------------------------------------------

  app.post("/self/leave-requests", gate("hr.self.leave"), async (c) => {
    const parsed = selfCreateLeaveRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const me = await caller(c);
    if (!me) return notLinked(c);
    try {
      const request = await atomically(deps.transactor, async () => {
        const number = (await deps.numbering.next("LEAVE_REQUEST")).formatted;
        return createLeaveRequest({ ...parsed.data, id: parsed.data.id ?? randomUUID(), number, employeeId: me.employee.id }, deps.leaveRequests);
      });
      return c.json(serializeLeaveRequest(request), 201);
    } catch (err) {
      if (err instanceof InvalidLeaveRequestError) return domainRefusal(c, err, 422);
      throw err;
    }
  });

  app.post("/self/leave-requests/:id/cancel", gate("hr.self.leave"), async (c) => {
    const me = await caller(c);
    if (!me) return notLinked(c);
    const current = await deps.leaveRequests.findById(c.req.param("id"));
    if (!current || current.employeeId !== me.employee.id) {
      return bilingual(c, 404, "LEAVE_REQUEST_NOT_FOUND", "طلب الإجازة غير موجود.", "The leave request was not found.");
    }
    try {
      const wasApproved = current.status === "approved";
      const next = cancelLeaveRequest(current);
      await deps.leaveRequests.update(next);
      if (wasApproved && deps.leaveBalances) {
        await releaseLeaveBalance(current.employeeId, current.leaveType, Number(current.startDate.slice(0, 4)), Qty.fromMajor(String(current.days)), deps.leaveBalances);
      }
      return c.json(serializeLeaveRequest(next));
    } catch (err) {
      if (err instanceof InvalidLeaveRequestTransitionError) return domainRefusal(c, err, 422);
      throw err;
    }
  });

  // --- My payslips ----------------------------------------------------------

  const { runs, payslips } = deps;
  if (runs && payslips) {
    app.get("/self/payslips", gate("hr.self.payslip"), async (c) => {
      const me = await caller(c);
      if (!me) return c.json({ employeeId: null, payslips: [] });
      const rows = [];
      for (const payslip of await payslips.listByEmployeeId(me.employee.id)) {
        const run = await runs.findById(payslip.runId);
        if (!run || !RELEASED_RUN_STATUSES.includes(run.status)) continue;
        rows.push({ payslip: serializePayslip(payslip), run: runSummary(run) });
      }
      rows.sort((a, b) => (a.run.year * 100 + a.run.month < b.run.year * 100 + b.run.month ? 1 : -1));
      return c.json({ employeeId: me.employee.id, payslips: rows });
    });

    app.get("/self/payslips/:id/print", gate("hr.self.payslip"), async (c) => {
      const me = await caller(c);
      if (!me) return notLinked(c);
      const payslip = await payslips.findById(c.req.param("id"));
      const run = payslip ? await runs.findById(payslip.runId) : null;
      if (!payslip || payslip.employeeId !== me.employee.id || !run || !RELEASED_RUN_STATUSES.includes(run.status)) {
        return bilingual(c, 404, "PAYSLIP_NOT_FOUND", "كشف الراتب غير موجود.", "The payslip was not found.");
      }
      const [template, settings, overrides] = await Promise.all([deps.printTemplates?.get(), deps.tenantSettings?.get(), deps.statutoryOverrides?.list()]);
      const unverified = new Set(unverifiedStatutoryTableCodes(overrides ?? []));
      return c.json({
        statutoryUnverified: payslip.lines.some((l) => l.referenceId !== null && unverified.has(l.referenceId)),
        payslip: serializePayslip(payslip),
        run: runSummary(run),
        employee: await selfEmployee(me.employee),
        printTemplate: template ?? DEFAULT_PRINT_TEMPLATE_CONFIG,
        company: settings
          ? {
              companyName: settings.companyName,
              address: settings.address || null,
              phone: settings.phone || null,
              email: settings.email || null,
              taxRegistrationNumber: settings.taxRegistrationNumber || null,
              commercialRegistrationNumber: settings.commercialRegistrationNumber || null,
            }
          : null,
      });
    });
  }

  // --- My advances ----------------------------------------------------------

  const advances = deps.advances;
  if (advances) {
    app.get("/self/advances", gate("hr.self.advance"), async (c) => {
      const me = await caller(c);
      if (!me) return c.json({ employeeId: null, advances: [] });
      const rows = await advances.listByEmployeeId(me.employee.id);
      return c.json({ employeeId: me.employee.id, advances: rows.map(serializeAdvance).reverse() });
    });

    app.post("/self/advances", gate("hr.self.advance"), async (c) => {
      const parsed = selfCreateAdvanceSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      const me = await caller(c);
      if (!me) return notLinked(c);
      try {
        const pending = (await advances.listByEmployeeId(me.employee.id)).find((a) => a.status === "pending");
        if (pending) throw new PendingAdvanceExistsError(pending.number);
        const advance = await atomically(deps.transactor, async () => {
          const number = (await deps.numbering.next("EMPLOYEE_ADVANCE")).formatted;
          return requestEmployeeAdvance(
            {
              id: randomUUID(),
              number,
              employeeId: me.employee.id,
              amount: Money.fromMajor(parsed.data.amount),
              installmentCount: parsed.data.installmentCount,
              firstDeductionDate: parsed.data.firstDeductionDate,
              reason: parsed.data.reason ?? null,
            },
            advances,
          );
        });
        return c.json(serializeAdvance(advance), 201);
      } catch (err) {
        if (err instanceof PendingAdvanceExistsError) return domainRefusal(c, err, 409);
        if (err instanceof InvalidEmployeeAdvanceError) return domainRefusal(c, err, 422);
        throw err;
      }
    });
  }

  // --- My attendance and the web clock ---------------------------------------

  const attendance = deps.attendance;
  if (!attendance) return app;

  app.get("/self/attendance", gate("hr.self.attendance"), async (c) => {
    const month = c.req.query("month") ?? (await tenantClock(c)).date.slice(0, 7);
    if (!MONTH_PATTERN.test(month)) {
      return bilingual(c, 400, "VALIDATION_ERROR", "الشهر مطلوب بصيغة YYYY-MM.", "The month must be given as YYYY-MM.");
    }
    const me = await caller(c);
    if (!me) return c.json({ employeeId: null, month, entries: [] });
    const entries = await attendance.list({ employeeId: me.employee.id, from: `${month}-01`, to: lastDayOf(month) });
    return c.json({ employeeId: me.employee.id, month, entries: entries.map(serializeAttendance) });
  });

  async function openEntryFor(employeeId: string, now: { date: string; time: string; yesterday: string }) {
    const [today, yesterday] = await Promise.all([
      attendance!.findByEmployeeAndDate(employeeId, now.date),
      attendance!.findByEmployeeAndDate(employeeId, now.yesterday),
    ]);
    return { today, yesterday };
  }

  app.get("/self/clock", gate("hr.self.clock"), async (c) => {
    const now = await tenantClock(c);
    const me = await caller(c);
    if (!me) {
      return c.json({
        employeeId: null,
        today: now.date,
        serverTime: now.time,
        todayEntry: null,
        openEntry: null,
        requireSelfie: false,
        requireBiometric: false,
        biometricRegistered: false,
        storageAvailable: deps.attachments !== undefined,
      });
    }
    const { today, yesterday } = await openEntryFor(me.employee.id, now);
    const overnightOpen = yesterday && yesterday.checkIn && !yesterday.checkOut && now.time < yesterday.checkIn ? yesterday : null;
    const open = today && today.checkIn && !today.checkOut ? today : today ? null : overnightOpen;
    const credential = await deps.clockCredentials?.findByEmployeeId(me.employee.id);
    return c.json({
      employeeId: me.employee.id,
      today: now.date,
      serverTime: now.time,
      todayEntry: today ? serializeAttendance(today) : null,
      openEntry: open ? serializeAttendance(open) : null,
      requireSelfie: me.employee.requireSelfieAtClockIn,
      requireBiometric: me.employee.requireBiometricAtClockIn,
      biometricRegistered: credential != null,
      storageAvailable: (!me.employee.requireSelfieAtClockIn || deps.attachments !== undefined) && (!me.employee.requireBiometricAtClockIn || deps.clockCredentials !== undefined),
    });
  });

  app.post("/self/clock/challenge", gate("hr.self.clock"), async (c) => {
    const parsed = clockChallengeRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const me = await caller(c);
    if (!me) return notLinked(c);
    if (!deps.clockCredentials) return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.StorageUnavailable));
    const party = relyingPartyOf(c.req.header("origin"));
    if (!party) return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.BiometricFailed));
    const credential = await deps.clockCredentials.findByEmployeeId(me.employee.id);
    if (parsed.data.purpose === ClockChallengePurposeDTO.Register && credential) {
      return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.BiometricAlreadyRegistered));
    }
    if (parsed.data.purpose === ClockChallengePurposeDTO.Assert && !credential) {
      return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.BiometricNotRegistered));
    }
    const challenge = await challenges.issue(me.user.id, parsed.data.purpose, party.rpId);
    const settings = await deps.tenantSettings?.get();
    return c.json({
      challenge,
      rpId: party.rpId,
      rpName: settings?.companyName || "Mezan",
      userId: toBase64Url(Buffer.from(me.user.id, "utf8")),
      userName: me.user.email,
      userDisplayName: me.user.nameAr,
      timeoutMs: CHALLENGE_TTL_MS,
      allowCredentialIds: credential ? [credential.credentialId] : [],
    });
  });

  app.post("/self/clock/credential", gate("hr.self.clock"), async (c) => {
    const parsed = clockCredentialRegistrationSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const me = await caller(c);
    if (!me) return notLinked(c);
    const store = deps.clockCredentials;
    if (!store) return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.StorageUnavailable));
    if (await store.findByEmployeeId(me.employee.id)) return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.BiometricAlreadyRegistered));
    const pending = await challenges.consume(me.user.id, ClockChallengePurposeDTO.Register);
    if (!pending) return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.BiometricChallengeExpired));
    const party = relyingPartyOf(c.req.header("origin"));
    const authData = readAuthenticatorData(fromBase64Url(parsed.data.authenticatorData));
    const publicKey = importPublicKey(parsed.data.publicKey);
    const ok =
      party !== null &&
      party.rpId === pending.rpId &&
      authData !== null &&
      publicKey !== null &&
      WEBAUTHN_ALGORITHMS.includes(parsed.data.publicKeyAlgorithm) &&
      clientDataMatches(fromBase64Url(parsed.data.clientDataJSON), { type: "webauthn.create", challenge: pending.challenge, origin: party.origin }) &&
      authenticatorDataAcceptable(authData, pending.rpId);
    if (!ok || !party || !authData) return refusal(c, new ClockPunchRefusedError(ClockRefusalCode.BiometricFailed));
    const now = new Date().toISOString();
    await store.create({
      id: randomUUID(),
      employeeId: me.employee.id,
      userId: me.user.id,
      credentialId: parsed.data.credentialId.replace(/=+$/, ""),
      publicKeySpki: parsed.data.publicKey.replace(/=+$/, ""),
      algorithm: parsed.data.publicKeyAlgorithm,
      rpId: party.rpId,
      signCount: authData.signCount,
      createdAt: now,
      lastUsedAt: null,
    });
    await recordAdminEvent(deps.audit, c, {
      module: "hr",
      entityType: "clock_credential",
      entityId: me.employee.id,
      action: "register",
      severity: "INFO",
      details: { employeeCode: me.employee.code, rpId: party.rpId, algorithm: parsed.data.publicKeyAlgorithm },
    });
    return c.json({ registered: true }, 201);
  });

  async function verifyBiometric(c: Context, me: { user: User; employee: Employee }, body: SelfClockPunchDTO): Promise<string> {
    const store = deps.clockCredentials;
    if (!store) throw new ClockPunchRefusedError(ClockRefusalCode.StorageUnavailable);
    if (!body.biometric) throw new ClockPunchRefusedError(ClockRefusalCode.BiometricRequired);
    const credential = await store.findByEmployeeId(me.employee.id);
    if (!credential) throw new ClockPunchRefusedError(ClockRefusalCode.BiometricNotRegistered);
    const pending = await challenges.consume(me.user.id, ClockChallengePurposeDTO.Assert);
    if (!pending) throw new ClockPunchRefusedError(ClockRefusalCode.BiometricChallengeExpired);
    const party = relyingPartyOf(c.req.header("origin"));
    const authDataBytes = fromBase64Url(body.biometric.authenticatorData);
    const clientDataBytes = fromBase64Url(body.biometric.clientDataJSON);
    const authData = readAuthenticatorData(authDataBytes);
    const publicKey = importPublicKey(credential.publicKeySpki);
    const ok =
      party !== null &&
      party.rpId === credential.rpId &&
      pending.rpId === credential.rpId &&
      body.biometric.credentialId.replace(/=+$/, "") === credential.credentialId &&
      authData !== null &&
      publicKey !== null &&
      clientDataMatches(clientDataBytes, { type: "webauthn.get", challenge: pending.challenge, origin: party.origin }) &&
      authenticatorDataAcceptable(authData, credential.rpId) &&
      assertionSignatureValid(publicKey, credential.algorithm, authDataBytes, clientDataBytes, fromBase64Url(body.biometric.signature));
    if (!ok || !authData) throw new ClockPunchRefusedError(ClockRefusalCode.BiometricFailed);
    if ((authData.signCount !== 0 || credential.signCount !== 0) && authData.signCount <= credential.signCount) {
      throw new ClockPunchRefusedError(ClockRefusalCode.BiometricFailed);
    }
    await store.recordUse(credential.id, authData.signCount, new Date().toISOString());
    return credential.credentialId;
  }

  function readSelfie(body: SelfClockPunchDTO): { bytes: Uint8Array; mimeType: string } {
    if (!body.selfie) throw new ClockPunchRefusedError(ClockRefusalCode.SelfieRequired);
    if (!deps.attachments) throw new ClockPunchRefusedError(ClockRefusalCode.StorageUnavailable);
    const mimeType = body.selfie.mimeType.trim().toLowerCase();
    const bytes = new Uint8Array(Buffer.from(body.selfie.contentBase64, "base64"));
    if (!SELFIE_MIME_TYPES.includes(mimeType) || bytes.byteLength === 0 || bytes.byteLength > ATTACHMENT_MAX_BYTES || !selfieBytesMatchMime(bytes, mimeType)) {
      throw new ClockPunchRefusedError(ClockRefusalCode.SelfieInvalid);
    }
    return { bytes, mimeType };
  }

  function stampNote(existing: string | null, action: `${SelfClockActionDTO}`, time: string, body: SelfClockPunchDTO): string {
    const where = body.location
      ? ` @ ${body.location.latitude.toFixed(5)},${body.location.longitude.toFixed(5)}${body.location.accuracyMeters != null ? ` ±${Math.round(body.location.accuracyMeters)}m` : ""}`
      : "";
    const line = `${action === SelfClockActionDTO.In ? "حضور ذاتي" : "انصراف ذاتي"} ${time}${where}`;
    const joined = existing ? `${existing} · ${line}` : line;
    return joined.slice(0, 1000);
  }

  const punchLocks = new Map<string, Promise<unknown>>();

  app.post("/self/clock", gate("hr.self.clock"), async (c) => {
    const parsed = selfClockPunchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const me = await caller(c);
    if (!me) return notLinked(c);

    const previous = punchLocks.get(me.employee.id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      assertMayClock(me.employee);
      const selfie = me.employee.requireSelfieAtClockIn ? readSelfie(body) : null;
      const now = await tenantClock(c);
      const { today, yesterday } = await openEntryFor(me.employee.id, now);
      const plan = planClockPunch(body.action, now, today, yesterday);
      const credentialId = me.employee.requireBiometricAtClockIn ? await verifyBiometric(c, me, body) : null;

      let entry: AttendanceEntry;
      if (plan.kind === "check_out") {
        entry = correctAttendance(plan.entry, { checkOut: plan.checkOut, notes: stampNote(plan.entry.notes, body.action, now.time, body), status: plan.entry.status });
        await attendance.update(entry);
      } else {
        const date = plan.kind === "create" ? plan.date : plan.entry.date;
        const [holidays, leaveRequests] = await Promise.all([deps.holidays.list(), deps.leaveRequests.listByEmployeeId(me.employee.id)]);
        if (plan.kind === "create") {
          entry = recordAttendance({
            id: randomUUID(),
            employeeId: me.employee.id,
            date,
            checkIn: plan.checkIn,
            notes: stampNote(null, body.action, now.time, body),
            holidays,
            onApprovedLeave: isOnApprovedLeave(leaveRequests, me.employee.id, date),
          });
          await attendance.create(entry);
        } else {
          entry = correctAttendance(plan.entry, {
            checkIn: plan.checkIn,
            notes: stampNote(plan.entry.notes, body.action, now.time, body),
            holidays,
            onApprovedLeave: isOnApprovedLeave(leaveRequests, me.employee.id, date),
          });
          await attendance.update(entry);
        }
      }

      let selfieAttachmentId: string | null = null;
      if (selfie && deps.attachments) {
        const attachment = await createAttachment(
          {
            entityType: "attendance",
            entityId: entry.id,
            fileName: `selfie-${body.action}-${entry.date}-${now.time.replace(":", "")}.${selfie.mimeType.split("/")[1] ?? "jpg"}`,
            mimeType: selfie.mimeType,
            notes: body.action === SelfClockActionDTO.In ? "صورة الحضور الذاتي" : "صورة الانصراف الذاتي",
            bytes: selfie.bytes,
            uploadedBy: me.user.id,
          },
          deps.attachments,
        );
        selfieAttachmentId = attachment.id;
      }

      await recordAdminEvent(deps.audit, c, {
        module: "hr",
        entityType: "attendance",
        entityId: entry.id,
        action: body.action === SelfClockActionDTO.In ? "self_clock_in" : "self_clock_out",
        severity: "INFO",
        details: {
          employeeId: me.employee.id,
          employeeCode: me.employee.code,
          date: entry.date,
          time: now.time,
          selfieAttachmentId,
          biometricCredentialId: credentialId,
          location: body.location ?? null,
        },
      });
      return { entry: serializeAttendance(entry), selfieAttachmentId };
    });
    punchLocks.set(me.employee.id, run);
    try {
      return c.json(await run, 201);
    } catch (err) {
      if (err instanceof ClockPunchRefusedError) return refusal(c, err);
      if (err instanceof InvalidAttendanceEntryError) return domainRefusal(c, err, 422);
      throw err;
    } finally {
      if (punchLocks.get(me.employee.id) === run) punchLocks.delete(me.employee.id);
    }
  });

  // --- HR: reset a lost or replaced clock device ------------------------------

  app.get("/employees/:id/clock-credential", gate("hr.employee.view"), async (c) => {
    const credential = await deps.clockCredentials?.findByEmployeeId(c.req.param("id"));
    return c.json({ registered: credential != null, createdAt: credential?.createdAt ?? null, lastUsedAt: credential?.lastUsedAt ?? null });
  });

  app.post("/employees/:id/clock-credential/reset", gate("hr.employee.edit"), async (c) => {
    const employee = await deps.employees.findById(c.req.param("id"));
    if (!employee) return bilingual(c, 404, "EMPLOYEE_NOT_FOUND", "الموظف غير موجود.", "The employee was not found.");
    const removed = (await deps.clockCredentials?.deleteByEmployeeId(employee.id)) ?? 0;
    if (removed > 0) {
      await recordAdminEvent(deps.audit, c, {
        module: "hr",
        entityType: "clock_credential",
        entityId: employee.id,
        action: "reset",
        details: { employeeCode: employee.code, removed },
      });
    }
    return c.json({ registered: false, removed });
  });

  return app;
}

function runSummary(run: PayrollRun) {
  return {
    id: run.id,
    number: run.number,
    year: run.year,
    month: run.month,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    status: run.status,
    statutoryTableCodes: run.statutoryTableCodes,
  };
}

function serializeLeaveRequest(r: LeaveRequest) {
  return {
    id: r.id,
    number: r.number,
    employeeId: r.employeeId,
    leaveType: r.leaveType,
    halfDay: r.halfDay,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
  };
}

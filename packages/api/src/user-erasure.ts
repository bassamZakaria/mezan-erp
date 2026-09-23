import {
  attendanceNoteCarriesLocation,
  correctAttendance,
  erasedEmployee,
  scrubAttendanceNote,
  type AttachmentRepository,
  type AttendanceRepository,
  type ClockCredentialRepository,
  type Employee,
  type EmployeeRepository,
  type WebauthnChallengeRepository,
} from "@mezan/domain";

export interface UserErasureCounts {
  readonly employee: boolean;
  readonly clockInSelfies: number;
  readonly webauthnCredentials: number;
  readonly webauthnChallenges: number;
  readonly attendanceLocations: number;
}

export const EMPTY_ERASURE_COUNTS: UserErasureCounts = {
  employee: false,
  clockInSelfies: 0,
  webauthnCredentials: 0,
  webauthnChallenges: 0,
  attendanceLocations: 0,
};

/**
 * The person's data held outside the `user` row. Both calls run INSIDE the
 * erasure's transaction, so a failure anywhere leaves the account un-erased
 * rather than half-erased.
 */
export interface UserErasurePort {
  linkedEmployee(employeeId: string): Promise<Employee | null>;
  eraseLinkedPersonalData(input: {
    readonly userId: string;
    readonly employee: Employee | null;
  }): Promise<UserErasureCounts>;
}

export interface UserErasureDeps {
  readonly employees: Pick<EmployeeRepository, "findById" | "update">;
  readonly attendance?: Pick<AttendanceRepository, "list" | "update">;
  readonly attachments?: Pick<AttachmentRepository, "list" | "delete">;
  readonly clockCredentials?: Pick<ClockCredentialRepository, "deleteByEmployeeId">;
  readonly challenges?: WebauthnChallengeRepository;
}

/**
 * The attendance ENTRY stays — the hours worked are a payroll record — but the
 * note the web clock stamped the device's GPS fix into does not, and neither
 * does the selfie the punch attached to it.
 */
async function eraseAttendanceTrail(
  deps: UserErasureDeps,
  employee: Employee,
): Promise<{ readonly selfies: number; readonly locations: number }> {
  if (!deps.attendance) return { selfies: 0, locations: 0 };
  const entries = await deps.attendance.list({ employeeId: employee.id });
  let selfies = 0;
  let locations = 0;
  for (const entry of entries) {
    if (attendanceNoteCarriesLocation(entry.notes)) {
      // `status` travels explicitly: `correctAttendance` RECOMPUTES it from the patch when it is
      // omitted, and an erasure that silently re-graded a day late/absent would rewrite payroll input.
      await deps.attendance.update(
        correctAttendance(entry, { notes: scrubAttendanceNote(entry.notes), status: entry.status }),
      );
      locations += 1;
    }
    if (!deps.attachments) continue;
    for (const attachment of await deps.attachments.list("attendance", entry.id)) {
      await deps.attachments.delete(attachment.id);
      selfies += 1;
    }
  }
  return { selfies, locations };
}

export function createUserErasurePort(deps: UserErasureDeps): UserErasurePort {
  return {
    linkedEmployee: (employeeId) => deps.employees.findById(employeeId),
    async eraseLinkedPersonalData({ userId, employee }) {
      const webauthnChallenges = (await deps.challenges?.deleteByUserId?.(userId)) ?? 0;
      if (!employee) return { ...EMPTY_ERASURE_COUNTS, webauthnChallenges };
      const { selfies, locations } = await eraseAttendanceTrail(deps, employee);
      const webauthnCredentials = (await deps.clockCredentials?.deleteByEmployeeId(employee.id)) ?? 0;
      await deps.employees.update(erasedEmployee(employee));
      return {
        employee: true,
        clockInSelfies: selfies,
        webauthnCredentials,
        webauthnChallenges,
        attendanceLocations: locations,
      };
    },
  };
}

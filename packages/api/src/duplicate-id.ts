import type { Context } from "hono";
import { DuplicateRecordIdError } from "@mezan/domain";

export function duplicateIdRefusal(c: Context, err: DuplicateRecordIdError): Response {
  return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
}

/** The 409 for a create that names an id a stored record already holds, or null when the id is free. */
export function refuseExistingId(c: Context, existing: unknown, id: string): Response | null {
  return existing === null || existing === undefined ? null : duplicateIdRefusal(c, new DuplicateRecordIdError(id));
}

/** The same refusal for a create whose id is optional: nothing to refuse when the caller left it to the server. */
export async function refuseTakenId(c: Context, id: string | undefined, find: (id: string) => Promise<unknown>): Promise<Response | null> {
  return id === undefined ? null : refuseExistingId(c, await find(id), id);
}

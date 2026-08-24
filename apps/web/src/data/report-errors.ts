interface ServerValidationError {
  readonly field?: string;
  readonly message?: string;
}

/**
 * The report routes reject a bad parameter with
 * `{ error, errors: [{ field, message }] }`. Discarding that body left the user
 * staring at an unchanged empty report with no idea the server had refused it.
 *
 * Shared by BOTH report hooks: the fix originally landed on the 7 financial
 * statements only, so the same invalid date on any of the 22 operational
 * reports still failed silently.
 */
export async function readReportFieldErrors(res: {
  json<T>(): Promise<T>;
}): Promise<Record<string, string> | undefined> {
  const body = await res
    .json<{ errors?: readonly ServerValidationError[]; message?: string }>()
    .catch(() => ({}) as { errors?: readonly ServerValidationError[]; message?: string });
  const byField: Record<string, string> = {};
  for (const e of body.errors ?? []) {
    if (!e.message) continue;
    const key = e.field || "_root";
    byField[key] = byField[key] ? `${byField[key]} ${e.message}` : e.message;
  }
  // Routes outside the report engine reject with a bare `message` and no field.
  if (Object.keys(byField).length === 0 && body.message) byField._root = body.message;
  return Object.keys(byField).length > 0 ? byField : undefined;
}

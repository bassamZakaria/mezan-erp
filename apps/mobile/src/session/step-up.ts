import { ApiError } from "@/api/errors";

export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

export async function withStepUp<T>(send: () => Promise<T>, ask: (message: string) => Promise<boolean>): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== STEP_UP_REQUIRED) throw error;
    if (!(await ask(error.serverMessage ?? ""))) throw error;
    return send();
  }
}

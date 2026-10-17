import { randomInt } from "node:crypto";
import type { Context } from "hono";

export interface OneTimeSecrets {
  readonly pin: string;
  readonly password: string;
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const PASSWORD_LENGTH = 12;
const PIN_DIGITS = 6;

function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((digit, index) => digit - (digits[index] as number));
  return steps.every((step) => step === 0) || steps.every((step) => step === 1) || steps.every((step) => step === -1);
}

export function generatePin(): string {
  for (;;) {
    const pin = String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, "0");
    if (!isWeakPin(pin)) return pin;
  }
}

export function generateTemporaryPassword(): string {
  return Array.from({ length: PASSWORD_LENGTH }, () => PASSWORD_ALPHABET[randomInt(0, PASSWORD_ALPHABET.length)]).join("");
}

export function generateOneTimeSecrets(): OneTimeSecrets {
  return { pin: generatePin(), password: generateTemporaryPassword() };
}

export function plaintextOf(secrets: OneTimeSecrets): readonly string[] {
  return [secrets.pin, secrets.password];
}

// SECURITY: these plaintexts live only between the pre-transaction hash and the
// handler that returns them once. Nothing here is written to a store, a log or
// an audit row.
const provisioned = new WeakMap<Request, ReadonlyMap<number, OneTimeSecrets>>();

export const CLONE_SECRETS_KEY = 0;

export function stashProvisionedSecrets(c: Context, secrets: ReadonlyMap<number, OneTimeSecrets>): void {
  provisioned.set(c.req.raw, secrets);
}

export function takeProvisionedSecrets(c: Context): ReadonlyMap<number, OneTimeSecrets> | undefined {
  const secrets = provisioned.get(c.req.raw);
  provisioned.delete(c.req.raw);
  return secrets;
}

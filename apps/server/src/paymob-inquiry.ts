import {
  hasPaymobSignedShape,
  parsePaymobTransaction,
  ProviderInquiryStatus,
  type PaymobTransactionObject,
  type ProviderInquiry,
  type ProviderInquiryRequest,
} from "@mezan/domain";

export interface PaymobNotFoundShape {
  readonly name: string;
  readonly status: number;
  readonly matches: (body: unknown) => boolean;
}

function isExactly(body: unknown, expected: Readonly<Record<string, string>>): boolean {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  const wanted = Object.keys(expected);
  return keys.length === wanted.length && wanted.every((key) => (body as Record<string, unknown>)[key] === expected[key]);
}

// EXTERNAL CONTRACT, AND A MONEY CONSTRAINT: an answer listed here is read as
// "Paymob holds no transaction for this order", and the sweep then EXPIRES the
// checkout. Paymob's public documentation describes only the 200 answer
// (fixtures/paymob-inquiry/documented-*.json), so every entry is a shape seen
// from Paymob itself and matched whole — status, keys and text. Anything else
// is put in front of a person. Add a shape only with its fixture and after the
// sandbox contract test (paymob-contract.test.ts) has returned it.
export const PAYMOB_NOT_FOUND_SHAPES: readonly PaymobNotFoundShape[] = [
  { name: "404 with the framework's not-found detail", status: 404, matches: (body) => isExactly(body, { detail: "Not found." }) },
];

export interface PaymobInquiryReadOptions {
  // MONEY CONSTRAINT: off by default. Only a deployment whose operator ran the
  // manual sandbox check (docs/ENVIRONMENTS.md) may read the not-found shape
  // as "no transaction" and let the sweep expire a checkout on it.
  readonly notFoundShapeConfirmed?: boolean;
}

const PROVIDER_WIDE_STATUSES: ReadonlySet<number> = new Set([401, 403, 408, 429]);
const SERVER_ERRORS_FROM = 500;
const SUCCESS_FROM = 200;
const SUCCESS_BELOW = 300;

function unreadable(reason: string): ProviderInquiry {
  return { status: ProviderInquiryStatus.Unreadable, reason };
}

function asTransactionObject(body: unknown): PaymobTransactionObject | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  return body as PaymobTransactionObject;
}

export function readPaymobTransaction(body: unknown, integrationIds: readonly number[], request: ProviderInquiryRequest): ProviderInquiry {
  const transaction = asTransactionObject(body);
  if (!transaction) return unreadable("the inquiry answer is not a JSON object");
  if (!hasPaymobSignedShape(transaction)) return unreadable("the inquiry answer is not a transaction");
  const parsed = parsePaymobTransaction(transaction);
  if (!parsed) return unreadable("the inquiry answer could not be read");
  if (parsed.providerOrderRef !== request.providerOrderRef) return unreadable("the inquiry answered for another order");
  if (!integrationIds.includes(parsed.integrationId)) return unreadable("the transaction belongs to another integration");
  return { status: ProviderInquiryStatus.Found, transaction: parsed };
}

export function readPaymobInquiryAnswer(
  status: number,
  body: unknown,
  integrationIds: readonly number[],
  request: ProviderInquiryRequest,
  options: PaymobInquiryReadOptions = {},
): ProviderInquiry {
  if (PAYMOB_NOT_FOUND_SHAPES.some((shape) => shape.status === status && shape.matches(body))) {
    return options.notFoundShapeConfirmed === true
      ? { status: ProviderInquiryStatus.None }
      : unreadable(`HTTP ${status} in the not-found shape, which this deployment has not confirmed against Paymob's sandbox`);
  }
  if (status >= SERVER_ERRORS_FROM || PROVIDER_WIDE_STATUSES.has(status)) return { status: ProviderInquiryStatus.Unavailable, reason: `HTTP ${status}` };
  if (status < SUCCESS_FROM || status >= SUCCESS_BELOW) return unreadable(`HTTP ${status} that is not a recognised answer`);
  return readPaymobTransaction(body, integrationIds, request);
}

import {
  ApiKeyScopeDTO,
  PUBLIC_API_BASE_PATH,
  PUBLIC_API_IDEMPOTENCY_HEADER,
  PublicApiRefusal,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from "@mezan/contracts";
import { DOMAIN_EVENT_CATALOG, PUBLIC_API_RATE_LIMIT_PER_MINUTE, WEBHOOK_RETRY_POLICY, WEBHOOK_SIGNATURE_TOLERANCE_SECONDS } from "@mezan/domain";

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

const ENVELOPE = { type: "object", required: ["data"], properties: { data: {} } } as const;
const ERROR = {
  type: "object",
  required: ["error"],
  properties: { error: { type: "string", enum: Object.values(PublicApiRefusal) }, message: { type: "string" } },
  additionalProperties: true,
} as const;

const ERRORS: Record<string, Json> = {
  "401": { description: "Missing, malformed, unknown, expired or revoked key — or its creator can no longer sign in.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "403": { description: "The key lacks the scope, or its creator lacks the permission, or the integrations module is not licensed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "429": { description: `More than ${PUBLIC_API_RATE_LIMIT_PER_MINUTE} requests in a minute on this key. See Retry-After.`, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

function ok(description: string): Json {
  return { description, content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } };
}

function read(summary: string, scope: ApiKeyScopeDTO, parameters: readonly Json[] = []): Json {
  return { summary, security: [{ bearer: [scope] }], parameters, responses: { "200": ok(summary), ...ERRORS, "404": { description: "Not found or outside the key's branch scope." } } };
}

function write(summary: string, scope: ApiKeyScopeDTO, body: Json): Json {
  return {
    summary,
    security: [{ bearer: [scope] }],
    parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
    requestBody: { required: true, content: { "application/json": { schema: body } } },
    responses: {
      "201": ok("Created as a draft. Confirming, posting and voiding stay in the application."),
      "400": { description: "Validation failed; `details` names the fields.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "409": { description: "A request with this Idempotency-Key is still in flight, or the record conflicts.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "422": { description: "Refused by the same business rules the application applies, or the Idempotency-Key was reused with another body." },
      ...ERRORS,
    },
  };
}

const ID: Json = { name: "id", in: "path", required: true, schema: { type: "string" } };
const PAGE: readonly Json[] = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1 } },
  { name: "q", in: "query", schema: { type: "string" } },
];
const MONEY = { type: "string", pattern: "^-?\\d+(\\.\\d{1,6})?$", description: "Decimal string; never a JSON number." } as const;

export function publicApiOpenApiDocument(serverUrl: string | null): Json {
  return {
    openapi: "3.1.0",
    info: {
      title: "Mezan Integration API",
      version: "1.0.0",
      description:
        "Cloud edition only. Authenticate with `Authorization: Bearer mzn_…` (never a cookie). A key acts as the user who created it, narrowed to its scopes: it can never do what that user cannot. Writes create drafts through the same validation as the application. Amounts are decimal strings.",
    },
    servers: [{ url: serverUrl ? `${serverUrl}${PUBLIC_API_BASE_PATH}` : PUBLIC_API_BASE_PATH }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "mzn_<tenant>_<lookup>_<secret>" } },
      parameters: {
        IdempotencyKey: {
          name: PUBLIC_API_IDEMPOTENCY_HEADER,
          in: "header",
          required: false,
          description: "Up to 128 characters [A-Za-z0-9._:-]. A retry with the same key and body replays the first answer for 7 days.",
          schema: { type: "string", maxLength: 128 },
        },
      },
      schemas: {
        Envelope: ENVELOPE,
        Error: ERROR,
        Money: MONEY,
        CustomerCreate: {
          type: "object",
          required: ["nameAr"],
          properties: {
            id: { type: "string" },
            code: { type: "string" },
            nameAr: { type: "string" },
            nameEn: { type: ["string", "null"] },
            phone: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            contactPerson: { type: ["string", "null"] },
            taxNumber: { type: ["string", "null"] },
            commercialRegistrationNumber: { type: ["string", "null"] },
            nationalId: { type: ["string", "null"] },
            address: { type: ["string", "null"] },
            category: { type: ["string", "null"] },
            notes: { type: ["string", "null"] },
            paymentTermsDays: { type: "integer", minimum: 0 },
            currency: { type: "string" },
            branchId: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
        SalesInvoiceDraft: {
          type: "object",
          description: "The same body the application's invoice screen sends, validated by the same rules. GL account ids come from the chart of accounts.",
          required: ["date", "dueDate", "customerId", "customerNameAr", "warehouseId", "branchId", "arAccountId", "taxAccountId", "lines"],
          properties: {
            id: { type: "string" },
            date: { type: "string", format: "date" },
            dueDate: { type: "string", format: "date" },
            customerId: { type: "string" },
            customerNameAr: { type: "string" },
            warehouseId: { type: "string" },
            branchId: { type: "string" },
            currency: { type: "string" },
            arAccountId: { type: "string" },
            taxAccountId: { type: "string" },
            notes: { type: ["string", "null"] },
            lines: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["lineId", "itemId", "itemNameAr", "isStock", "qty", "unitPrice", "revenueAccountId"],
                properties: {
                  lineId: { type: "string" },
                  itemId: { type: "string" },
                  itemNameAr: { type: "string" },
                  isStock: { type: "boolean" },
                  qty: MONEY,
                  unitPrice: MONEY,
                  taxRateId: { type: ["string", "null"] },
                  discountAmount: MONEY,
                  revenueAccountId: { type: "string" },
                  cogsAccountId: { type: ["string", "null"] },
                  inventoryAccountId: { type: ["string", "null"] },
                  costCenterId: { type: ["string", "null"] },
                },
              },
            },
          },
        },
        ReceiptDraft: {
          type: "object",
          required: ["date", "amount", "branchId", "paymentMethod", "treasuryAccountId", "customerId"],
          properties: {
            id: { type: "string" },
            date: { type: "string", format: "date" },
            amount: MONEY,
            currency: { type: "string" },
            branchId: { type: "string" },
            paymentMethod: { type: "string", enum: ["cash", "bank", "cheque", "card", "wallet"] },
            treasuryAccountId: { type: "string" },
            customerId: { type: "string" },
            referenceNo: { type: ["string", "null"] },
            memo: { type: "string" },
            allocations: { type: "array", items: { type: "object", required: ["invoiceId"], properties: { invoiceId: { type: "string" }, amount: MONEY } } },
          },
        },
      },
    },
    paths: {
      "/customers": {
        get: read("List customers", ApiKeyScopeDTO.CustomersRead, PAGE),
        post: write("Create a customer (no opening balance)", ApiKeyScopeDTO.CustomersWrite, { $ref: "#/components/schemas/CustomerCreate" }),
      },
      "/customers/{id}": { get: read("Get a customer", ApiKeyScopeDTO.CustomersRead, [ID]) },
      "/suppliers": { get: read("List suppliers", ApiKeyScopeDTO.SuppliersRead, PAGE) },
      "/suppliers/{id}": { get: read("Get a supplier", ApiKeyScopeDTO.SuppliersRead, [ID]) },
      "/items": { get: read("List items", ApiKeyScopeDTO.ItemsRead, PAGE) },
      "/items/{id}": { get: read("Get an item", ApiKeyScopeDTO.ItemsRead, [ID]) },
      "/stock": { get: read("Stock on hand, reserved and available per item and warehouse", ApiKeyScopeDTO.StockRead, [{ name: "warehouseId", in: "query", schema: { type: "string" } }]) },
      "/sales-invoices": {
        get: read("List sales invoices", ApiKeyScopeDTO.SalesInvoicesRead, PAGE),
        post: write("Create a draft sales invoice", ApiKeyScopeDTO.SalesInvoicesWrite, { $ref: "#/components/schemas/SalesInvoiceDraft" }),
      },
      "/sales-invoices/{id}": { get: read("Get a sales invoice", ApiKeyScopeDTO.SalesInvoicesRead, [ID]) },
      "/receipts": {
        get: read("List customer receipts", ApiKeyScopeDTO.ReceiptsRead, PAGE),
        post: write("Create a draft customer receipt", ApiKeyScopeDTO.ReceiptsWrite, { $ref: "#/components/schemas/ReceiptDraft" }),
      },
      "/receipts/{id}": { get: read("Get a customer receipt", ApiKeyScopeDTO.ReceiptsRead, [ID]) },
      "/payments": { get: read("List supplier payments", ApiKeyScopeDTO.PaymentsRead, PAGE) },
      "/payments/{id}": { get: read("Get a supplier payment", ApiKeyScopeDTO.PaymentsRead, [ID]) },
      "/trial-balance": { get: read("Trial balance", ApiKeyScopeDTO.TrialBalanceRead, [{ name: "asOfDate", in: "query", schema: { type: "string", format: "date" } }]) },
    },
    webhooks: {
      event: {
        post: {
          summary: "A domain event",
          description: `Signed with HMAC-SHA256: header \`${WEBHOOK_SIGNATURE_HEADER}: t=<unix seconds>,v1=<hex>\` over \`<t>.<raw body>\` with the subscription's signing secret. Reject a timestamp older than ${WEBHOOK_SIGNATURE_TOLERANCE_SECONDS} seconds. \`${WEBHOOK_EVENT_HEADER}\` names the event and \`${WEBHOOK_DELIVERY_HEADER}\` the attempt's delivery; the body's \`id\` stays the same across redeliveries, so de-duplicate on it. Answer 2xx within ${WEBHOOK_RETRY_POLICY.timeoutMs / 1000}s; anything else is retried with exponential backoff up to ${WEBHOOK_RETRY_POLICY.maxAttempts} attempts, then dead-lettered.`,
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["id", "event", "occurredAt", "data"],
                  properties: {
                    id: { type: "string" },
                    event: { type: "string", enum: DOMAIN_EVENT_CATALOG.map((e) => e.code) },
                    occurredAt: { type: "string", format: "date-time" },
                    webhookId: { type: "string" },
                    data: { type: "object" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Accepted." } },
        },
      },
    },
  };
}

import { z } from "zod";
import { isoDay } from "./iso-date.js";

/**
 * النظام الضريبي المبسط (قانون 6 لسنة 2025) — the wire shapes.
 *
 * The write schema RECORDS a filing the taxpayer already made with the ETA. It
 * is not an election: the election is irrevocable for five years and Mezan
 * never performs one, so there is no "elect" verb here and never should be —
 * `state` is the taxpayer telling Mezan where they stand, and the form
 * reference is the evidence that makes the claim checkable.
 */

export const simplifiedRegimeStateSchema = z.enum(["not_elected", "active", "withdrawn"]);
export type SimplifiedRegimeStateDTO = z.infer<typeof simplifiedRegimeStateSchema>;

export const recordSimplifiedRegimeSchema = z
  .object({
    state: simplifiedRegimeStateSchema,
    /** The date written on Form 1/10, as filed. */
    electedOn: isoDay.nullish(),
    form110Reference: z.string().min(1).nullish(),
    /** The date written on Form 1/11, for a withdrawal. */
    withdrawnOn: isoDay.nullish(),
    form111Reference: z.string().min(1).nullish(),
    /** Joining e-invoicing / e-receipt is a condition of entry, so the date belongs on the record. */
    eInvoicingJoinedOn: isoDay.nullish(),
    notes: z.string().nullish(),
  })
  .refine((value) => value.state === "not_elected" || (value.electedOn != null && value.form110Reference != null), {
    message: "تاريخ ورقم نموذج 1/10 المقدَّم مطلوبان لتسجيل الاختيار",
    params: { messageEn: "The date and number of the filed Form 1/10 are required to record the election." },
    path: ["form110Reference"],
  })
  .refine((value) => value.state !== "withdrawn" || (value.withdrawnOn != null && value.form111Reference != null), {
    message: "تاريخ ورقم نموذج 1/11 المقدَّم مطلوبان لتسجيل التخارج",
    params: { messageEn: "The date and number of the filed Form 1/11 are required to record the withdrawal." },
    path: ["form111Reference"],
  });
export type RecordSimplifiedRegimeDTO = z.infer<typeof recordSimplifiedRegimeSchema>;

export const simplifiedRegimeElectionSchema = z.object({
  state: simplifiedRegimeStateSchema,
  electedOn: z.string().nullable(),
  form110Reference: z.string().nullable(),
  irrevocableUntil: z.string().nullable(),
  withdrawnOn: z.string().nullable(),
  form111Reference: z.string().nullable(),
  eInvoicingJoinedOn: z.string().nullable(),
  notes: z.string().nullable(),
  recordedAt: z.string(),
  recordedBy: z.string(),
});
export type SimplifiedRegimeElectionDTO = z.infer<typeof simplifiedRegimeElectionSchema>;

export const statutoryBandSchema = z.object({
  from: z.string(),
  to: z.string().nullable(),
  ratePercent: z.number(),
  source: z.string(),
});
export type StatutoryBandDTO = z.infer<typeof statutoryBandSchema>;

export const simplifiedRegimeFlagSchema = z.object({
  key: z.string(),
  source: z.string(),
  date: z.string().nullable(),
});

export const concentrationClientSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  turnover: z.string(),
});

/**
 * The screen's whole payload: the recorded election, the statutory table it is
 * judged against, and the ESTIMATED liability with the concentration reading
 * beside it. `estimate` is on the wire, not only in the copy, so a consumer
 * cannot render the figure as a filed one by accident.
 */
export const simplifiedRegimeStatusSchema = z.object({
  election: simplifiedRegimeElectionSchema,
  flags: z.array(simplifiedRegimeFlagSchema),
  schedule: z
    .object({
      id: z.string(),
      effectiveFrom: z.string(),
      effectiveTo: z.string().nullable(),
      bands: z.array(statutoryBandSchema),
      turnoverCeiling: z.object({ value: z.string(), source: z.string() }),
      concentration: z.object({
        value: z.object({ sharePercent: z.number(), clientCount: z.number() }),
        source: z.string(),
      }),
      overshootGrace: z.object({
        value: z.object({ overshootPercent: z.number(), years: z.number(), ratePercent: z.number() }),
        source: z.string(),
      }),
      irrevocableYears: z.object({ value: z.number(), source: z.string() }),
      vatFiling: z.object({
        value: z.object({ mode: z.enum(["monthly", "quarterly"]), dueWithinMonths: z.number() }),
        source: z.string(),
      }),
      exemptions: z.object({
        value: z.array(z.object({ key: z.string(), labelAr: z.string(), labelEn: z.string(), source: z.string() })),
        source: z.string(),
      }),
      normalIncomeTaxPercent: z.object({ value: z.number(), source: z.string() }),
      electionFormRef: z.object({ value: z.string(), source: z.string() }),
      withdrawalFormRef: z.object({ value: z.string(), source: z.string() }),
      annualReturnFormRef: z.object({ value: z.string(), source: z.string() }),
    })
    .nullable(),
  periodFrom: z.string(),
  periodTo: z.string(),
  liability: z
    .object({
      turnover: z.string(),
      standing: z.enum(["within_ceiling", "grace_overshoot", "over_ceiling"]),
      ratePercent: z.number().nullable(),
      tax: z.string().nullable(),
      sources: z.array(z.string()),
      estimate: z.literal(true),
    })
    .nullable(),
  concentration: z
    .object({
      totalTurnover: z.string(),
      topClients: z.array(concentrationClientSchema),
      topSharePercent: z.number(),
      thresholdPercent: z.number(),
      mayDisqualify: z.boolean(),
      source: z.string(),
    })
    .nullable(),
  /** The VAT period the tenant should be filing on, and when the current one falls due. */
  vatPeriod: z.object({
    mode: z.enum(["monthly", "quarterly"]),
    windows: z.array(z.object({ periodFrom: z.string(), periodTo: z.string(), dueDate: z.string() })),
    source: z.string().nullable(),
  }),
  books: z.array(
    z.object({
      key: z.string(),
      nameAr: z.string(),
      nameEn: z.string(),
      reportId: z.string().nullable(),
      screenKey: z.string(),
      source: z.string(),
    }),
  ),
});
export type SimplifiedRegimeStatusDTO = z.infer<typeof simplifiedRegimeStatusSchema>;

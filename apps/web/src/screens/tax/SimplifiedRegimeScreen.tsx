import { ArabicCase, CountedNoun } from "@mezan/domain";
import { useCountPhrase } from "../../lib/count-phrase";
import { useEffect, useState } from "react";
import { Button, Card, Field, Money, Select, StatusPill, TextArea, TextInput, type PillTone } from "@mezan/ui";
import type { RecordSimplifiedRegimeDTO, SimplifiedRegimeStateDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../i18n";
import { useNavigation } from "../../navigation";
import type { ScreenKey } from "../../router/screens";
import { useRecordSimplifiedRegime, useSimplifiedRegime } from "./simplified-regime-hooks";
import { errorMessage } from "../../lib/error-message";

/**
 * النظام الضريبي المبسط (قانون 6 لسنة 2025).
 *
 * TWO THINGS THIS SCREEN REFUSES TO DO. It never elects the regime — the
 * election is irrevocable for five years, so the form records what the taxpayer
 * already filed on Form 1/10 and says so in its own heading. And it never
 * presents the computed charge as a filed figure: every liability on the page
 * is labelled تقدير with the article it was computed from printed beside it.
 *
 * The ≥90% client-concentration exclusion is SHOWN, not applied. Mezan computes
 * the share and says it may disqualify the taxpayer; whether it does turns on
 * facts the books do not hold.
 */

const STATE_KEY: Record<SimplifiedRegimeStateDTO, AppTranslationKey> = {
  not_elected: "simplifiedRegime.state.notElected",
  active: "simplifiedRegime.state.active",
  withdrawn: "simplifiedRegime.state.withdrawn",
};

const STATE_TONE: Record<SimplifiedRegimeStateDTO, PillTone> = {
  not_elected: "neutral",
  active: "success",
  withdrawn: "warning",
};

const STANDING_KEY: Record<string, AppTranslationKey> = {
  within_ceiling: "simplifiedRegime.standing.withinCeiling",
  grace_overshoot: "simplifiedRegime.standing.graceOvershoot",
  over_ceiling: "simplifiedRegime.standing.overCeiling",
};

const FLAG_KEY: Record<string, AppTranslationKey> = {
  eInvoicingMissing: "simplifiedRegime.flag.eInvoicingMissing",
  irrevocableUntil: "simplifiedRegime.flag.irrevocableUntil",
  withdrawnInsideIrrevocability: "simplifiedRegime.flag.withdrawnInsideIrrevocability",
};

const BOOK_KEY: Record<string, AppTranslationKey> = {
  fixedAssetRegister: "simplifiedRegime.book.fixedAssetRegister",
  stockRegister: "simplifiedRegime.book.stockRegister",
  salesJournal: "simplifiedRegime.book.salesJournal",
  purchasesJournal: "simplifiedRegime.book.purchasesJournal",
  taxSummaryBook: "simplifiedRegime.book.taxSummaryBook",
};

function num(value: string | null | undefined): number {
  return value ? Number(value) : 0;
}

/**
 * The catalogue entry for a server-supplied key, falling back to the Arabic the
 * payload already carries rather than leaking the key itself.
 */
function labelFor(
  map: Record<string, AppTranslationKey>,
  key: string,
  fallback: string,
  t: (key: AppTranslationKey) => string,
): string {
  const catalogueKey = map[key];
  return catalogueKey ? t(catalogueKey) : fallback;
}

interface FormState {
  state: SimplifiedRegimeStateDTO;
  electedOn: string;
  form110Reference: string;
  withdrawnOn: string;
  form111Reference: string;
  eInvoicingJoinedOn: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  state: "not_elected",
  electedOn: "",
  form110Reference: "",
  withdrawnOn: "",
  form111Reference: "",
  eInvoicingJoinedOn: "",
  notes: "",
};

/** A quiet line of small print naming the article a figure came from. */
function SourceNote({ children }: { children: React.ReactNode }) {
  return (
    <p lang="ar" dir="auto" className="mt-[6px] text-[11px] leading-[1.6] text-ink-faint">
      {children}
    </p>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-[16px_18px]">
      <h2 className="font-display text-[14px] font-bold text-ink">{title}</h2>
      <div className="mt-[12px]">{children}</div>
    </Card>
  );
}

export function SimplifiedRegimeScreen() {
  const { t, locale } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const { navigate } = useNavigation();
  const query = useSimplifiedRegime();
  const record = useRecordSimplifiedRegime();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const data = query.data;

  useEffect(() => {
    if (!data) return;
    setForm({
      state: data.election.state,
      electedOn: data.election.electedOn ?? "",
      form110Reference: data.election.form110Reference ?? "",
      withdrawnOn: data.election.withdrawnOn ?? "",
      form111Reference: data.election.form111Reference ?? "",
      eInvoicingJoinedOn: data.election.eInvoicingJoinedOn ?? "",
      notes: data.election.notes ?? "",
    });
  }, [data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save() {
    if (record.isPending) return;
    setSaveError(null);
    const body: RecordSimplifiedRegimeDTO = {
      state: form.state,
      electedOn: form.electedOn === "" ? null : form.electedOn,
      form110Reference: form.form110Reference === "" ? null : form.form110Reference,
      withdrawnOn: form.withdrawnOn === "" ? null : form.withdrawnOn,
      form111Reference: form.form111Reference === "" ? null : form.form111Reference,
      eInvoicingJoinedOn: form.eInvoicingJoinedOn === "" ? null : form.eInvoicingJoinedOn,
      notes: form.notes === "" ? null : form.notes,
    };
    try {
      await record.mutateAsync(body);
      setSaved(true);
    } catch (err) {
      setSaveError(errorMessage(err, t("simplifiedRegime.api.saveFailed")));
    }
  }

  const schedule = data?.schedule ?? null;
  const liability = data?.liability ?? null;
  const concentration = data?.concentration ?? null;

  return (
    <div className="w-full">
      <div className="mb-[16px]">
        <h1 className="font-display text-2xl font-bold text-ink">{t("simplifiedRegime.title")}</h1>
        <p className="mt-[5px] max-w-[70ch] text-[12.5px] leading-[1.8] text-ink-muted">
          {t("simplifiedRegime.subtitle")}
        </p>
      </div>

      <div
        role="note"
        className="mb-[18px] rounded-md border border-warning bg-warning-soft px-[14px] py-[11px] text-[12.5px] leading-[1.8] text-warning-ink"
      >
        {t("simplifiedRegime.estimateNotice")}
      </div>

      {query.isError ? (
        <Card className="mb-[18px] p-[16px_18px]">
          <p className="text-[13px] font-semibold text-danger-ink">{t("simplifiedRegime.api.loadFailed")}</p>
          <Button size="sm" className="mt-[10px]" onClick={() => void query.refetch()}>
            {t("common.retry")}
          </Button>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-[14px] xl:grid-cols-2">
        <SectionCard title={t("simplifiedRegime.recordTitle")}>
          <p className="mb-[12px] text-[12px] leading-[1.8] text-ink-muted">{t("simplifiedRegime.recordHelp")}</p>

          <div className="flex flex-col gap-[12px]">
            <Field label={t("simplifiedRegime.field.state")} htmlFor="regime-state">
              <Select
                id="regime-state"
                value={form.state}
                onChange={(value) => set("state", value as SimplifiedRegimeStateDTO)}
                options={(["not_elected", "active", "withdrawn"] as const).map((value) => ({
                  value,
                  label: t(STATE_KEY[value]),
                }))}
              />
            </Field>

            {form.state !== "not_elected" ? (
              <>
                <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                  <Field label={t("simplifiedRegime.field.electedOn")} htmlFor="regime-elected-on">
                    <TextInput
                      id="regime-elected-on"
                      type="date"
                      value={form.electedOn}
                      onChange={(event) => set("electedOn", event.target.value)}
                    />
                  </Field>
                  <Field
                    label={t("simplifiedRegime.field.form110")}
                    hint={t("simplifiedRegime.field.form110Hint")}
                    htmlFor="regime-form-110"
                  >
                    <TextInput
                      id="regime-form-110"
                      value={form.form110Reference}
                      onChange={(event) => set("form110Reference", event.target.value)}
                    />
                  </Field>
                </div>

                <Field
                  label={t("simplifiedRegime.field.eInvoicingJoinedOn")}
                  hint={t("simplifiedRegime.field.eInvoicingHint")}
                  htmlFor="regime-einvoicing"
                >
                  <TextInput
                    id="regime-einvoicing"
                    type="date"
                    value={form.eInvoicingJoinedOn}
                    onChange={(event) => set("eInvoicingJoinedOn", event.target.value)}
                  />
                </Field>
              </>
            ) : null}

            {form.state === "withdrawn" ? (
              <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
                <Field label={t("simplifiedRegime.field.withdrawnOn")} htmlFor="regime-withdrawn-on">
                  <TextInput
                    id="regime-withdrawn-on"
                    type="date"
                    value={form.withdrawnOn}
                    onChange={(event) => set("withdrawnOn", event.target.value)}
                  />
                </Field>
                <Field label={t("simplifiedRegime.field.form111")} htmlFor="regime-form-111">
                  <TextInput
                    id="regime-form-111"
                    value={form.form111Reference}
                    onChange={(event) => set("form111Reference", event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            <Field label={t("simplifiedRegime.field.notes")} htmlFor="regime-notes">
              <TextArea
                id="regime-notes"
                rows={2}
                value={form.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </Field>

            {saveError ? (
              <div
                role="alert"
                className="rounded-md border border-danger bg-danger-soft px-[12px] py-[10px] text-[12.5px] text-danger-ink"
              >
                {saveError}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-[10px]">
              <Button variant="primary" disabled={record.isPending} onClick={() => void save()}>
                {t("simplifiedRegime.save")}
              </Button>
              {saved ? <span className="text-[12px] text-success-ink">{t("simplifiedRegime.saved")}</span> : null}
            </div>
          </div>

          {data ? (
            <div className="mt-[16px] border-t border-border pt-[12px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <StatusPill label={t(STATE_KEY[data.election.state])} tone={STATE_TONE[data.election.state]} />
                {data.election.irrevocableUntil ? (
                  <span className="text-[12px] text-ink-muted">
                    {t("simplifiedRegime.irrevocableUntil")} <span className="mz-num">{data.election.irrevocableUntil}</span>
                  </span>
                ) : null}
              </div>
              {data.flags.length > 0 ? (
                <ul className="mt-[10px] flex flex-col gap-[6px]">
                  {data.flags.map((flag) => (
                    <li key={flag.key} className="text-[12px] leading-[1.7] text-warning-ink">
                      {labelFor(FLAG_KEY, flag.key, flag.key, t)}
                      {flag.date ? <span className="mz-num"> {flag.date}</span> : null}
                      <SourceNote>{flag.source}</SourceNote>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        <SectionCard title={t("simplifiedRegime.estimateTitle")}>
          {liability === null || schedule === null ? (
            <p className="text-[12.5px] text-ink-muted">{t("simplifiedRegime.noSchedule")}</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-[12px]">
                <div>
                  <div className="text-[11px] font-semibold text-ink-faint">{t("simplifiedRegime.turnover")}</div>
                  <div className="mt-[4px] text-[17px] font-bold text-ink">
                    <Money value={num(liability.turnover)} />
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-ink-faint">{t("simplifiedRegime.estimatedTax")}</div>
                  <div className="mt-[4px] text-[17px] font-bold text-ink">
                    {liability.tax === null ? (
                      <span className="text-[13px] text-ink-muted">{t("simplifiedRegime.notPriceable")}</span>
                    ) : (
                      <Money value={num(liability.tax)} />
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-[12px] flex flex-wrap items-center gap-[8px]">
                <StatusPill
                  label={labelFor(STANDING_KEY, liability.standing, liability.standing, t)}
                  tone={liability.standing === "within_ceiling" ? "success" : liability.standing === "grace_overshoot" ? "warning" : "danger"}
                />
                {liability.ratePercent !== null ? (
                  <span className="text-[12px] text-ink-muted">
                    {t("simplifiedRegime.appliedRate")} <span className="mz-num">{liability.ratePercent}%</span>
                  </span>
                ) : null}
                <span className="text-[12px] text-ink-muted">
                  <span className="mz-num">{data?.periodFrom}</span> — <span className="mz-num">{data?.periodTo}</span>
                </span>
              </div>

              <div className="mt-[14px] overflow-x-auto">
                <table className="w-full min-w-[320px] text-[12px]">
                  <thead>
                    <tr className="text-ink-faint">
                      <th className="pb-[6px] text-start font-semibold">{t("simplifiedRegime.bandFrom")}</th>
                      <th className="pb-[6px] text-start font-semibold">{t("simplifiedRegime.bandTo")}</th>
                      <th className="pb-[6px] text-end font-semibold">{t("simplifiedRegime.bandRate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.bands.map((band) => (
                      <tr
                        key={band.from}
                        className={band.ratePercent === liability.ratePercent ? "font-semibold text-ink" : "text-ink-muted"}
                      >
                        <td className="mz-num py-[4px]">{band.from}</td>
                        <td className="mz-num py-[4px]">{band.to ?? "—"}</td>
                        <td className="mz-num py-[4px] text-end">{band.ratePercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SourceNote>{liability.sources.join(" · ")}</SourceNote>
              <SourceNote>
                {t("simplifiedRegime.effectiveFrom")} <span className="mz-num">{schedule.effectiveFrom}</span>
              </SourceNote>
            </>
          )}
        </SectionCard>

        <SectionCard title={t("simplifiedRegime.concentrationTitle")}>
          {concentration === null ? (
            <p className="text-[12.5px] text-ink-muted">{t("simplifiedRegime.noSchedule")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-[10px]">
                <span className="mz-num text-[22px] font-bold text-ink">{concentration.topSharePercent}%</span>
                <span className="text-[12px] text-ink-muted">
                  {t("simplifiedRegime.concentrationOf", {
                    count: countPhrase(concentration.topClients.length, CountedNoun.Customer, ArabicCase.Oblique),
                    threshold: String(concentration.thresholdPercent),
                  })}
                </span>
              </div>
              {concentration.mayDisqualify ? (
                <div
                  role="note"
                  className="mt-[10px] rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] leading-[1.8] text-warning-ink"
                >
                  {t("simplifiedRegime.concentrationWarning")}
                </div>
              ) : null}
              <ul className="mt-[12px] flex flex-col gap-[6px]">
                {concentration.topClients.map((client) => (
                  <li key={client.customerId} className="flex items-center justify-between gap-[10px] text-[12.5px]">
                    <span className="truncate text-ink">{client.customerName}</span>
                    <Money value={num(client.turnover)} className="text-ink-muted" />
                  </li>
                ))}
              </ul>
              <SourceNote>{concentration.source}</SourceNote>
            </>
          )}
        </SectionCard>

        <SectionCard title={t("simplifiedRegime.vatPeriodTitle")}>
          {data ? (
            <>
              <div className="flex flex-wrap items-center gap-[8px]">
                <StatusPill
                  label={t(data.vatPeriod.mode === "quarterly" ? "simplifiedRegime.vat.quarterly" : "simplifiedRegime.vat.monthly")}
                  tone={data.vatPeriod.mode === "quarterly" ? "info" : "neutral"}
                />
                <span className="text-[12px] text-ink-muted">
                  {t(data.vatPeriod.mode === "quarterly" ? "simplifiedRegime.vat.quarterlyHelp" : "simplifiedRegime.vat.monthlyHelp")}
                </span>
              </div>
              <div className="mt-[12px] overflow-x-auto">
                <table className="w-full min-w-[320px] text-[12px]">
                  <thead>
                    <tr className="text-ink-faint">
                      <th className="pb-[6px] text-start font-semibold">{t("simplifiedRegime.vat.period")}</th>
                      <th className="pb-[6px] text-start font-semibold">{t("simplifiedRegime.vat.dueDate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.vatPeriod.windows.map((window) => (
                      <tr key={window.periodFrom} className="text-ink-muted">
                        <td className="mz-num py-[4px]">
                          {window.periodFrom} — {window.periodTo}
                        </td>
                        <td className="mz-num py-[4px]">{window.dueDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.vatPeriod.source ? <SourceNote>{data.vatPeriod.source}</SourceNote> : null}
            </>
          ) : null}
        </SectionCard>

        <SectionCard title={t("simplifiedRegime.booksTitle")}>
          <p className="mb-[10px] text-[12px] leading-[1.8] text-ink-muted">{t("simplifiedRegime.booksHelp")}</p>
          <ul className="flex flex-col gap-[8px]">
            {(data?.books ?? []).map((book) => (
              <li key={book.key} className="flex flex-wrap items-center justify-between gap-[8px]">
                <span className="text-[12.5px] text-ink">{labelFor(BOOK_KEY, book.key, book.nameAr, t)}</span>
                <Button size="sm" onClick={() => navigate(book.screenKey as ScreenKey)}>
                  {t("simplifiedRegime.openBook")}
                </Button>
              </li>
            ))}
          </ul>
          {data?.books[0] ? <SourceNote>{data.books[0].source}</SourceNote> : null}
        </SectionCard>

        {schedule ? (
          <SectionCard title={t("simplifiedRegime.exemptionsTitle")}>
            <ul className="flex flex-col gap-[6px]">
              {schedule.exemptions.value.map((exemption) => (
                <li key={exemption.key} className="text-[12.5px] leading-[1.8] text-ink-muted">
                  {locale === "en" ? exemption.labelEn : exemption.labelAr}
                </li>
              ))}
            </ul>
            <SourceNote>{schedule.exemptions.source}</SourceNote>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}

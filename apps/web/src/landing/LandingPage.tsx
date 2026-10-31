import type { ReactNode } from "react";
import { Link } from "react-router";
import { BrandMark, Copyright, cn } from "@mezan/ui";
import { ArabicCase, CountedNoun } from "@mezan/domain";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { useCountPhrase } from "../lib/count-phrase";
import { LanguageToggle } from "../i18n/LanguageToggle";
import { SIGN_IN_PATH } from "../routing";
import { usePublicPlans, useSiteContact, useWhatsappNumber } from "../signup/signup-api";
import { HeroLedger } from "./HeroLedger";
import { PricingSection } from "./PricingSection";
import { SaleExample } from "./SaleExample";
import { contactHref, whatsappHref } from "./site";
import "./landing.css";

enum SectionId {
  Features = "features",
  Example = "example",
  Pricing = "pricing",
  Faq = "faq",
}

enum SectionTone {
  Plain = "plain",
  Raised = "raised",
}

const NAV: readonly { id: SectionId; label: AppTranslationKey }[] = [
  { id: SectionId.Features, label: "landing.nav.features" },
  { id: SectionId.Example, label: "landing.nav.example" },
  { id: SectionId.Pricing, label: "landing.nav.pricing" },
  { id: SectionId.Faq, label: "landing.nav.faq" },
];

const PROOF: readonly AppTranslationKey[] = ["landing.proof.yours", "landing.proof.arabic", "landing.proof.receipt", "landing.proof.offline"];

const FEATURES: readonly { title: AppTranslationKey; body: AppTranslationKey; icon: string }[] = [
  { title: "landing.feature.accounting.title", body: "landing.feature.accounting.body", icon: "M4 6h16M4 12h16M4 18h10M17 16l2 2 3-4" },
  { title: "landing.feature.inventory.title", body: "landing.feature.inventory.body", icon: "M3 8l9-5 9 5v8l-9 5-9-5V8Zm0 0 9 5 9-5M12 13v8" },
  { title: "landing.feature.sales.title", body: "landing.feature.sales.body", icon: "M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h5" },
  { title: "landing.feature.treasury.title", body: "landing.feature.treasury.body", icon: "M3 7h18v12H3V7Zm0 4h18M7 15h4" },
  { title: "landing.feature.control.title", body: "landing.feature.control.body", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Zm-3 9 2 2 4-4" },
  { title: "landing.feature.migrate.title", body: "landing.feature.migrate.body", icon: "M4 4h10v16H4V4Zm10 8h7m-3-3 3 3-3 3M7 9h4M7 13h4" },
];

const STEPS: readonly { title: AppTranslationKey; body: AppTranslationKey }[] = [
  { title: "landing.step1.title", body: "landing.step1.body" },
  { title: "landing.step2.title", body: "landing.step2.body" },
  { title: "landing.step3.title", body: "landing.step3.body" },
];

const FAQ: readonly { q: AppTranslationKey; a: AppTranslationKey }[] = [
  { q: "landing.faq.card.q", a: "landing.faq.card.a" },
  { q: "landing.faq.after.q", a: "landing.faq.after.a" },
  { q: "landing.faq.export.q", a: "landing.faq.export.a" },
  { q: "landing.faq.data.q", a: "landing.faq.data.a" },
  { q: "landing.faq.offline.q", a: "landing.faq.offline.a" },
  { q: "landing.faq.eta.q", a: "landing.faq.eta.a" },
  { q: "landing.faq.migrate.q", a: "landing.faq.migrate.a" },
  { q: "landing.faq.staff.q", a: "landing.faq.staff.a" },
  { q: "landing.faq.pos.q", a: "landing.faq.pos.a" },
  { q: "landing.faq.pay.q", a: "landing.faq.pay.a" },
];

const PRIMARY_LINK =
  "inline-flex min-h-[48px] items-center justify-center rounded-md border border-brand bg-brand px-[22px] text-[15px] font-semibold text-brand-ink shadow-1 transition-colors hover:border-brand-strong hover:bg-brand-strong";
const SECONDARY_LINK =
  "inline-flex min-h-[48px] items-center justify-center rounded-md border border-border-strong bg-surface px-[22px] text-[15px] font-semibold text-ink transition-colors hover:bg-surface-2";

function Section({ id, tone = SectionTone.Plain, children, className }: { id?: SectionId; tone?: SectionTone; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-[72px] px-[16px] py-[64px] sm:px-[24px] lg:py-[88px]", tone === SectionTone.Raised ? "bg-surface" : "bg-bg", className)}>
      <div className="mx-auto w-full max-w-[1120px]">{children}</div>
    </section>
  );
}

function SectionHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="max-w-[680px]">
      <h2 className="font-display text-[30px] font-bold leading-[1.3] text-ink sm:text-[36px]">{title}</h2>
      {lead ? <p className="mt-[10px] text-[16px] leading-[1.75] text-ink-muted">{lead}</p> : null}
    </div>
  );
}

function useTrialDays(): number {
  return (usePublicPlans().data ?? []).reduce((most, plan) => Math.max(most, plan.trialDays), 0);
}

function WhatsAppLink({ className, children }: { className: string; children: ReactNode }) {
  const whatsapp = useWhatsappNumber();
  if (whatsapp === null) return null;
  return (
    <a href={whatsappHref(whatsapp)} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function ContactLink({ className, children }: { className: string; children: ReactNode }) {
  const href = contactHref(useSiteContact());
  if (href === null) return null;
  const external = href.startsWith("https:");
  return (
    <a href={href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

export function LandingPage() {
  const { t } = useAppTranslation();
  const countPhrase = useCountPhrase();
  const trialDays = useTrialDays();
  const days = trialDays > 0 ? countPhrase(trialDays, CountedNoun.Day, ArabicCase.Oblique) : null;

  return (
    <div className="mz-landing min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-border bg-surface">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1120px] items-center gap-[12px] px-[16px] sm:px-[24px]">
          <a href="#top" className="flex min-h-[44px] items-center gap-[8px]">
            <BrandMark className="h-[28px] w-[28px] flex-none text-brand" />
            <span className="font-display text-[17px] font-bold text-ink">{t("landing.brand")}</span>
          </a>
          <nav aria-label={t("landing.nav.label")} className="ms-[16px] hidden items-center gap-[4px] lg:flex">
            {NAV.map((item) => (
              <a key={item.id} href={`#${item.id}`} className="rounded-md px-[10px] py-[10px] text-[14px] font-semibold text-ink-muted hover:bg-surface-2 hover:text-ink">
                {t(item.label)}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-[4px]">
            <LanguageToggle />
            <Link to={SIGN_IN_PATH} className="inline-flex min-h-[44px] items-center rounded-md px-[10px] text-[14px] font-semibold text-ink hover:bg-surface-2">
              {t("landing.nav.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="px-[16px] pb-[56px] pt-[40px] sm:px-[24px] lg:pb-[88px] lg:pt-[72px]">
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-[36px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <h1 className="font-display text-[34px] font-bold leading-[1.3] text-ink sm:text-[44px] lg:text-[46px]">{t("landing.hero.title")}</h1>
              <p className="mt-[18px] max-w-[560px] text-[17px] leading-[1.8] text-ink-muted">
                {t("landing.hero.lead")}
              </p>
              <div className="mt-[26px] flex flex-wrap gap-[10px]">
                <ContactLink className={PRIMARY_LINK}>{t("landing.cta.contact")}</ContactLink>
                <a href={`#${SectionId.Pricing}`} className={SECONDARY_LINK}>
                  {t("landing.cta.pricing")}
                </a>
              </div>
            </div>
            <HeroLedger />
          </div>
        </section>

        <div className="border-y border-border bg-surface px-[16px] sm:px-[24px]">
          <ul className="mx-auto grid w-full max-w-[1120px] grid-cols-1 gap-x-[24px] gap-y-[10px] py-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {PROOF.map((key) => (
              <li key={key} className="flex items-center gap-[10px] text-[14px] font-semibold text-ink">
                <span aria-hidden="true" className="h-[8px] w-[8px] flex-none rounded-pill bg-accent-bright" />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>

        <Section id={SectionId.Features}>
          <SectionHeading title={t("landing.features.title")} lead={t("landing.features.lead")} />
          <div className="mt-[36px] grid gap-[16px] sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <article
                key={feature.title}
                className={cn("rounded-lg bg-surface p-[22px] shadow-1", index === 0 && "border-t-4 border-brand lg:col-span-2 lg:p-[28px]")}
              >
                <svg viewBox="0 0 24 24" className="h-[28px] w-[28px] text-brand" aria-hidden="true">
                  <path d={feature.icon} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <h3 className={cn("mt-[12px] font-display font-bold text-ink", index === 0 ? "text-2xl" : "text-xl")}>{t(feature.title)}</h3>
                <p className="mt-[8px] text-[14.5px] leading-[1.8] text-ink-muted">{t(feature.body)}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id={SectionId.Example} tone={SectionTone.Raised}>
          <SectionHeading title={t("landing.example.title")} lead={t("landing.example.lead")} />
          <div className="mt-[32px]">
            <SaleExample />
          </div>
        </Section>

        <section className="bg-chrome-2 px-[16px] py-[64px] text-chrome-ink sm:px-[24px] lg:py-[80px]">
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-[28px] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div>
              <h2 className="font-display text-[30px] font-bold leading-[1.3] sm:text-[36px]">{t("landing.desktop.title")}</h2>
              <p className="mt-[12px] max-w-[620px] text-[16px] leading-[1.8] text-chrome-ink-muted">{t("landing.desktop.body")}</p>
              <div className="mt-[22px] flex flex-wrap gap-[10px]">
                <ContactLink className="inline-flex min-h-[48px] items-center rounded-md bg-surface px-[20px] text-[15px] font-semibold text-ink hover:bg-surface-2">
                  {t("landing.desktop.cta")}
                </ContactLink>
              </div>
              <p className="mt-[12px] text-[13px] text-chrome-ink-muted">{t("landing.desktop.note")}</p>
            </div>
            <ul className="flex flex-col gap-[12px]">
              {(["landing.desktop.point1", "landing.desktop.point2", "landing.desktop.point3"] as const).map((key) => (
                <li key={key} className="flex items-center gap-[12px] rounded-lg border border-chrome-border px-[18px] py-[16px] text-[16px] font-semibold">
                  <svg viewBox="0 0 16 16" className="h-[16px] w-[16px] flex-none text-accent-bright" aria-hidden="true">
                    <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Section>
          <SectionHeading title={t("landing.steps.title")} />
          <ol className="mt-[32px] grid gap-[16px] md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-[14px] rounded-lg bg-surface p-[20px] shadow-1">
                <span aria-hidden="true" className="flex h-[40px] w-[40px] flex-none items-center justify-center rounded-pill bg-brand font-display text-lg font-bold text-brand-ink">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink">{t(step.title)}</h3>
                  <p className="mt-[4px] text-[14px] leading-[1.75] text-ink-muted">{t(step.body)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id={SectionId.Pricing} tone={SectionTone.Raised}>
          <SectionHeading title={t("landing.pricing.title")} lead={days ? t("landing.pricing.lead", { days }) : t("landing.pricing.leadPlain")} />
          <div className="mt-[28px]">
            <PricingSection />
          </div>
        </Section>

        <Section id={SectionId.Faq}>
          <SectionHeading title={t("landing.faq.title")} />
          <div className="mt-[28px] max-w-[760px] divide-y divide-border rounded-lg bg-surface shadow-1">
            {FAQ.map((item) => (
              <details key={item.q} className="group px-[20px]">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-[12px] py-[14px] text-[15.5px] font-semibold text-ink">
                  {t(item.q)}
                  <span aria-hidden="true" className="mz-landing-faq-sign flex-none text-xl leading-none text-accent transition-transform">
                    +
                  </span>
                </summary>
                <p className="pb-[18px] text-[14.5px] leading-[1.85] text-ink-muted">{t(item.a)}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="px-[16px] pb-[72px] sm:px-[24px]">
          <div className="mx-auto flex w-full max-w-[1120px] flex-col items-start gap-[16px] rounded-lg bg-brand px-[24px] py-[40px] text-brand-ink sm:px-[48px] lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-display text-[30px] font-bold leading-[1.3]">{t("landing.final.title")}</h2>
              <p className="mt-[6px] text-[16px] opacity-90">{t("landing.final.body")}</p>
            </div>
            <ContactLink className="mz-landing-on-brand inline-flex min-h-[48px] items-center rounded-md bg-surface px-[22px] text-[15px] font-semibold text-ink hover:bg-surface-2">
              {t("landing.cta.contact")}
            </ContactLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface px-[16px] py-[28px] sm:px-[24px]">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-[14px] lg:flex-row lg:items-center lg:justify-between">
          <p className="text-[13px] text-ink-muted">{t("landing.footer.tagline")}</p>
          <nav aria-label={t("landing.footer.label")} className="flex flex-wrap gap-x-[18px] gap-y-[6px] text-[13px]">
            <a href="/legal/privacy" className="inline-flex min-h-[44px] items-center text-ink-muted hover:text-ink hover:underline">
              {t("landing.footer.privacy")}
            </a>
            <a href="/legal/account-deletion" className="inline-flex min-h-[44px] items-center text-ink-muted hover:text-ink hover:underline">
              {t("landing.footer.deletion")}
            </a>
            <Link to={SIGN_IN_PATH} className="inline-flex min-h-[44px] items-center text-ink-muted hover:text-ink hover:underline">
              {t("landing.footer.signIn")}
            </Link>
          </nav>
          <Copyright />
        </div>
      </footer>

      <WhatsAppLink className="fixed bottom-[18px] end-[18px] z-30 inline-flex min-h-[52px] items-center gap-[8px] rounded-pill border border-success bg-success-soft px-[18px] text-[14px] font-semibold text-success-ink shadow-2">
        {t("landing.whatsapp")}
      </WhatsAppLink>
    </div>
  );
}

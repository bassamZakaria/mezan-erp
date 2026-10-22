import type { ReactNode } from "react";
import { BrandMark, Button, Copyright } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

/**
 * The public signup flow's own shell — no nav rail, no session, phone-width
 * safe down to 360px. Shared by the form and the verify-landing page so both
 * carry the same header, language toggle and footer.
 */
export function SignupLayout({ children, maxWidthClassName = "max-w-[560px]" }: { children: ReactNode; maxWidthClassName?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-bg px-[16px] py-[28px] sm:px-[24px]">
      <div className={`flex w-full ${maxWidthClassName} items-center justify-between`}>
        <a href="/" className="flex items-center gap-[8px]">
          <BrandMark className="h-[26px] w-[26px] flex-none text-brand" />
          <span className="font-display text-[15px] font-bold text-ink">Mezan · ميزان</span>
        </a>
        <LanguageToggle />
      </div>
      <div className={`mt-[20px] w-full ${maxWidthClassName}`}>{children}</div>
      <div className="mt-[24px]">
        <Copyright />
      </div>
    </div>
  );
}

export function LanguageToggle() {
  const { locale, setLocale } = useAppTranslation();
  return (
    <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
      {locale === "ar" ? "English" : "العربية"}
    </Button>
  );
}

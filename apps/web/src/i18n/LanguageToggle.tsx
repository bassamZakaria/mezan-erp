import { Button } from "@mezan/ui";
import { useAppTranslation } from "./index";

export function LanguageToggle() {
  const { locale, setLocale } = useAppTranslation();
  return (
    <Button variant="ghost" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
      {locale === "ar" ? <span lang="en">English</span> : <span lang="ar">العربية</span>}
    </Button>
  );
}

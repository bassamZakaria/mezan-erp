import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { TextInput, cn, type TextInputProps } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

export const MIN_PASSWORD_LENGTH = 8;

export const PasswordInput = forwardRef<HTMLInputElement, Omit<TextInputProps, "type">>(function PasswordInput({ className, ...rest }, ref) {
  const { t } = useAppTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div dir="ltr" className={cn("relative", className)}>
      <TextInput ref={ref} type={shown ? "text" : "password"} className="mz-lat w-full pe-[44px]" {...rest} />
      <button
        type="button"
        onClick={() => setShown((value) => !value)}
        aria-label={t(shown ? "login.password.hide" : "login.password.show")}
        className="absolute inset-y-0 end-0 flex w-[40px] items-center justify-center text-ink-muted hover:text-ink"
      >
        {shown ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
      </button>
    </div>
  );
});

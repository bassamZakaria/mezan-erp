import { useId, type ReactNode } from "react";

interface LockedFieldsetProps {
  readonly locked: boolean;
  readonly reason: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function LockedFieldset({ locked, reason, className, children }: LockedFieldsetProps) {
  const reasonId = useId();
  if (!locked) return <>{children}</>;
  return (
    <fieldset disabled aria-describedby={reasonId} className={`m-0 min-w-0 border-0 p-0 ${className ?? ""}`}>
      {children}
      <p id={reasonId} className="mt-[5px] text-[11.5px] text-ink-faint">
        {reason}
      </p>
    </fieldset>
  );
}

import { cn } from "../lib/cn";
import type { ShellUser } from "./types";

/**
 * The user's face — their uploaded photo, or their initials on the gold disc
 * when they have none. One component so the column's foot, the user menu and
 * the login's face row can never disagree about which of the two is showing.
 *
 * `photoUrl` is whatever the profile holds: a `data:` URL from the desktop
 * edition's own store. It is decoration, so it carries an empty `alt` and the
 * name is always present as real text beside it.
 */
export interface AvatarProps {
  user: Pick<ShellUser, "name" | "initials" | "photoUrl">;
  /** Rendered size in px — the disc is square. */
  size: number;
  className?: string;
}

export function Avatar({ user, size, className }: AvatarProps) {
  const style = { width: `${size}px`, height: `${size}px` };
  if (user.photoUrl) {
    return (
      <img
        src={user.photoUrl}
        alt=""
        style={style}
        className={cn("flex-none rounded-full object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "flex flex-none items-center justify-center rounded-full bg-accent font-display font-extrabold text-accent-ink",
        size >= 36 ? "text-sm" : "text-[11px]",
        className,
      )}
    >
      {user.initials}
    </span>
  );
}

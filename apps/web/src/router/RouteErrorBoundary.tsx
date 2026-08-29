import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { Button } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

/**
 * What a screen renders instead of disappearing when it throws.
 *
 * Mounted per ROUTE, not once at the root: a root-only boundary replaces the
 * whole application — nav rail, header, workspace tabs and all — because one
 * report failed to render, and the only way back is a reload that loses the
 * user's place. Scoped to the route, the shell survives, the rail still works,
 * and the failure is contained to the panel that caused it.
 *
 * The message is Arabic-first because a refusal the operator cannot read is
 * indistinguishable from a crash (see the working agreement: domain refusals
 * surface in Arabic, never raw English enum text).
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const navigate = useNavigate();
  const { t } = useAppTranslation();

  const status = isRouteErrorResponse(error) ? error.status : null;
  const detail =
    isRouteErrorResponse(error)
      ? (error.data as string | undefined) ?? error.statusText
      : error instanceof Error
        ? error.message
        : String(error);

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-[12px] rounded-lg border border-danger/40 bg-danger/5 p-[20px]"
    >
      <h2 className="text-lg font-semibold text-ink">
        {status === 404 ? t("routeError.notFoundTitle") : t("routeError.title")}
      </h2>
      <p className="text-sm text-ink-muted">
        {status === 404 ? t("routeError.notFoundBody") : t("routeError.body")}
      </p>
      {/*
        The raw message is shown, not swallowed. A support call that can quote
        the failure is worth more than a tidy panel, and this is a desktop app
        with no server-side log the operator can be asked to send.
      */}
      {detail ? (
        <pre className="max-w-full overflow-x-auto rounded border border-border bg-surface p-[10px] text-xs text-ink-muted" dir="ltr">
          {detail}
        </pre>
      ) : null}
      <div className="flex gap-[8px]">
        <Button variant="primary" onClick={() => navigate(0)}>
          {t("routeError.retry")}
        </Button>
        <Button onClick={() => navigate("/dashboard")}>{t("routeError.goHome")}</Button>
      </div>
    </div>
  );
}

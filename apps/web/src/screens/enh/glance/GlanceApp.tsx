import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, EmptyState } from "@mezan/ui";
import { useApi } from "../../../data/ApiContext";
import { sessionHolds } from "../../../data/session";
import { LoginScreen } from "../../../login/LoginScreen";
import { ChangeTemporaryPasswordScreen } from "../../../login/ChangeTemporaryPasswordScreen";
import { useAppTranslation } from "../../../i18n";
import { GlanceView } from "./GlanceScreen";
import { GLANCE_PERMISSION } from "./permission";

function GlanceShell() {
  const { t } = useAppTranslation();
  const { session, setSession, request } = useApi();
  const queryClient = useQueryClient();

  const signOut = useCallback(() => {
    void request("/auth/logout", { method: "POST" }).catch(() => undefined);
    setSession(null);
    queryClient.clear();
  }, [request, setSession, queryClient]);

  if (session?.mustChangePassword) return <ChangeTemporaryPasswordScreen onSignOut={signOut} />;

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <main className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
        <header className="mb-4 flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold">{t("glance.title")}</h1>
          <Button variant="ghost" onClick={signOut} className="flex-none justify-center">
            {t("glance.signOut")}
          </Button>
        </header>
        {sessionHolds(session, GLANCE_PERMISSION) ? (
          <GlanceView />
        ) : (
          <EmptyState title={t("glance.noAccess.title")} description={t("glance.noAccess.body")} />
        )}
      </main>
    </div>
  );
}

export function GlanceApp() {
  const { session } = useApi();
  return session ? <GlanceShell /> : <LoginScreen onStartWizard={() => undefined} />;
}

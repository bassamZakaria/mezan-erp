import { Suspense, useCallback, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { AppShell, SkeletonTable, navGroupItems, type NavGroup, type NavItem } from "@mezan/ui";
import { ALL_SCOPE } from "@mezan/domain";
import type { BranchDTO, RoleDTO, ScopeSelectionDTO } from "@mezan/contracts";
import { TenantPreferences } from "./settings/TenantPreferences";

import { useScopeSelector } from "./data/hub-hooks";
import { displayName } from "./display-name";
import { useProfile } from "./data/account-hooks";
import { LoginScreen } from "./login/LoginScreen";
import { FirstRunWizard } from "./login/FirstRunWizard";
import { buildCommandItems, buildGoToCommandItems, buildNavGroups, buildTopNavItem, PINNED_NAV_ITEM_KEYS } from "./nav-config";
import { useAppTranslation, type AppTranslationKey } from "./i18n";
import { useApi } from "./data/ApiContext";
import type { CommandItem, ShellUser, UserMenuItem } from "@mezan/ui";
import {
  useBranches,
  useCreateRole,
  useCreateUser,
  useDeleteRole,
  useEmployees,
  useEntitlements,
  useUnreadNotificationCount,
  useJobTitles,
  usePendingApprovalCount,
  useRoles,
  useSetUserStatus,
  useUpdateRole,
  useUpdateUser,
  useUsers,
  useWarehouses,
} from "./data/hooks";
import { UsersPage, type UserFormDraft } from "./pages/UsersPage";
import { RolesPage } from "./pages/RolesPage";
import { RoleEditorPage } from "./pages/RoleEditorPage";
import { NavigationProvider, toScreenIntent, type ScreenIntent, type ScreenIntentInput } from "./navigation";
import { groupKeyForScreen, hubScreenForGroup, parsePath, pathForRoute } from "./routing";
import { isRoutable, type RoutableKey, type ScreenKey } from "./router/screens";
import { Breadcrumbs, parentSegments } from "./Breadcrumbs";
import { useGlobalShortcuts } from "./keyboard/useGlobalShortcuts";
import { ShortcutsOverlay } from "./keyboard/ShortcutsOverlay";
import { EMPTY } from "./lib/empty";


/** Where ⌘N goes when the screen on display has no create flow of its own. */
const RECENT_SCREENS_KEY = "mezan.nav.recent";

function loadRecentScreens(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SCREENS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentScreens(keys: readonly string[]): void {
  try {
    window.localStorage.setItem(RECENT_SCREENS_KEY, JSON.stringify(keys));
  } catch {
    // Ignore write failures — recents still hold for this session.
  }
}

const DEFAULT_CREATE_SCREEN = "sales-invoices" satisfies RoutableKey;

function scopeIdsToSelection(ids: string[], allIds: string[]): ScopeSelectionDTO {
  return ids.length === allIds.length ? ALL_SCOPE : ids;
}

/** The header's branch-scope chip, resolved from the session's real scope against the live branch list. */
function scopeLabelFor(
  branchScope: ScopeSelectionDTO,
  branches: readonly BranchDTO[],
  t: (key: AppTranslationKey, params?: Record<string, string | number>) => string,
): string {
  if (branchScope === ALL_SCOPE) return t("shell.scope.allBranches");
  if (branchScope.length === 1) return branches.find((b) => b.id === branchScope[0])?.name ?? branchScope[0]!;
  return t("shell.scope.branchCount", { count: branchScope.length });
}

function ScreenLoading() {
  return (
    <div className="p-[24px]">
      <SkeletonTable rows={6} columns={5} />
    </div>
  );
}

function initialsFor(fullName: string, unknown: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return unknown;
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join(".");
}

export function AppLayout() {
  const { session, setSession, request } = useApi();
  const profile = useProfile();
  const { t, locale } = useAppTranslation();
  const [showWizard, setShowWizard] = useState(false);

  /*
   * The URL is the source of truth for which screen and sub-page is on
   * display — now read from the ROUTER's location rather than a `hashchange`
   * listener and a duplicate copy in component state.
   *
   * The router already re-renders this layout on every navigation, so the
   * previous `useState` + listener pair was a second store of the same fact,
   * one commit behind on the first paint. Deriving it removes the copy.
   *
   * `parsePath` rather than `useParams`: this layout must resolve the screen
   * for the users/roles views too, and those are mounted by the layout itself
   * rather than by a screen-module route, so they have no params of their own.
   */
  const location = useLocation();
  const routerNavigate = useNavigate();
  const route = useMemo(() => parsePath(location.pathname, "dashboard"), [location.pathname]);
  const activeScreen = route.screen;
  const setActiveScreen = useCallback(
    (screen: ScreenKey) => routerNavigate(pathForRoute(screen)),
    [routerNavigate],
  );
  const [editingRole, setEditingRole] = useState<RoleDTO | null>(null); // null = creating new
  const [roleTemplate, setRoleTemplate] = useState<RoleDTO | null>(null); // the role a new one is duplicated from
  const [pendingIntent, setPendingIntent] = useState<ScreenIntent | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // How many mounted screens accept a "create" intent. Only one routable
  // screen is mounted at a time, so > 0 means "this screen can create".
  const [intentTargets, setIntentTargets] = useState(0);

  const navigate = useCallback(
    (screen: ScreenKey, intent?: ScreenIntentInput) => {
      setActiveScreen(screen);
      setPendingIntent(intent ? { ...toScreenIntent(intent), screen } : null);
    },
    [setActiveScreen],
  );
  const openSubPage = useCallback(
    (segments: readonly string[]) => {
      routerNavigate(pathForRoute(route.screen, segments));
    },
    [routerNavigate, route.screen],
  );
  const openScreenAt = useCallback(
    (screen: ScreenKey, segments: readonly string[]) => {
      routerNavigate(pathForRoute(screen, segments));
    },
    [routerNavigate],
  );
  const clearIntent = useCallback(() => setPendingIntent(null), []);
  const registerIntentTarget = useCallback(() => {
    setIntentTargets((n) => n + 1);
    return () => setIntentTargets((n) => n - 1);
  }, []);
  // Only hand an intent to the screen it names — see ScreenIntent.screen.
  const deliverableIntent = pendingIntent && (pendingIntent.screen === undefined || pendingIntent.screen === route.screen) ? pendingIntent : null;
  const navigation = useMemo(
    () => ({ navigate, segments: route.segments, openSubPage, openScreenAt, intent: deliverableIntent, clearIntent, registerIntentTarget }),
    [navigate, route.segments, openSubPage, openScreenAt, deliverableIntent, clearIntent, registerIntentTarget],
  );

  const rolesQuery = useRoles();
  const usersQuery = useUsers();
  const branchesQuery = useBranches();
  const warehousesQuery = useWarehouses();
  const entitlementsQuery = useEntitlements();
  const employeesQuery = useEmployees();
  const jobTitlesQuery = useJobTitles();
  const pendingApprovalCountQuery = usePendingApprovalCount();
  const pendingApprovalCount = pendingApprovalCountQuery.data ?? 0;
  const unreadNotificationCount = useUnreadNotificationCount().data ?? 0;
  const roles = rolesQuery.data ?? [];
  const users = usersQuery.data ?? EMPTY;
  const branches = branchesQuery.data ?? [];
  const warehouses = warehousesQuery.data ?? [];
  const entitlements = entitlementsQuery.data ?? null;
  // The user form links a login to its HR employee record (docs/archive/catalog/09 §الموظف المرتبط).
  const employees = useMemo(() => {
    const jobTitleById = new Map((jobTitlesQuery.data ?? []).map((j) => [j.id, j.nameAr ?? j.name]));
    return (employeesQuery.data ?? []).map((e) => ({
      id: e.id,
      name: `${e.firstNameAr ?? e.firstName} ${e.lastNameAr ?? e.lastName}`.trim(),
      position: (e.jobTitleId ? jobTitleById.get(e.jobTitleId) : null) ?? "—",
    }));
  }, [employeesQuery.data, jobTitlesQuery.data]);
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const setUserStatus = useSetUserStatus();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();
  const { branchOptions, warehouseOptions, selection, setBranch, setWarehouse } = useScopeSelector();

  const allBranchIds = branches.map((b) => b.id);
  const allWarehouseIds = warehouses.map((w) => w.id);

  const usersByRoleId = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of users) {
      if (u.roleId) map.set(u.roleId, (map.get(u.roleId) ?? 0) + 1);
    }
    return map;
  }, [users]);

  const groups: NavGroup[] = useMemo(() => {
    // Section items must be wired too, not just the ones hanging off the group:
    // التقارير keeps all 22 of its screens in sections, so wiring `items` alone
    // leaves every report row inert.
    const wire = (items: NavItem[]): NavItem[] =>
      items.map((item) => {
        const key = item.key;
        // الموافقات carries a global pending-count badge (docs/archive/catalog/09
        // §الموافقات inbox nav item) — a real count off /workflow/requests/
        // pending-count, not a placeholder.
        const tag =
          key === "approvals" && pendingApprovalCount > 0
            ? { label: String(pendingApprovalCount), tone: "pattern" as const }
            : key === "notifications" && unreadNotificationCount > 0
              ? { label: String(unreadNotificationCount), tone: "pattern" as const }
              : item.tag;
        if (isRoutable(key) || key === "users" || key === "roles") {
          return { ...item, tag, onClick: () => navigate(key as ScreenKey) };
        }
        return { ...item, tag };
      });
    return buildNavGroups(t).map((group) => ({
      ...group,
      items: wire(group.items),
      sections: group.sections?.map((section) => ({ ...section, items: wire(section.items) })),
    }));
  }, [navigate, pendingApprovalCount, unreadNotificationCount, t]);

  // "Workspace" here is the top-level grouping `nav-config.tsx` already names:
  // the two-row top bar switches between them in row one instead of a left
  // rail, and ROW TWO renders the active one's own screens. الإعداد والصلاحيات
  // is deliberately not a tab — it is the gear menu, and «كل الشاشات» lists it.
  //
  // Nothing is lifted out of a workspace any more. الموافقات used to be pulled
  // out as a fixed rail pin; row two is not personal, so removing it here would
  // simply delete the approvals inbox from the only place its workspace lists it.
  // الموافقات is one destination, not a workspace: a tab promises a second row
  // of screens and this has exactly one, so it is drawn beside the tabs as a
  // plain link. Its group (سير العمل) then holds nothing and drops out of the
  // tabs — «كل الشاشات» still lists it, since it is handed the whole tree.
  /**
   * لوحة التحكم، صندوق الوارد and الموافقات, drawn as icons beside the wordmark
   * rather than as rows in the column.
   *
   * لوحة التحكم leads them even though the brand lockup beside it opens the
   * same screen. Clicking a logo to get home is a convention people who know it
   * rely on and people who do not never discover — nothing on the screen says
   * the wordmark is a button. A named, hoverable icon costs 32px and removes
   * the guess; the lockup stays a link for everyone who already reaches for it.
   */
  const directNavItems = useMemo(() => {
    const pinned = groups.flatMap((group) => group.items).filter((item) => PINNED_NAV_ITEM_KEYS.includes(item.key));
    const home: NavItem = { ...buildTopNavItem(t), onClick: () => navigate("dashboard") };
    return [home, ...pinned];
  }, [groups, navigate, t]);

  /**
   * The six workspaces of the column, الإعداد والصلاحيات among them.
   *
   * It used to be behind the header gear as well, on the argument that the
   * gear is the shortcut for someone already at work — but that made three
   * components draw the same fifteen screens (rail, gear, avatar menu) and
   * gave "where do I change settings" three answers. The rail holds it; ⌘K
   * reaches every screen in it by name.
   */
  const workspaceGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, items: group.items.filter((item) => !PINNED_NAV_ITEM_KEYS.includes(item.key)) }))
        // A group may carry all of its screens in sections and none directly —
        // التقارير does — so an empty `items` is not an empty group.
        .filter((group) => navGroupItems(group).length > 0),
    [groups],
  );

  /**
   * Undefined when the screen on display belongs to no workspace tab —
   * الموافقات and every الإعدادات screen do. No tab is then marked current;
   * `AppShell` keeps the last real workspace on row two so the bar does not
   * silently swap to البيع the moment either is opened.
   */
  const resolvedWorkspaceKey = groupKeyForScreen(activeScreen);
  const activeWorkspaceKey = workspaceGroups.some((g) => g.key === resolvedWorkspaceKey) ? (resolvedWorkspaceKey ?? undefined) : undefined;

  /**
   * Each workspace tab opens that workspace's hub. `hubScreenForGroup` resolves
   * the group's own hub screen and, where it has none, its first screen.
   * Reporting `false` is not decorative: `AppShell` then opens «كل الشاشات»
   * filtered to that workspace, so the tab always lands on its own screens.
   */
  const onWorkspaceChange = useCallback(
    (key: string) => {
      const hub = hubScreenForGroup(key);
      if (!hub || !isRoutable(hub)) return false;
      navigate(hub as ScreenKey);
      return true;
    },
    [navigate],
  );

  const routedCommandItems: CommandItem[] = useMemo(() => {
    const targets: Record<string, () => void> = {
      "cmd-invoice": () => navigate("sales-invoices", "create"),
      // Three entries with three different names used to dispatch the same
      // untyped create, so «تحصيل من عميل» and «دفع لمورد» were labels for
      // something the app did not do. Each now opens on its own voucher type.
      "cmd-collect": () => navigate("treasury-vouchers", { kind: "create", prefill: { voucherType: "customer_collection" } }),
      "cmd-receipt": () => navigate("treasury-vouchers", "create"),
      "cmd-receive": () => navigate("goods-receipts", "create"),
      "cmd-pay-supplier": () => navigate("treasury-vouchers", { kind: "create", prefill: { voucherType: "supplier_payment" } }),
      "cmd-purchase-invoice": () => navigate("purchase-invoices", "create"),
      "cmd-quote": () => navigate("quotes", "create"),
      "cmd-item": () => navigate("items", "create"),
      "cmd-adjustment": () => navigate("stock-adjustments", "create"),
      "cmd-shortcuts": () => setShortcutsOpen(true),
    };
    const quickActions = buildCommandItems(t).map((item) => {
      const onSelect = targets[item.id];
      return onSelect ? { ...item, onSelect } : item;
    });
    // Every navigable screen gets a go-to entry (R1.5). Built from the nav
    // specs rather than listed, so a screen added to the sidebar is reachable
    // here without anyone remembering to add it in two places.
    const goTo = buildGoToCommandItems(t)
      .map((item) => {
        const key = item.id.slice("goto-".length);
        return isRoutable(key) ? { ...item, onSelect: () => navigate(key as ScreenKey) } : null;
      })
      .filter((item): item is CommandItem => item !== null);
    return [...quickActions, ...goTo];
  }, [navigate, t]);

  // The user chip in the column's foot IS the link to الملف الشخصي, and signing
  // out is its own control beside it — the two-item dropdown they used to share
  // was a popup to reach a page and a popup to reach a button.
  const openProfile = useCallback(() => navigate("settings-profile"), [navigate]);
  const signOut = useCallback(() => {
    // Revoke server-side first: clearing the client's copy alone left the
    // token valid until it idled out, so a copied token outlived sign-out.
    void request("/auth/logout", { method: "POST" }).catch(() => undefined);
    setActiveScreen("dashboard");
    setSession(null);
  }, [request, setSession, setActiveScreen]);

  const routedTopNavItem = useMemo(() => {
    const topNavItem = buildTopNavItem(t);
    const key = topNavItem.key;
    return isRoutable(key) ? { ...topNavItem, onClick: () => navigate(key) } : topNavItem;
  }, [navigate, t]);

  const createOnCurrentScreen = useCallback(() => {
    // A screen that wired `useScreenIntent` opens its own create flow;
    // anywhere else ⌘N falls back to the app's primary create action — the
    // same one the command bar lists first.
    navigate(intentTargets > 0 ? activeScreen : DEFAULT_CREATE_SCREEN, "create");
  }, [activeScreen, intentTargets, navigate]);

  const backOnCurrentScreen = useCallback(() => {
    if (route.segments.length === 0) return;
    openSubPage(parentSegments(route.segments));
  }, [route.segments, openSubPage]);

  const { moduleJumps } = useGlobalShortcuts({
    navGroups: groups,
    topNavItem: routedTopNavItem,
    onCreate: createOnCurrentScreen,
    onShowHelp: () => setShortcutsOpen(true),
    onBack: backOnCurrentScreen,
    disabled: !session || showWizard || shortcutsOpen,
  });

  async function handleSaveUser(draft: UserFormDraft, editingId: string | null) {
    const fields = {
      nameAr: draft.nameAr,
      nameEn: draft.nameEn.trim() === "" ? null : draft.nameEn,
      email: draft.email,
      phone: draft.phone.trim() === "" ? null : draft.phone,
      password: draft.password.trim() === "" ? undefined : draft.password,
      pin: draft.pin.trim() === "" ? undefined : draft.pin,
      roleId: draft.roleId,
      isCompanyAdmin: draft.isCompanyAdmin,
      employeeId: draft.employeeId,
      branchScope: scopeIdsToSelection(draft.branchIds, allBranchIds),
      warehouseScope: scopeIdsToSelection(draft.warehouseIds, allWarehouseIds),
      status: draft.status,
      // The admin's user form does not edit photos — people set their own in
      // الملف الشخصي — so this carries the stored value through untouched.
      photoUrl: draft.photoUrl ?? null,
    };
    try {
      const value = editingId
        ? await updateUser.mutateAsync({ id: editingId, body: fields })
        : await createUser.mutateAsync({ ...fields, password: fields.password ?? "" });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.userSaveFailed") };
    }
  }

  async function handleSaveRole(cmd: { code: string; name: string; description: string; permissions: string[] }) {
    try {
      const value = editingRole ? await updateRole.mutateAsync({ id: editingRole.id, body: cmd }) : await createRole.mutateAsync(cmd);
      setActiveScreen("roles");
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.roleSaveFailed") };
    }
  }

  async function handleRemoveRole(roleId: string) {
    try {
      await deleteRoleMutation.mutateAsync(roleId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.roleDeleteFailed") };
    }
  }

  async function handleToggleUserStatus(userId: string, status: "active" | "inactive") {
    try {
      const value = await setUserStatus.mutateAsync({ id: userId, status });
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : t("app.userStatusFailed") };
    }
  }

  // Checked before the session gate on purpose: the wizard's admin step
  // establishes a session mid-flow, so a session-first gate would unmount the
  // wizard before its remaining steps run.
  if (showWizard) {
    return (
      <FirstRunWizard
        onFinish={() => setShowWizard(false)}
        onCancel={() => {
          setSession(null);
          setShowWizard(false);
        }}
      />
    );
  }

  if (!session) {
    return <LoginScreen onStartWizard={() => setShowWizard(true)} />;
  }

  // The Arabic name is the record; the Latin one shows on the English UI when
  // the person has one, and falls back rather than leaving a blank.
  const sessionName = displayName(session, locale);
  const shellUser: ShellUser = {
    name: sessionName,
    role: session.isCompanyAdmin ? t("shell.user.role.companyAdmin") : t("shell.user.role.member"),
    initials: initialsFor(sessionName, t("app.unknownInitial")),
    // The photo comes from the profile, not the session: it changes while the
    // session lives, and the login response is issued once.
    photoUrl: profile.data?.photoUrl ?? null,
  };
  const scopeLabel = scopeLabelFor(session.branchScope, branches, t);

  return (
    <TenantPreferences>
    <NavigationProvider value={navigation}>
    <AppShell
      activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}
      onNavigateHome={() => navigate("dashboard")}
      directNavItems={directNavItems}
      activeWorkspaceKey={activeWorkspaceKey}
      onWorkspaceChange={onWorkspaceChange}
      // Row two: the active workspace's own screens.
      workspaceGroups={workspaceGroups}
      // Every group, الإعداد والصلاحيات included — «كل الشاشات» is the
      // unfiltered map, so a screen no workspace tab shows is still browsable.
      allScreensGroups={groups}
      onShowHelp={() => setShortcutsOpen(true)}
      user={shellUser}
      commandItems={routedCommandItems}
      onOpenProfile={openProfile}
      onSignOut={signOut}
      branchOptions={branchOptions}
      warehouseOptions={warehouseOptions}
      selectedBranchId={selection.branchId}
      selectedWarehouseId={selection.warehouseId}
      onSelectBranch={setBranch}
      onSelectWarehouse={setWarehouse}
    >
      <Breadcrumbs screen={activeScreen} />
      {/*
        The matched screen renders here.

        The router awaits the route's `lazy` module BEFORE it swaps the match,
        so the outgoing screen stays on display while the next chunk downloads
        — the populated list no longer flashes to a skeleton the instant a nav
        item is clicked. That is what the old `startTransition` around the hash
        listener was for; the router does it as a matter of course, so the
        transition and its duplicated route state are both gone.

        Suspense still wraps it for anything a screen suspends on internally.
      */}
      <Suspense fallback={<ScreenLoading />}>
        <Outlet />
      </Suspense>

      {activeScreen === "users" ? (
        <UsersPage
          users={users}
          roles={roles}
          branches={branches}
          warehouses={warehouses}
          employees={employees}
          onSave={handleSaveUser}
          onToggleStatus={handleToggleUserStatus}
        />
      ) : null}

      {activeScreen === "roles" ? (
        <RolesPage
          roles={roles}
          usersByRoleId={usersByRoleId}
          onCreate={() => {
            setEditingRole(null);
            setRoleTemplate(null);
            setActiveScreen("role-editor");
          }}
          onEdit={(role) => {
            setEditingRole(role);
            setRoleTemplate(null);
            setActiveScreen("role-editor");
          }}
          onDuplicate={(role) => {
            setEditingRole(null);
            setRoleTemplate(role);
            setActiveScreen("role-editor");
          }}
          onDelete={handleRemoveRole}
        />
      ) : null}

      {activeScreen === "role-editor" && entitlements ? (
        <RoleEditorPage
          role={editingRole}
          template={roleTemplate}
          entitlements={entitlements}
          onSave={handleSaveRole}
          onCancel={() => setActiveScreen("roles")}
        />
      ) : null}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} moduleJumps={moduleJumps} />
    </AppShell>
    </NavigationProvider>
    </TenantPreferences>
  );
}

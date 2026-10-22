import { type RouteObject } from "react-router";
import { AppLayout } from "../AppLayout";
import { LanHostGate } from "../lan/LanHostGate";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { HydrateFallback } from "./HydrateFallback";
import { HomeRedirect } from "./HomeRedirect";
import { SCREEN_MODULES, type RoutableKey } from "./screens";
import { routePathForScreen } from "../routing";
import { listLoader } from "./loader";
import { customerFilterFromUrl, customersQuery } from "../data/list-queries";
import { PlatformApp } from "../platform/PlatformApp";
import { SignupApp } from "../signup/SignupApp";
import { UnlockLinkScreen } from "../login/UnlockLinkScreen";
import { LANDING_PATH } from "../landing/site";
import { RootEntry } from "./RootEntry";

/**
 * The route table, derived from the nav tree rather than written out.
 *
 * Hand-maintaining 116 route objects beside 116 nav entries guarantees they
 * drift: a screen gains a nav row and no route, or keeps a route after the row
 * is dropped. `routePathForScreen` is the same map the rail is built from, so
 * a screen is addressable exactly when it is reachable.
 *
 * Every screen mounts as a SPLAT route (`sales/quotes/*`). The splat is what
 * carries a sub-page — `new`, a document id — and it matches the bare path
 * too, so one entry serves both `/sales/quotes` and `/sales/quotes/QT-0004`.
 * Screens read it through `useNavigation().segments`, unchanged from before.
 */
/**
 * Screens whose list query starts alongside their chunk download.
 *
 * The loader is attached HERE rather than inside the screen's lazy module, and
 * that placement is the point: React Router runs a static loader concurrently
 * with the chunk download, so the request overlaps the JavaScript instead of
 * queueing behind it. Inside the module it could not start until the module
 * had already arrived.
 *
 * A screen is absent from this map simply because nobody has described its
 * query yet — it renders exactly as before and fetches on mount.
 */
const SCREEN_LOADERS: Partial<Record<string, ReturnType<typeof listLoader>>> = {
  customers: listLoader((url) => [customersQuery(customerFilterFromUrl(url))]),
};

function screenRoute(key: string): RouteObject {
  return {
    path: `${routePathForScreen(key)}/*`,
    lazy: SCREEN_MODULES[key as RoutableKey],
    loader: SCREEN_LOADERS[key],
    // Per screen, not once at the root: a failing report must not take the
    // nav rail and the header down with it. See RouteErrorBoundary.
    ErrorBoundary: RouteErrorBoundary,
  };
}

/**
 * The shell, behind the "can this machine reach its host" check.
 *
 * Module-level and named, not an inline arrow in the route object: a component
 * identity that changes on every render remounts the entire application tree
 * under it on every navigation.
 *
 * On a host build `LanHostGate` renders its children and does nothing else; on
 * a client it replaces them with a named failure screen when the host is not
 * answering, instead of a login form that will freeze and then produce one
 * bilingual sentence for five unrelated faults.
 */
function GatedAppLayout() {
  return (
    <RootEntry
      app={
        <LanHostGate>
          <AppLayout />
        </LanHostGate>
      }
    />
  );
}

export const routes: RouteObject[] = [
  /*
   * The platform console — an operator's door onto every tenant, not a
   * screen a tenant user can ever reach. It is a SIBLING of the tenant app's
   * `/` route, mounted first so it never falls through to the tenant
   * catch-all, and it owns its own session and layout entirely (see
   * `platform/PlatformApp.tsx`) rather than nesting under `AppLayout`.
   */
  { path: "/platform/*", Component: PlatformApp },
  /**
   * The public self-serve signup flow — also a sibling, also outside the
   * gate: it runs before any tenant exists, so a LAN-host check or a tenant
   * session would both be nonsensical here.
   */
  { path: "/signup/*", Component: SignupApp },
  { path: "/unlock", Component: UnlockLinkScreen },
  {
    path: LANDING_PATH,
    lazy: async () => ({ Component: (await import("../landing/LandingPage")).LandingPage }),
    ErrorBoundary: RouteErrorBoundary,
  },
  /**
   * PAIRING SITS OUTSIDE THE SHELL, and outside the gate, deliberately: it is
   * the screen you reach BECAUSE there is no session and no reachable host, so
   * mounting it under a layout that requires either would make it unreachable
   * in every state it exists for.
   */
  {
    path: "/pair-host",
    lazy: async () => ({ Component: (await import("../login/PairHostScreen")).PairHostScreen }),
    ErrorBoundary: RouteErrorBoundary,
  },
  {
    path: "/glance/*",
    lazy: async () => ({ Component: (await import("../screens/enh/glance/GlanceApp")).GlanceApp }),
    ErrorBoundary: RouteErrorBoundary,
  },
  {
    path: "/",
    Component: GatedAppLayout,
    HydrateFallback,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, element: <HomeRedirect /> },
      /*
       * THE DESKTOP ENTRY POINT. The packaged shell loads
       * `app://mezan/index.html` (main/renderer-protocol.ts), so the app boots
       * on the path `/index.html` — which matches no screen and fell straight
       * through to the catch-all below. Every launch of the desktop build
       * landed on «الصفحة غير موجودة» with the whole navigation rail rendered
       * around it, and the only way to a real screen was to click one.
       *
       * A browser build is served at `/` and never sees this path, which is
       * why it is invisible everywhere except the packaged app.
       */
      { path: "index.html", element: <HomeRedirect /> },
      ...Object.keys(SCREEN_MODULES).map(screenRoute),
      /*
       * المستخدمون / الأدوار are not stateless screen modules — the role
       * editor needs the in-flight `editingRole` to tell create from edit — so
       * AppLayout mounts all three itself against shared `/users` + `/roles`
       * data. They only need their ADDRESSES reserved here, or the catch-all
       * below would 404 a screen that renders perfectly well.
       */
      ...(["users", "roles", "role-editor"] as const).map((key) => ({
        path: `${routePathForScreen(key)}/*`,
        element: null,
      })),
      {
        path: "*",
        ErrorBoundary: RouteErrorBoundary,
        loader: () => {
          throw new Response("Not found", { status: 404 });
        },
      },
    ],
  },
];

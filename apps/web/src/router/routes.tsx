import { Navigate, type RouteObject } from "react-router";
import { AppLayout } from "../AppLayout";
import { RouteErrorBoundary } from "./RouteErrorBoundary";
import { HydrateFallback } from "./HydrateFallback";
import { SCREEN_MODULES, type RoutableKey } from "./screens";
import { routePathForScreen } from "../routing";

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
function screenRoute(key: string): RouteObject {
  return {
    path: `${routePathForScreen(key)}/*`,
    lazy: SCREEN_MODULES[key as RoutableKey],
    // Per screen, not once at the root: a failing report must not take the
    // nav rail and the header down with it. See RouteErrorBoundary.
    ErrorBoundary: RouteErrorBoundary,
  };
}

export const routes: RouteObject[] = [
  {
    path: "/",
    Component: AppLayout,
    HydrateFallback,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
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

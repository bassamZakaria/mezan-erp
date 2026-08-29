import { RouterProvider, createBrowserRouter, createMemoryRouter } from "react-router";
import { useState } from "react";
import { routes } from "./router/routes";

export interface AppProps {
  /**
   * Test seam: render against an in-memory history at these addresses instead
   * of the browser's. `createBrowserRouter` needs a real History, which jsdom
   * has, but driving it from a test means writing to `window.location` and
   * waiting for the router to notice — a memory router takes the address
   * directly and removes that race.
   */
  readonly initialEntries?: readonly string[];
}

/**
 * The application root: the router, and nothing else.
 *
 * The shell that used to live here — nav rail, header, workspace tabs, the
 * users/roles state machine — is now `AppLayout`, mounted as the router's
 * layout route so it survives every navigation instead of being re-derived
 * beside a hand-rolled `hashchange` listener.
 *
 * The router is built ONCE and held in state. Rebuilding it on a re-render
 * discards the navigation state with it, which shows up as the app snapping
 * back to the dashboard the first time anything above it re-renders.
 */
export function App({ initialEntries }: AppProps = {}) {
  const [router] = useState(() =>
    initialEntries
      ? createMemoryRouter(routes, { initialEntries: [...initialEntries] })
      : createBrowserRouter(routes),
  );
  return <RouterProvider router={router} />;
}

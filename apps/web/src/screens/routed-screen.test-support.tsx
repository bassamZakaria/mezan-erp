import { useState, type ReactNode } from "react";
import { NavigationProvider } from "../navigation";

/** A screen under a NavigationProvider whose sub-page segments behave like the URL: `open` pushes, `close` pops to the list. */
export function RoutedScreen({
  children,
  initialSegments = [],
  openScreenAt = () => {},
}: {
  readonly children: ReactNode;
  readonly initialSegments?: readonly string[];
  readonly openScreenAt?: (screen: string, segments: readonly string[]) => void;
}) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
  return (
    <NavigationProvider value={{ navigate: () => {}, segments, openSubPage: (next) => setSegments(next), openScreenAt, intent: null, clearIntent: () => {} }}>
      {children}
    </NavigationProvider>
  );
}

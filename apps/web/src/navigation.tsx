import { createContext, useContext, type ReactNode } from "react";

type NavigateFn = (screenKey: string) => void;

const NavigationContext = createContext<NavigateFn | null>(null);

export function NavigationProvider({ navigate, children }: { navigate: NavigateFn; children: ReactNode }) {
  return <NavigationContext.Provider value={navigate}>{children}</NavigationContext.Provider>;
}

export function useNavigate(): NavigateFn {
  return useContext(NavigationContext) ?? (() => {});
}

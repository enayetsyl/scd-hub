/**
 * Sidebar collapse state (D-#258) — shared so BOTH the nav drawer and the content
 * `Screen` can read it: the header ☰ toggles `collapsed`, the drawer width goes
 * 300↔0, and `Screen` widens its content frame to fill the freed space (the body
 * "expands/contracts with the sidebar"). Lives in `state/` (depends only on React)
 * so `components/ui` can consume it without an import cycle through `navigation/`.
 *
 * The default context value (collapsed:false) makes `useSidebar()` safe even for a
 * `Screen` rendered outside the provider (e.g. an error fallback).
 */
import React from "react";

/** Width (dp) at/above which the nav drawer is a permanent left sidebar (web/desktop);
 *  below it the drawer is a slide-over opened by the ☰ hamburger. */
export const DRAWER_PERMANENT_MIN_WIDTH = 1024;

type SidebarState = { collapsed: boolean; toggle: () => void };

const SidebarContext = React.createContext<SidebarState>({ collapsed: false, toggle: () => {} });

export function SidebarProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false);
  const value = React.useMemo(() => ({ collapsed, toggle: () => setCollapsed((c) => !c) }), [collapsed]);
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  return React.useContext(SidebarContext);
}

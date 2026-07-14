import React, { useEffect } from "react";
import { Platform, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { Provider as UrqlProvider } from "urql";

import { urqlClient } from "./src/graphql/client";
import { initSentry, Sentry } from "./src/observability/sentry";
import { AppErrorFallback } from "./src/observability/AppErrorFallback";
import { getItem, setItem } from "./src/lib/storage";
import { AuthProvider } from "./src/auth/AuthContext";
import { BasketProvider } from "./src/state/BasketContext";
import { SectionProvider } from "./src/state/SectionContext";
import { LanguageProvider, useLanguage } from "./src/state/LanguageContext";
import { SidebarProvider } from "./src/state/SidebarContext";
import { ToastProvider } from "./src/state/ToastContext";
import { ConfirmProvider } from "./src/state/ConfirmContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { WebPushGate } from "./src/components/WebPushGate";
import { UpdateGate } from "./src/components/UpdateGate";
import { navigationRef, openNotificationCenter } from "./src/navigation/navigationRef";
import { useNavigationTheme } from "./src/theme";

// Splash holds until Noto Sans Bengali is loaded (ui-guidelines §13.2) — text
// never flashes in the platform font.
void SplashScreen.preventAutoHideAsync();

// MON-3 (prd-observability.md §4): init @sentry/react-native at boot. A no-op unless
// EXPO_PUBLIC_SENTRY_DSN is set, so local dev / the web-export gate are unaffected.
initSentry();

/**
 * Keying RootNavigator by the active language remounts the navigation subtree on a
 * language switch, so every screen re-reads the new language. The providers above
 * (auth, basket, section) sit outside the key and keep their state.
 */
function LanguageScopedNavigator(): React.ReactElement {
  const { lang } = useLanguage();
  return <RootNavigator key={lang} />;
}

// On WEB a full page reload remounts the navigator, which would otherwise reset
// to the initial tab (Content). We persist/restore the React Navigation state so
// a refresh keeps the user on the screen they were on. Native apps don't reload,
// so this is web-only (the section/auth contexts already persist themselves).
// Bumped to _v2 when the navigator changed from bottom-tabs to a grouped drawer
// (D-#258): a persisted v1 (tab) state tree is incompatible with the drawer
// navigator, so a stale restore is dropped once on the first post-deploy load.
const NAV_STATE_KEY = "scd_nav_state_v2";
type NavState = React.ComponentProps<typeof NavigationContainer>["initialState"];

// Screens that are transient pickers — pushed on demand, then popped. They are never
// a valid screen to RESTORE onto: their whole purpose is to hand control back to the
// screen that opened them, so a restored picker has no back-target and strands the user
// (e.g. an old build persisted Sets→SectionPicker as the tab's active route; restoring it
// dropped the user on a bare picker that bounced to Today). Strip any such route from the
// restored tree so every navigator falls back to a real screen. Additive + safe: a tree
// without these routes is unchanged.
const TRANSIENT_SCREENS = new Set(["SectionPicker"]);

function sanitizeNavState(state: unknown): unknown {
  if (!state || typeof state !== "object") return state;
  const s = state as { index?: number; routes?: Array<{ name?: string; state?: unknown }> };
  if (!Array.isArray(s.routes)) return state;

  const routes = s.routes
    .filter((r) => !(r.name && TRANSIENT_SCREENS.has(r.name)))
    .map((r) => (r.state ? { ...r, state: sanitizeNavState(r.state) } : r));

  // Every route here was transient — drop this nested tree so the navigator boots on
  // its own initialRouteName instead of an empty (crash-y) routes array.
  if (routes.length === 0) return undefined;

  const index = Math.min(s.index ?? routes.length - 1, routes.length - 1);
  return { ...s, index, routes };
}

function ThemedNavigation(): React.ReactElement | null {
  const navTheme = useNavigationTheme();
  const scheme = useColorScheme();
  const [navReady, setNavReady] = React.useState(Platform.OS !== "web");
  const [initialState, setInitialState] = React.useState<NavState>(undefined);

  // Restore the persisted navigation state once, on web boot.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    (async () => {
      try {
        const saved = await getItem(NAV_STATE_KEY);
        if (saved) setInitialState(sanitizeNavState(JSON.parse(saved)) as NavState);
      } catch {
        /* ignore corrupt persisted nav state */
      }
      setNavReady(true);
    })();
  }, []);

  // N4.2: tapping a push opens the NotificationCenter — the role-agnostic
  // inbox; the row inside carries the same deep-link the badge path uses.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      openNotificationCenter();
    });
    return () => sub.remove();
  }, []);

  if (!navReady) return null;

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      initialState={initialState}
      onStateChange={(state) => {
        if (Platform.OS !== "web") return;
        void setItem(NAV_STATE_KEY, JSON.stringify(state));
      }}
    >
      <LanguageScopedNavigator />
      {/* The header is a `primary` block in both themes: light primary is deep
          green (light icons), dark primary is light green (dark icons). */}
      <StatusBar style={scheme === "dark" ? "dark" : "light"} />
    </NavigationContainer>
  );
}

function App(): React.ReactElement | null {
  // Only the three faces the type scale uses (§5) — requiring the package
  // index would bundle every weight.
  const [fontsLoaded] = useFonts({
    NotoSansBengali_400Regular: require("@expo-google-fonts/noto-sans-bengali/NotoSansBengali_400Regular.ttf"),
    NotoSansBengali_500Medium: require("@expo-google-fonts/noto-sans-bengali/NotoSansBengali_500Medium.ttf"),
    NotoSansBengali_700Bold: require("@expo-google-fonts/noto-sans-bengali/NotoSansBengali_700Bold.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    // MON-3: a top-level ErrorBoundary catches white-screen render crashes (web
    // especially), reports them, and shows a friendly fallback. Placed OUTSIDE the
    // providers so it survives a crash in any of them.
    <Sentry.ErrorBoundary
      fallback={({ error, resetError }) => (
        <AppErrorFallback error={error as Error} resetError={resetError} />
      )}
    >
      {/* GestureHandlerRootView wraps the whole app so the drawer's swipe-to-open
          gesture works on native (D-#258). flex:1 is required. No-op on web. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <UrqlProvider value={urqlClient}>
            <LanguageProvider>
              <AuthProvider>
                <BasketProvider>
                  <SectionProvider>
                    {/* SidebarProvider sits above the navigator so the drawer
                        (AppTabs) and every content Screen share one collapse
                        state (D-#258). */}
                    <SidebarProvider>
                      {/* UX-1 (D-#265): global toast + confirm sheet sit above the
                          navigator so every screen can toast a mutation outcome and
                          gate destructive actions behind one confirm sheet. */}
                      <ToastProvider>
                        <ConfirmProvider>
                          {/* Self-hosted Android updates: a newer APK on the server
                              walls the app until installed; otherwise pending EAS
                              (OTA) updates apply immediately. Web/iOS pass through. */}
                          <UpdateGate>
                            {/* D-#296 owner ruling: no notification permission → no app
                                (web; native has its own Expo-push prompt). */}
                            <WebPushGate>
                              <ThemedNavigation />
                            </WebPushGate>
                          </UpdateGate>
                        </ConfirmProvider>
                      </ToastProvider>
                    </SidebarProvider>
                  </SectionProvider>
                </BasketProvider>
              </AuthProvider>
            </LanguageProvider>
          </UrqlProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Sentry.ErrorBoundary>
  );
}

// MON-3: `Sentry.wrap` registers native crash handlers + the routing instrumentation.
export default Sentry.wrap(App);

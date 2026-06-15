import React, { useEffect } from "react";
import { Platform, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { Provider as UrqlProvider } from "urql";

import { urqlClient } from "./src/graphql/client";
import { getItem, setItem } from "./src/lib/storage";
import { AuthProvider } from "./src/auth/AuthContext";
import { BasketProvider } from "./src/state/BasketContext";
import { SectionProvider } from "./src/state/SectionContext";
import { LanguageProvider, useLanguage } from "./src/state/LanguageContext";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { navigationRef, openNotificationCenter } from "./src/navigation/navigationRef";
import { useNavigationTheme } from "./src/theme";

// Splash holds until Noto Sans Bengali is loaded (ui-guidelines §13.2) — text
// never flashes in the platform font.
void SplashScreen.preventAutoHideAsync();

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
const NAV_STATE_KEY = "scd_nav_state";
type NavState = React.ComponentProps<typeof NavigationContainer>["initialState"];

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
        if (saved) setInitialState(JSON.parse(saved) as NavState);
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

export default function App(): React.ReactElement | null {
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
    <SafeAreaProvider>
      <UrqlProvider value={urqlClient}>
        <LanguageProvider>
          <AuthProvider>
            <BasketProvider>
              <SectionProvider>
                <ThemedNavigation />
              </SectionProvider>
            </BasketProvider>
          </AuthProvider>
        </LanguageProvider>
      </UrqlProvider>
    </SafeAreaProvider>
  );
}

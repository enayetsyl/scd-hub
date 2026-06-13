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

function ThemedNavigation(): React.ReactElement {
  const navTheme = useNavigationTheme();
  const scheme = useColorScheme();

  // N4.2: tapping a push opens the NotificationCenter — the role-agnostic
  // inbox; the row inside carries the same deep-link the badge path uses.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      openNotificationCenter();
    });
    return () => sub.remove();
  }, []);

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
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
